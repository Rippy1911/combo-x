import type { GetSecretFn } from "./rest.js";
import type { ConnectorStore, RestConnector, SecretRef } from "./store.js";
import { githubRestTemplate } from "./templates.js";

/** Vault labels accepted for GitHub PAT (chat embed often uses github_pat). */
export const GITHUB_VAULT_LABELS = ["github_token", "github_pat", "gh_combo_x"] as const;

export type EnsureGithubResult =
  | {
      ok: true;
      connectorId: string;
      vaultLabel: string;
      created: boolean;
      updated: boolean;
      note: string;
    }
  | { ok: false; error: string };

function authVaultLabel(headers: RestConnector["headers"]): string | null {
  const auth = headers.Authorization ?? headers.authorization;
  if (auth && typeof auth === "object" && "vaultLabel" in auth) {
    return (auth as SecretRef).vaultLabel;
  }
  return null;
}

/**
 * Ensure a GitHub REST connector exists and points at a vault PAT that is present.
 * Prefer preferredVaultLabel, else first non-empty among GITHUB_VAULT_LABELS.
 */
export async function ensureGithubRestConnector(
  store: ConnectorStore,
  getSecret: GetSecretFn,
  opts?: { connectorId?: string; preferredVaultLabel?: string },
): Promise<EnsureGithubResult> {
  const connectorId = (opts?.connectorId ?? "github-rest").trim() || "github-rest";
  const preferred = opts?.preferredVaultLabel?.trim();

  let vaultLabel: string | undefined;
  if (preferred) {
    const v = await getSecret(preferred);
    if (!v?.trim()) {
      return { ok: false, error: `vault secret missing: ${preferred}` };
    }
    vaultLabel = preferred;
  } else {
    for (const label of GITHUB_VAULT_LABELS) {
      const v = await getSecret(label);
      if (v?.trim()) {
        vaultLabel = label;
        break;
      }
    }
  }

  if (!vaultLabel) {
    return {
      ok: false,
      error: `No GitHub PAT in vault. Save/embed one of: ${GITHUB_VAULT_LABELS.join(", ")} (never echo the token).`,
    };
  }

  const existing = await store.get(connectorId);
  if (existing?.kind === "rest") {
    const current = authVaultLabel(existing.headers);
    if (current === vaultLabel) {
      return {
        ok: true,
        connectorId,
        vaultLabel,
        created: false,
        updated: false,
        note: `Connector ${connectorId} already bound to {vault:${vaultLabel}}`,
      };
    }
    const updated: RestConnector = {
      ...existing,
      headers: {
        ...existing.headers,
        Accept: existing.headers.Accept ?? "application/vnd.github+json",
        "X-GitHub-Api-Version":
          existing.headers["X-GitHub-Api-Version"] ?? "2022-11-28",
        Authorization: { vaultLabel },
      },
    };
    await store.put(updated);
    return {
      ok: true,
      connectorId,
      vaultLabel,
      created: false,
      updated: true,
      note: `Updated ${connectorId} Authorization → {vault:${vaultLabel}}`,
    };
  }

  const connector = githubRestTemplate({ vaultLabel, id: connectorId });
  await store.put(connector);
  return {
    ok: true,
    connectorId,
    vaultLabel,
    created: true,
    updated: false,
    note: `Created ${connectorId} → api.github.com with {vault:${vaultLabel}}`,
  };
}

/** Parse header map: plaintext or `{vault:label}` / `Bearer {vault:label}`. Never store raw PATs. */
export function parseConnectorHeaders(
  raw: Record<string, unknown> | undefined,
): Record<string, string | SecretRef> {
  const out: Record<string, string | SecretRef> = {};
  if (!raw) return out;
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val !== "string") continue;
    const trimmed = val.trim();
    const vaultOnly = trimmed.match(/^\{vault:([a-zA-Z0-9_-]+)\}$/);
    if (vaultOnly) {
      out[key] = { vaultLabel: vaultOnly[1]! };
      continue;
    }
    const bearerVault = trimmed.match(/^Bearer\s+\{vault:([a-zA-Z0-9_-]+)\}$/i);
    if (bearerVault) {
      out[key] = { vaultLabel: bearerVault[1]! };
      continue;
    }
    // Reject values that look like live PATs (with or without Bearer prefix)
    const secretCandidate = trimmed.replace(/^Bearer\s+/i, "");
    if (/^(ghp_|github_pat_|gho_|ghu_|ghs_)/i.test(secretCandidate)) {
      throw new Error(
        `Refusing to store plaintext token in header ${key} — use {vault:label} or authVaultLabel`,
      );
    }
    out[key] = trimmed;
  }
  return out;
}
