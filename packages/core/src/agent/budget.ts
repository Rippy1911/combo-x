/** Budget mode — minimize orchestrator tokens/steps without hiding tools. */

export type AgentBudgetMode = "normal" | "budget";

export const BUDGET_MAX_STEPS = 16;
/** Short page reads in budget — prefer page_digest; not a tool-catalog cut. */
export const BUDGET_GET_PAGE_CHARS = 3_200;
export const NORMAL_GET_PAGE_CHARS = 12_000;
/** Lean chat history cap (prior turns only — never tool schemas / TOOL INDEX). */
export const BUDGET_LEAN_HISTORY_CHARS = 16_000;
export const NORMAL_LEAN_HISTORY_CHARS = 24_000;

/**
 * System addon for budget runs.
 * Hard rule: full TOOL INDEX + ACTIVE schemas stay available — save tokens via
 * page-read discipline and step count, not by inventing missing tools.
 */
export const BUDGET_SYSTEM_ADDON = `BUDGET MODE (minimize tokens & steps — tools stay fully listed):
- Full TOOL INDEX and ACTIVE tool schemas remain available. Do not claim tools are missing or truncated.
- Prefer page_digest over get_page. get_page mode=full is REJECTED (use page_digest or mode=snippet|structure).
- Prefer extract / query_all / find_text with tight selectors over dumping page text.
- Prefer scrape_pdps for many SAPs/URLs (one tool turn). Prefer ensure_scrape_table BEFORE first navigate.
- Prefer parse_data (cheap worker) to structure text/rows — do NOT paste huge text into your replies.
- For product PDPs: page_digest once per template; navigate via /s/{SAP}; avoid re-reading chrome/nav.
- If attachment already has EANs (invoice PDF), parse_data that text first — only scrape missing pairs.
- Prefer login {profile} over manual type_index password flows.
- Keep answers brief; finish in fewer steps.`;

/** Short UI copy for the composer ? popover / Settings. */
export const BUDGET_MODE_HELP = `Budget mode cuts cost/latency without hiding tools:

• Full tool list + schemas still sent (no random tool truncation)
• Caps orchestrator steps (16 vs 32) unless you override Max turns
• Prefers page_digest; rejects get_page mode=full; shortens page text reads
• Slightly tighter chat-history packing (prior turns only)
• System hint: extract/parse_data over dumping whole pages

Normal mode: longer page reads, 32 steps, fuller history. Active agent profiles can override.`;

export function resolveMaxSteps(
  budgetMode: AgentBudgetMode | undefined,
  explicit?: number,
): number {
  if (explicit != null) return explicit;
  return budgetMode === "budget" ? BUDGET_MAX_STEPS : 32;
}

export function defaultGetPageMaxChars(budgetMode: AgentBudgetMode | undefined): number {
  return budgetMode === "budget" ? BUDGET_GET_PAGE_CHARS : NORMAL_GET_PAGE_CHARS;
}

export function leanHistoryMaxChars(budgetMode: AgentBudgetMode | undefined): number {
  return budgetMode === "budget" ? BUDGET_LEAN_HISTORY_CHARS : NORMAL_LEAN_HISTORY_CHARS;
}

export function shouldRejectGetPageFull(
  budgetMode: AgentBudgetMode | undefined,
  args: Record<string, unknown>,
): boolean {
  return budgetMode === "budget" && args.mode === "full";
}

export function preferPageDigest(
  budgetMode: AgentBudgetMode | undefined,
  toolName: string,
  args: Record<string, unknown>,
): boolean {
  if (budgetMode !== "budget") return false;
  if (toolName === "get_page" && (args.mode == null || args.mode === "")) return true;
  return false;
}

export function rewriteGetPageArgs(
  budgetMode: AgentBudgetMode | undefined,
  args: Record<string, unknown>,
): Record<string, unknown> | { error: string } {
  if (shouldRejectGetPageFull(budgetMode, args)) {
    return {
      error:
        "Budget mode rejects get_page mode=full — use page_digest or mode=snippet|structure",
    };
  }
  if (budgetMode === "budget" && preferPageDigest(budgetMode, "get_page", args)) {
    return {
      ...args,
      mode: "snippet",
      maxChars:
        typeof args.maxChars === "number" ? args.maxChars : defaultGetPageMaxChars(budgetMode),
    };
  }
  if (budgetMode === "budget" && args.mode != null && args.mode !== "full") {
    return {
      ...args,
      maxChars:
        typeof args.maxChars === "number" ? args.maxChars : defaultGetPageMaxChars(budgetMode),
    };
  }
  return args;
}
