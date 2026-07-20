/**
 * Sealed setup pack — connectors (+ vault ids) sync with vault pack.
 * Ciphertext sealed by unlocked vault KEK; API never sees connector JSON in clear.
 */

import type { Connector } from "../connectors/store.js";
import { b64ToUtf8, utf8ToB64 } from "../vault/bytes.js";
import type { Vault } from "../vault/vault.js";

export const SETUP_PACK_FORMAT = "combo-x-setup-pack-v1" as const;

export type SetupPackPlain = {
  format: typeof SETUP_PACK_FORMAT;
  vaultId: string;
  vaultName?: string;
  connectors: Connector[];
  exportedAt: string;
};

export type SealedSetupPack = {
  format: typeof SETUP_PACK_FORMAT;
  vaultId: string;
  iv_b64: string;
  ciphertext_b64: string;
  exportedAt: string;
};

export function isSealedSetupPack(v: unknown): v is SealedSetupPack {
  if (!v || typeof v !== "object") return false;
  const o = v as SealedSetupPack;
  return (
    o.format === SETUP_PACK_FORMAT &&
    typeof o.vaultId === "string" &&
    typeof o.iv_b64 === "string" &&
    typeof o.ciphertext_b64 === "string"
  );
}

/** Strip any accidental plaintext secret strings from headers before seal. */
export function sanitizeConnectorForSync(c: Connector): Connector {
  const headers: Record<string, string | { vaultLabel: string }> = {};
  for (const [k, v] of Object.entries(c.headers ?? {})) {
    if (v && typeof v === "object" && "vaultLabel" in v) {
      headers[k] = { vaultLabel: String((v as { vaultLabel: string }).vaultLabel) };
    } else if (typeof v === "string") {
      // Drop bearer-looking values; keep non-secret constants (Accept, etc.)
      if (/^(Bearer\s+)?(sk-|ghp_|github_pat_|nsk_|fcu_|cmb_)/i.test(v.trim())) continue;
      headers[k] = v;
    }
  }
  if (c.kind === "rest") {
    return { ...c, headers, tools: c.tools };
  }
  return { ...c, headers };
}

export async function sealSetupPack(
  vault: Vault,
  input: { vaultId: string; vaultName?: string; connectors: Connector[] },
): Promise<SealedSetupPack> {
  const plain: SetupPackPlain = {
    format: SETUP_PACK_FORMAT,
    vaultId: input.vaultId,
    vaultName: input.vaultName,
    connectors: input.connectors.map(sanitizeConnectorForSync),
    exportedAt: new Date().toISOString(),
  };
  const sealed = await vault.sealPayload(JSON.stringify(plain));
  return {
    format: SETUP_PACK_FORMAT,
    vaultId: input.vaultId,
    iv_b64: sealed.iv_b64,
    ciphertext_b64: sealed.ciphertext_b64,
    exportedAt: plain.exportedAt,
  };
}

export async function unsealSetupPack(vault: Vault, pack: SealedSetupPack): Promise<SetupPackPlain> {
  if (!isSealedSetupPack(pack)) throw new Error("invalid setup pack");
  const text = await vault.unsealPayload(pack.iv_b64, pack.ciphertext_b64);
  const parsed = JSON.parse(text) as SetupPackPlain;
  if (parsed.format !== SETUP_PACK_FORMAT) throw new Error("bad setup pack format");
  return parsed;
}

export function setupPackToB64(pack: SealedSetupPack): string {
  return utf8ToB64(JSON.stringify(pack));
}

export function setupPackFromB64(b64: string): SealedSetupPack {
  const parsed = JSON.parse(b64ToUtf8(b64)) as unknown;
  if (!isSealedSetupPack(parsed)) throw new Error("invalid setup pack ciphertext");
  return parsed;
}
