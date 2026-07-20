/**
 * Named vault recipes — connector templates + secret label checklist.
 * No product hosts hardcoded into the agent loop; apply via Link or local UI.
 */

import type { Connector } from "../connectors/store.js";
import {
  anatomeRestTemplate,
  githubRestTemplate,
  ideaforgeRestTemplate,
  nsExecRestTemplate,
  nsFoodRestTemplate,
  uploadsRestTemplate,
} from "../connectors/templates.js";

export type VaultRecipeId = "private" | "work";

export type VaultRecipe = {
  id: VaultRecipeId;
  name: string;
  description: string;
  /** Vault secret labels expected (values supplied at apply time). */
  secretLabels: string[];
  /** Optional mnemonic (not a secret) stored as vault label value. */
  notes?: Array<{ label: string; value: string }>;
  connectors: (vaultId: string) => Connector[];
};

export const VAULT_RECIPES: Record<VaultRecipeId, VaultRecipe> = {
  private: {
    id: "private",
    name: "private",
    description: "Personal: ns-food, anatome/airon.coach, maps uploads, LLM BYOK",
    secretLabels: [
      "openrouter_api_key",
      "ns_food_key",
      "anatome_api_key",
      "fc_uploads_key",
    ],
    connectors: (vaultId) => [
      { ...nsFoodRestTemplate({ vaultId }), vaultId },
      { ...anatomeRestTemplate({ vaultId }), vaultId },
      { ...uploadsRestTemplate(), vaultId },
    ],
  },
  work: {
    id: "work",
    name: "work",
    description: "Work: IdeaForge, GitHub, ns-exec; project RAG stays a local folder grant",
    secretLabels: [
      "ideaforge_shared_api_key",
      "github_token",
      "ns_exec_token",
    ],
    notes: [
      {
        label: "rag_project_hint",
        value: "Grant project folder under Libraries → RAG (device-local; not synced).",
      },
    ],
    connectors: (vaultId) => [
      { ...ideaforgeRestTemplate({ vaultId }), vaultId },
      { ...githubRestTemplate({ vaultLabel: "github_token" }), vaultId },
      { ...nsExecRestTemplate({ vaultId }), vaultId },
    ],
  },
};

export function getVaultRecipe(id: string): VaultRecipe | null {
  if (id === "private" || id === "work") return VAULT_RECIPES[id];
  return null;
}

export type ApplyBundlePayload = {
  recipeId?: VaultRecipeId;
  vaultId?: string;
  vaultName?: string;
  /** label → value (written into unlocked vault). */
  secrets?: Record<string, string>;
  /** Inline connectors (vault refs only); merged with recipe connectors. */
  connectors?: Connector[];
};
