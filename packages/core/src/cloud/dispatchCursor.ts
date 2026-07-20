/**
 * Dispatch a Cursor Cloud Agent on a GitHub repo (autoCreatePR).
 * Uses vault label `cursor_api_key` (aliases below) — never logs the key.
 */

export const CURSOR_VAULT_LABELS = [
  "cursor_api_key",
  "CURSOR_API_KEY",
  "cursor_key",
] as const;

export const DEFAULT_CURSOR_REPO = "Rippy1911/combo-x";
export const DEFAULT_CURSOR_MODEL = "grok-4.5";
export const CURSOR_AGENTS_URL = "https://api.cursor.com/v0/agents";

export type DispatchCursorInput = {
  prompt: string;
  repo?: string;
  model?: string;
  ref?: string;
  name?: string;
  branchName?: string;
};

export type DispatchCursorResult =
  | {
      ok: true;
      agentId: string;
      runId?: string;
      repo: string;
      model: string;
      branchName?: string;
      watchUrl: string;
      note: string;
    }
  | { ok: false; error: string; status?: number };

function slugBranch(title: string): string {
  const slug =
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "task";
  return `cursor/${slug}-${Date.now().toString(36).slice(-5)}`;
}

export async function resolveCursorApiKey(
  getSecret: (label: string) => Promise<string | null>,
): Promise<string | null> {
  for (const label of CURSOR_VAULT_LABELS) {
    const v = await getSecret(label);
    if (v?.trim()) return v.trim();
  }
  return null;
}

export async function dispatchCursorAgent(
  input: DispatchCursorInput,
  getSecret: (label: string) => Promise<string | null>,
  fetchFn: typeof fetch = fetch.bind(globalThis),
): Promise<DispatchCursorResult> {
  const prompt = input.prompt?.trim();
  if (!prompt) return { ok: false, error: "prompt required" };

  const repo = (input.repo?.trim() || DEFAULT_CURSOR_REPO).replace(/^https?:\/\/github\.com\//, "");
  if (!/^[^/\s]+\/[^/\s]+$/.test(repo)) {
    return { ok: false, error: 'repo must be "owner/repo"' };
  }

  const apiKey = await resolveCursorApiKey(getSecret);
  if (!apiKey) {
    return {
      ok: false,
      error:
        "No Cursor API key in vault. Put it under label cursor_api_key (or CURSOR_API_KEY), then retry.",
    };
  }

  const model = input.model?.trim() || DEFAULT_CURSOR_MODEL;
  const ref = input.ref?.trim() || "main";
  const branchName = input.branchName?.trim() || slugBranch(input.name || prompt.split("\n")[0] || "combo-fix");

  const body = {
    prompt: { text: prompt },
    model,
    source: { repository: `https://github.com/${repo}`, ref },
    target: { branchName, autoCreatePr: true },
  };

  const res = await fetchFn(CURSOR_AGENTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const msg =
      (data.error as { message?: string } | undefined)?.message ||
      (typeof data.message === "string" ? data.message : null) ||
      `HTTP ${res.status}`;
    return { ok: false, error: String(msg).slice(0, 300), status: res.status };
  }

  const agentId =
    typeof data.id === "string"
      ? data.id
      : typeof (data as { agent?: { id?: string } }).agent?.id === "string"
        ? (data as { agent: { id: string } }).agent.id
        : "";
  if (!agentId) {
    return { ok: false, error: "Cursor response missing agent id" };
  }

  return {
    ok: true,
    agentId,
    runId: typeof data.runId === "string" ? data.runId : undefined,
    repo,
    model,
    branchName,
    watchUrl: `https://cursor.com/agents?id=${encodeURIComponent(agentId)}`,
    note:
      "Cloud agent started with autoCreatePR. Tell the user to watch the agent/PR, then after merge: pnpm build in combo-x and Reload Temporary Add-on (dist-firefox).",
  };
}
