/**
 * Encrypted-ish session blob sync (sessions_manifest + session:{id}).
 * Transport = base64(JSON) — opaque to the API; decrypt/merge is client-side.
 * Portal history uses Link plaintext snapshots instead.
 */

import type { ChatSession } from "../sessions/store.js";
import { b64ToUtf8, utf8ToB64 } from "../vault/bytes.js";
import type { CloudClient } from "./client.js";
import {
  loadSessionSyncVersions,
  saveSessionSyncVersions,
} from "./linkConfig.js";

export type SessionsManifestEntry = {
  id: string;
  title: string;
  updatedAt: string;
  version: number;
  source?: string;
};

export type SessionsManifest = {
  format: "combo-x-sessions-manifest-v1";
  sessions: SessionsManifestEntry[];
  updatedAt: string;
};

const MANIFEST_SCOPE = "sessions_manifest";
const MANIFEST_VERSION_KEY = "__manifest__";

function sessionScope(id: string): string {
  return `session:${id}`;
}

export function encodeSessionBlob(session: ChatSession): string {
  const slim: ChatSession = {
    ...session,
    messages: session.messages.map((m) => ({
      ...m,
      // Drop huge tool results for sync bandwidth
      tools: m.tools?.map((t) => ({
        ...t,
        result:
          typeof t.result === "string" && t.result.length > 4000
            ? `${t.result.slice(0, 4000)}…[truncated]`
            : t.result,
      })),
    })),
  };
  return utf8ToB64(JSON.stringify(slim));
}

export function decodeSessionBlob(b64: string): ChatSession {
  return JSON.parse(b64ToUtf8(b64)) as ChatSession;
}

export function encodeManifest(manifest: SessionsManifest): string {
  return utf8ToB64(JSON.stringify(manifest));
}

export function decodeManifest(b64: string): SessionsManifest {
  const parsed = JSON.parse(b64ToUtf8(b64)) as SessionsManifest;
  if (parsed.format !== "combo-x-sessions-manifest-v1") {
    throw new Error("invalid sessions manifest");
  }
  return parsed;
}

/** Push one session + bump manifest. Fire-and-forget friendly. */
export async function pushSessionSync(
  client: CloudClient,
  session: ChatSession,
): Promise<{ ok: boolean; error?: string }> {
  const versions = loadSessionSyncVersions();
  const prev = versions[session.id] ?? 0;
  const nextVer = prev + 1;
  const cipher = encodeSessionBlob(session);
  const push = await client.syncPush({
    scope: sessionScope(session.id),
    version: nextVer,
    prev_version: prev > 0 ? prev : undefined,
    ciphertext_b64: cipher,
  });
  if (!push.ok) {
    // Retry once with version bump on stale
    if (push.code === "stale_version") {
      const retryVer = nextVer + 10;
      const again = await client.syncPush({
        scope: sessionScope(session.id),
        version: retryVer,
        ciphertext_b64: cipher,
      });
      if (!again.ok) return { ok: false, error: again.error };
      versions[session.id] = retryVer;
    } else {
      return { ok: false, error: push.error };
    }
  } else {
    versions[session.id] = nextVer;
  }

  const manifestVer = (versions[MANIFEST_VERSION_KEY] ?? 0) + 1;
  const manifest: SessionsManifest = {
    format: "combo-x-sessions-manifest-v1",
    updatedAt: new Date().toISOString(),
    sessions: Object.entries(versions)
      .filter(([k]) => k !== MANIFEST_VERSION_KEY)
      .map(([id, version]) => ({
        id,
        title: id === session.id ? session.title : id.slice(0, 8),
        updatedAt: id === session.id ? session.updatedAt : new Date(0).toISOString(),
        version,
        source: id === session.id ? session.source : undefined,
      })),
  };
  // Prefer accurate titles from this session; keep others from prior pull if present
  const priorPull = await client.syncPull(MANIFEST_SCOPE);
  if (priorPull.ok && priorPull.ciphertext_b64) {
    try {
      const prior = decodeManifest(priorPull.ciphertext_b64);
      const byId = new Map(prior.sessions.map((s) => [s.id, s]));
      for (const s of manifest.sessions) {
        const old = byId.get(s.id);
        if (old && s.id !== session.id) {
          s.title = old.title;
          s.updatedAt = old.updatedAt;
          s.source = old.source;
        }
      }
      for (const old of prior.sessions) {
        if (!manifest.sessions.some((s) => s.id === old.id)) {
          manifest.sessions.push(old);
        }
      }
    } catch {
      /* ignore bad prior */
    }
  }
  // Update this session entry properly
  const self = manifest.sessions.find((s) => s.id === session.id);
  if (self) {
    self.title = session.title;
    self.updatedAt = session.updatedAt;
    self.version = versions[session.id]!;
    self.source = session.source;
  } else {
    manifest.sessions.unshift({
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      version: versions[session.id]!,
      source: session.source,
    });
  }
  manifest.sessions.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  manifest.sessions = manifest.sessions.slice(0, 200);

  const mPush = await client.syncPush({
    scope: MANIFEST_SCOPE,
    version: manifestVer,
    prev_version: versions[MANIFEST_VERSION_KEY] || undefined,
    ciphertext_b64: encodeManifest(manifest),
  });
  if (!mPush.ok && mPush.code === "stale_version") {
    await client.syncPush({
      scope: MANIFEST_SCOPE,
      version: manifestVer + 10,
      ciphertext_b64: encodeManifest(manifest),
    });
    versions[MANIFEST_VERSION_KEY] = manifestVer + 10;
  } else if (mPush.ok) {
    versions[MANIFEST_VERSION_KEY] = manifestVer;
  }
  saveSessionSyncVersions(versions);
  return { ok: true };
}

/** Pull manifest + missing/newer sessions into local SessionStore-like saver. */
export async function pullSessionSync(
  client: CloudClient,
  save: (session: ChatSession) => Promise<void>,
  getLocal: (id: string) => Promise<ChatSession | null>,
): Promise<{ ok: boolean; imported: number; error?: string }> {
  const pull = await client.syncPull(MANIFEST_SCOPE);
  if (!pull.ok) return { ok: false, imported: 0, error: pull.error };
  if (!pull.ciphertext_b64) return { ok: true, imported: 0 };

  let manifest: SessionsManifest;
  try {
    manifest = decodeManifest(pull.ciphertext_b64);
  } catch (e) {
    return { ok: false, imported: 0, error: e instanceof Error ? e.message : String(e) };
  }

  const versions = loadSessionSyncVersions();
  if (typeof pull.version === "number") versions[MANIFEST_VERSION_KEY] = pull.version;

  let imported = 0;
  for (const entry of manifest.sessions.slice(0, 50)) {
    const local = await getLocal(entry.id);
    const localUpdated = local ? Date.parse(local.updatedAt) : 0;
    const remoteUpdated = Date.parse(entry.updatedAt);
    if (local && localUpdated >= remoteUpdated) {
      versions[entry.id] = Math.max(versions[entry.id] ?? 0, entry.version);
      continue;
    }
    const body = await client.syncPull(sessionScope(entry.id));
    if (!body.ok || !body.ciphertext_b64) continue;
    try {
      const session = decodeSessionBlob(body.ciphertext_b64);
      await save(session);
      versions[entry.id] = typeof body.version === "number" ? body.version : entry.version;
      imported += 1;
    } catch {
      /* skip bad blob */
    }
  }
  saveSessionSyncVersions(versions);
  return { ok: true, imported };
}
