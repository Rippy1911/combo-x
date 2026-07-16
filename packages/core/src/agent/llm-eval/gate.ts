/** Opt-in LIVE LLM eval gate — never spend in default CI. */

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

export const DEFAULT_EVAL_MODEL = "google/gemini-2.5-flash-lite";

function readKeyFromPortfolioEnv(): string | null {
  const candidates = [
    resolve(process.cwd(), "../../.env"),
    resolve(process.cwd(), "../.env"),
    resolve(process.cwd(), ".env"),
    "/Users/mymac/projects/base44/.env",
  ];
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue;
      const text = readFileSync(path, "utf8");
      const m = text.match(/^OPENROUTER_API_KEY=(.+)$/m);
      if (m?.[1]) return m[1].trim().replace(/^["']|["']$/g, "");
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function resolveOpenRouterKey(): string | null {
  const fromEnv = process.env.OPENROUTER_API_KEY?.trim();
  if (fromEnv) return fromEnv;
  return readKeyFromPortfolioEnv();
}

export function llmEvalEnabled(): boolean {
  return process.env.COMBO_X_LLM_EVAL === "1" && Boolean(resolveOpenRouterKey());
}

export function evalModel(): string {
  return process.env.COMBO_X_LLM_EVAL_MODEL?.trim() || DEFAULT_EVAL_MODEL;
}

export function evalMaxUsd(): number {
  const n = Number(process.env.COMBO_X_LLM_EVAL_MAX_USD ?? "0.5");
  return Number.isFinite(n) ? n : 0.5;
}
