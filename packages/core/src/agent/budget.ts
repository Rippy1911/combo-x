/** Budget mode — minimize orchestrator tokens/steps. */

export type AgentBudgetMode = "normal" | "budget";

export const BUDGET_MAX_STEPS = 16;
export const BUDGET_GET_PAGE_CHARS = 2_200;
export const NORMAL_GET_PAGE_CHARS = 12_000;

export const BUDGET_SYSTEM_ADDON = `BUDGET MODE (strict — minimize tokens & steps):
- Prefer page_digest over get_page. get_page mode=full is REJECTED.
- Prefer scrape_pdps for many SAPs/URLs (one tool turn). Prefer ensure_scrape_table BEFORE first navigate, upsert every row.
- Prefer extract / query_all / find_text with tight selectors over dumping page text.
- Prefer parse_data (cheap worker) to structure text/rows — do NOT paste huge text into your own replies.
- For product PDPs: page_digest once per template; navigate via /s/{SAP}; avoid re-reading chrome/nav.
- If attachment already has EANs (invoice PDF), parse_data that text first — only scrape missing carton→retail pairs.
- Prefer login {profile} over manual type_index password flows.
- Report briefly when worker parse_data fails and you fall back.`;

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
