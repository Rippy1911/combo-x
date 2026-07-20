/**
 * Combo Link runtime — heartbeat + command poll while sidepanel is open.
 */
import {
  ConnectorStore,
  applySetupBundle,
  applyUpsertConnectors,
  applyVaultDeleteSecrets,
  applyVaultPutSecrets,
  cloudClientFromConfig,
  linkClientFromConfig,
  loadCloudConfig,
  loadLinkConfig,
  pullSessionSync,
  pushSessionSync,
  saveLinkConfig,
  setupPackFromB64,
  unsealSetupPack,
  type ApplyBundlePayload,
  type ChatSession,
  type Connector,
  type LinkCommand,
  type LinkLocalConfig,
  type SessionMessage,
  type SessionStore,
  type Vault,
} from "@combo-x/core";
import { useCallback, useEffect, useRef, useState } from "react";

export type ComboLinkHandlers = {
  onLinkSend: (input: {
    commandId: string;
    sessionId?: string;
    text: string;
    createNew?: boolean;
  }) => Promise<{ ok: boolean; sessionId?: string; error?: string }>;
  onLinkAbort: (sessionId?: string) => void;
  onLinkApproval: (sessionId: string | undefined, allow: boolean) => void;
  getSessionSnapshot: (sessionId: string) => {
    title: string;
    messages: Array<Record<string, unknown>>;
    running: boolean;
  } | null;
  /** Unlocked vault for vault-admin commands. */
  getVault: () => Vault | null;
  getActiveVaultId: () => string | null;
  /** Push vault+setup after admin edits (optional). */
  onSyncPushNow?: (scopes: string[]) => Promise<{ ok: boolean; error?: string }>;
  /** Import a vault pack ciphertext pulled from history. */
  onRestoreVaultPack?: (ciphertextB64: string, version: number) => Promise<{ ok: boolean; error?: string }>;
};

export function useComboLink(
  unlocked: boolean,
  sessions: SessionStore,
  handlers: ComboLinkHandlers,
) {
  const [linkConfig, setLinkConfigState] = useState<LinkLocalConfig>(() => loadLinkConfig());
  const [linkStatus, setLinkStatus] = useState<"off" | "online" | "error" | "no_cloud">("off");
  const [linkError, setLinkError] = useState("");
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const activeCommandRef = useRef<string | null>(null);
  const connectorsRef = useRef(new ConnectorStore());

  const setLinkConfig = useCallback((partial: Partial<LinkLocalConfig>) => {
    const next = saveLinkConfig(partial);
    setLinkConfigState(next);
    return next;
  }, []);

  const publishLinkEvents = useCallback(
    async (
      events: Array<Record<string, unknown>>,
      opts?: { sessionId?: string; commandId?: string },
    ) => {
      if (!loadLinkConfig().linkEnabled) return;
      const client = linkClientFromConfig();
      if (!client) return;
      await client.publishEvents(events, {
        sessionId: opts?.sessionId,
        commandId: opts?.commandId ?? activeCommandRef.current ?? undefined,
      });
    },
    [],
  );

  const pushLinkSnapshot = useCallback(async (session: ChatSession, running: boolean) => {
    if (!loadLinkConfig().linkEnabled) return;
    const client = linkClientFromConfig();
    if (!client) return;
    await client.upsertSessions([
      {
        id: session.id,
        title: session.title,
        running,
        updated_at: session.updatedAt,
        messages: session.messages.map(slimMessage),
        meta: { source: session.source ?? "local" },
      },
    ]);
  }, []);

  const syncSessionCloud = useCallback(async (session: ChatSession) => {
    const cfg = loadLinkConfig();
    if (!cfg.syncChats && !cfg.linkEnabled) return;
    const cloud = loadCloudConfig();
    if (!cloud?.syncToken) return;
    const client = cloudClientFromConfig(cloud);
    await pushSessionSync(client, session);
  }, []);

  const pullSessionsCloud = useCallback(async () => {
    const cfg = loadLinkConfig();
    if (!cfg.syncChats) return 0;
    const cloud = loadCloudConfig();
    if (!cloud?.syncToken) return 0;
    const client = cloudClientFromConfig(cloud);
    const result = await pullSessionSync(
      client,
      (s) => sessions.save(s),
      (id) => sessions.get(id),
    );
    return result.imported;
  }, [sessions]);

  useEffect(() => {
    if (!unlocked || !linkConfig.linkEnabled) {
      setLinkStatus(loadCloudConfig()?.syncToken ? "off" : "no_cloud");
      const client = linkClientFromConfig();
      if (client && unlocked) {
        void client.heartbeat({ linkEnabled: false, sidepanelOpen: false });
      }
      return;
    }

    const client = linkClientFromConfig();
    if (!client) {
      setLinkStatus("no_cloud");
      setLinkError("Connect Combo Cloud (sync token) first");
      return;
    }

    let cancelled = false;
    const ac = new AbortController();

    const beat = async () => {
      const r = await client.heartbeat({
        linkEnabled: true,
        sidepanelOpen: true,
        capabilities: { combo_link: true, vault_admin: true, version: "1.6.51" },
      });
      if (cancelled) return;
      if (r.ok) {
        setLinkStatus("online");
        setLinkError("");
      } else {
        setLinkStatus("error");
        setLinkError(r.error ?? "heartbeat failed");
      }
    };

    const handleVaultAdmin = async (cmd: LinkCommand): Promise<{ ok: boolean; error?: string }> => {
      const vault = handlersRef.current.getVault();
      if (!vault?.isUnlocked()) {
        return { ok: false, error: "vault locked — unlock sidepanel vault" };
      }
      const vaultId = handlersRef.current.getActiveVaultId() ?? undefined;
      const store = connectorsRef.current;

      if (cmd.type === "vault.put_secrets") {
        const raw = cmd.payload.items;
        const items = Array.isArray(raw)
          ? raw
              .filter((x): x is { label: string; value: string } =>
                !!x && typeof x === "object" && typeof (x as { label?: unknown }).label === "string",
              )
              .map((x) => ({
                label: x.label,
                value: typeof (x as { value?: unknown }).value === "string" ? (x as { value: string }).value : "",
              }))
          : [];
        const r = await applyVaultPutSecrets(vault, items);
        if (!r.ok) return r;
        await client.publishEvents(
          [{ type: "vault_admin", action: "put_secrets", labels: r.written }],
          { commandId: cmd.id },
        );
        return { ok: true };
      }

      if (cmd.type === "vault.delete_secrets") {
        const labels = Array.isArray(cmd.payload.labels)
          ? cmd.payload.labels.filter((x): x is string => typeof x === "string")
          : [];
        const r = await applyVaultDeleteSecrets(vault, labels);
        if (!r.ok) return r;
        await client.publishEvents(
          [{ type: "vault_admin", action: "delete_secrets", labels: r.deleted }],
          { commandId: cmd.id },
        );
        return { ok: true };
      }

      if (cmd.type === "setup.upsert_connectors") {
        const raw = cmd.payload.connectors;
        const connectors = Array.isArray(raw) ? (raw as Connector[]) : [];
        const r = await applyUpsertConnectors(store, connectors, vaultId);
        if (!r.ok) return r;
        await client.publishEvents(
          [{ type: "vault_admin", action: "upsert_connectors", ids: r.ids }],
          { commandId: cmd.id },
        );
        return { ok: true };
      }

      if (cmd.type === "setup.apply_bundle") {
        const payload = cmd.payload as ApplyBundlePayload;
        const r = await applySetupBundle(vault, store, payload, vaultId ?? "");
        if (!r.ok) return r;
        await client.publishEvents(
          [{ type: "vault_admin", action: "apply_bundle", summary: r.summary }],
          { commandId: cmd.id },
        );
        return { ok: true };
      }

      if (cmd.type === "sync.push_now") {
        const scopes = Array.isArray(cmd.payload.scopes)
          ? cmd.payload.scopes.filter((x): x is string => typeof x === "string")
          : ["vault", "setup"];
        if (handlersRef.current.onSyncPushNow) {
          return handlersRef.current.onSyncPushNow(scopes);
        }
        return { ok: false, error: "push handler missing" };
      }

      if (cmd.type === "sync.restore_version") {
        const scope = typeof cmd.payload.scope === "string" ? cmd.payload.scope : "vault";
        const version = Number(cmd.payload.version);
        if (!Number.isFinite(version)) return { ok: false, error: "version required" };
        const cloud = loadCloudConfig();
        if (!cloud?.syncToken) return { ok: false, error: "no cloud" };
        const c = cloudClientFromConfig(cloud);
        const pull = await c.syncPull(scope, { version });
        if (!pull.ok || !pull.ciphertext_b64) {
          return { ok: false, error: pull.error ?? "pull failed" };
        }
        if (scope === "setup") {
          const sealed = setupPackFromB64(pull.ciphertext_b64);
          const plain = await unsealSetupPack(vault, sealed);
          for (const conn of plain.connectors) {
            await store.put({ ...conn, vaultId: conn.vaultId ?? plain.vaultId });
          }
        } else if (scope === "vault") {
          if (!handlersRef.current.onRestoreVaultPack) {
            return { ok: false, error: "restore handler missing" };
          }
          return handlersRef.current.onRestoreVaultPack(pull.ciphertext_b64, version);
        }
        await client.publishEvents(
          [{ type: "vault_admin", action: "restore_version", scope, version }],
          { commandId: cmd.id },
        );
        return { ok: true };
      }

      return { ok: false, error: "unknown vault-admin type" };
    };

    const handleCommand = async (cmd: LinkCommand) => {
      activeCommandRef.current = cmd.id;
      await client.ackCommand(cmd.id, "acked");
      try {
        if (cmd.type === "chat.send" || cmd.type === "session.create") {
          const text = typeof cmd.payload.text === "string" ? cmd.payload.text : "";
          if (!text.trim()) {
            await client.ackCommand(cmd.id, "failed", "empty text");
            return;
          }
          const result = await handlersRef.current.onLinkSend({
            commandId: cmd.id,
            sessionId:
              typeof cmd.payload.session_id === "string" ? cmd.payload.session_id : undefined,
            text,
            createNew: cmd.type === "session.create" || cmd.payload.create_new === true,
          });
          if (!result.ok) {
            await client.ackCommand(cmd.id, "failed", result.error ?? "send failed");
          } else {
            await client.ackCommand(cmd.id, "done");
            if (result.sessionId) {
              const snap = handlersRef.current.getSessionSnapshot(result.sessionId);
              if (snap) {
                await client.upsertSessions([
                  {
                    id: result.sessionId,
                    title: snap.title,
                    running: snap.running,
                    messages: snap.messages,
                    meta: { source: "link" },
                  },
                ]);
              }
            }
          }
        } else if (cmd.type === "chat.abort") {
          handlersRef.current.onLinkAbort(
            typeof cmd.payload.session_id === "string" ? cmd.payload.session_id : undefined,
          );
          await client.ackCommand(cmd.id, "done");
        } else if (cmd.type === "approval.respond") {
          handlersRef.current.onLinkApproval(
            typeof cmd.payload.session_id === "string" ? cmd.payload.session_id : undefined,
            cmd.payload.allow === true,
          );
          await client.ackCommand(cmd.id, "done");
        } else if (
          cmd.type === "vault.put_secrets" ||
          cmd.type === "vault.delete_secrets" ||
          cmd.type === "setup.upsert_connectors" ||
          cmd.type === "setup.apply_bundle" ||
          cmd.type === "sync.push_now" ||
          cmd.type === "sync.restore_version"
        ) {
          const r = await handleVaultAdmin(cmd);
          if (!r.ok) await client.ackCommand(cmd.id, "failed", r.error ?? "failed");
          else await client.ackCommand(cmd.id, "done");
        } else {
          await client.ackCommand(cmd.id, "failed", "unknown type");
        }
      } catch (e) {
        await client.ackCommand(cmd.id, "failed", e instanceof Error ? e.message : String(e));
      } finally {
        if (activeCommandRef.current === cmd.id) activeCommandRef.current = null;
      }
    };

    const pollLoop = async () => {
      while (!cancelled && !ac.signal.aborted) {
        try {
          const r = await client.pollCommands(20);
          if (cancelled) break;
          if (!r.ok) {
            setLinkStatus("error");
            setLinkError(r.error ?? "poll failed");
            await sleep(2000);
            continue;
          }
          setLinkStatus("online");
          for (const cmd of r.commands) {
            await handleCommand(cmd);
          }
        } catch (e) {
          if (cancelled) break;
          setLinkStatus("error");
          setLinkError(e instanceof Error ? e.message : String(e));
          await sleep(2000);
        }
      }
    };

    void beat();
    const hb = setInterval(() => void beat(), 20_000);
    void pollLoop();
    void pullSessionsCloud();

    return () => {
      cancelled = true;
      ac.abort();
      clearInterval(hb);
      void client.heartbeat({ linkEnabled: false, sidepanelOpen: false });
    };
  }, [unlocked, linkConfig.linkEnabled, pullSessionsCloud]);

  return {
    linkConfig,
    setLinkConfig,
    linkStatus,
    linkError,
    publishLinkEvents,
    pushLinkSnapshot,
    syncSessionCloud,
    pullSessionsCloud,
    activeCommandId: () => activeCommandRef.current,
  };
}

function slimMessage(m: SessionMessage): Record<string, unknown> {
  return {
    id: m.id,
    role: m.role,
    content:
      typeof m.content === "string" && m.content.length > 8000
        ? `${m.content.slice(0, 8000)}…[truncated]`
        : m.content,
    createdAt: m.createdAt,
    source: m.source,
    tools: m.tools?.map((t) => ({
      id: t.id,
      name: t.name,
      status: t.status,
    })),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
