/**
 * Pure helper for setup → sidepanel sync.
 * Tools/approval only replace on explicit Apply; soft sync never stomps the ceiling.
 */
export type SetupApplyOpts = {
  syncApproval?: boolean;
  syncTools?: boolean;
};

export function resolveEnabledToolsFromSetup(input: {
  prev: readonly string[];
  setupTools: readonly string[] | undefined;
  allToolNames: readonly string[];
  opts?: SetupApplyOpts;
}): string[] {
  if (!input.opts?.syncTools || !Array.isArray(input.setupTools)) {
    return [...input.prev];
  }
  const allow = new Set(input.allToolNames);
  return input.setupTools.filter((n) => allow.has(n));
}
