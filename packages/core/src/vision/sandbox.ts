/**
 * ChatArtifact iframe sandbox policy.
 * Interactive demos may use allow-scripts but MUST NEVER pair with allow-same-origin
 * (that would let untrusted HTML escape the sandbox into the extension origin).
 */

export function chatArtifactSandbox(interactive: boolean): string {
  return interactive ? "allow-scripts" : "";
}

/** True when sandbox string is safe for ChatArtifact. */
export function isSafeChatArtifactSandbox(sandbox: string): boolean {
  const tokens = sandbox
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (tokens.includes("allow-same-origin") && tokens.includes("allow-scripts")) {
    return false;
  }
  if (tokens.includes("allow-top-navigation") || tokens.includes("allow-popups")) {
    return false;
  }
  for (const t of tokens) {
    if (t !== "allow-scripts") return false;
  }
  return true;
}
