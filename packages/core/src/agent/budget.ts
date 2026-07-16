/** Budget mode — minimize orchestrator tokens/steps. */

export type AgentBudgetMode = "normal" | "budget";

export const BUDGET_MAX_STEPS = 16;
export const BUDGET_GET_PAGE_CHARS = 2_200;
export const NORMAL_GET_PAGE_CHARS = 12_000;

export const BUDGET_SYSTEM_ADDON = `BUDGET MODE (strict — minimize tokens & steps):
- Prefer page_digest over get_page. Never call get_page with mode=full unless digest failed.
- Prefer extract / query_all / find_text with tight selectors over dumping page text.
- Prefer parse_data (cheap worker) to structure text/rows — do NOT paste huge text into your own replies.
- For product PDPs: page_digest once per template (tool returns template.status=learned|reuse and strips chrome on reuse), then extract EAN / carton EAN / catalog # fields; navigate via /s/{SAP} or search — avoid re-reading chrome/nav.
- Cap tool loops: batch navigations; after 1 successful product pattern, reuse it for the rest.
- If attachment already has EANs (invoice PDF), parse_data that text first — only scrape the shop for missing carton→retail pairs.
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
