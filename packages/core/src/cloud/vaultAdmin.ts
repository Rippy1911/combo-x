/**
 * Apply Link vault-admin payloads on an unlocked desktop Combo.
 */

import { ConnectorStore, type Connector } from "../connectors/store.js";
import type { Vault } from "../vault/vault.js";
import {
  getVaultRecipe,
  type ApplyBundlePayload,
  type VaultRecipeId,
} from "../vault/recipes.js";
import { sanitizeConnectorForSync } from "./setupPack.js";

export async function applyVaultPutSecrets(
  vault: Vault,
  items: Array<{ label: string; value: string }>,
): Promise<{ ok: true; written: string[] } | { ok: false; error: string }> {
  try {
    const written: string[] = [];
    for (const it of items) {
      const label = it.label?.trim();
      if (!label || typeof it.value !== "string") continue;
      await vault.putByLabel(label, it.value);
      written.push(label);
    }
    return { ok: true, written };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function applyVaultDeleteSecrets(
  vault: Vault,
  labels: string[],
): Promise<{ ok: true; deleted: string[] } | { ok: false; error: string }> {
  try {
    const deleted: string[] = [];
    for (const label of labels) {
      const l = label?.trim();
      if (!l) continue;
      if (await vault.deleteByLabel(l)) deleted.push(l);
    }
    return { ok: true, deleted };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function applyUpsertConnectors(
  store: ConnectorStore,
  connectors: Connector[],
  vaultId?: string,
): Promise<{ ok: true; ids: string[] } | { ok: false; error: string }> {
  try {
    const ids: string[] = [];
    for (const c of connectors) {
      const clean = sanitizeConnectorForSync({
        ...c,
        vaultId: c.vaultId ?? vaultId,
      });
      await store.put(clean);
      ids.push(clean.id);
    }
    return { ok: true, ids };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function applySetupBundle(
  vault: Vault,
  store: ConnectorStore,
  payload: ApplyBundlePayload,
  activeVaultId: string,
): Promise<{ ok: true; summary: string } | { ok: false; error: string }> {
  try {
    const vaultId = payload.vaultId?.trim() || activeVaultId;
    const recipeId = payload.recipeId as VaultRecipeId | undefined;
    const recipe = recipeId ? getVaultRecipe(recipeId) : null;

    if (payload.secrets && typeof payload.secrets === "object") {
      for (const [label, value] of Object.entries(payload.secrets)) {
        if (typeof value === "string" && label.trim()) {
          await vault.putByLabel(label.trim(), value);
        }
      }
    }
    if (recipe?.notes) {
      for (const n of recipe.notes) {
        await vault.putByLabel(n.label, n.value);
      }
    }

    const connectors: Connector[] = [
      ...(recipe ? recipe.connectors(vaultId) : []),
      ...(payload.connectors ?? []),
    ];
    const up = await applyUpsertConnectors(store, connectors, vaultId);
    if (!up.ok) return up;

    return {
      ok: true,
      summary: `bundle ${recipeId ?? "custom"} → ${up.ids.length} connectors on vault ${vaultId}`,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
