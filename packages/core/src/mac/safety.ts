/**
 * Client-side Mac control safety boundary — deny by default for typing,
 * path allowlist without touching the filesystem.
 */

export const MAC_SENSITIVE_BUNDLE_IDS: readonly string[] = [
  "com.1password.1password",
  "com.agilebits.onepassword7",
  "com.apple.keychainaccess",
  "com.apple.Terminal",
  "com.googlecode.iterm2",
  "dev.warp.Warp-Stable",
  "com.apple.Passwords",
  "com.bitwarden.desktop",
  "com.lastpass.LastPass",
  "org.keepassxc.keepassxc",
  "com.apple.systempreferences",
];

export const MAC_SENSITIVE_NAME_PATTERNS: readonly RegExp[] = [
  /\b(bank|banking|mBank|ING|Revolut|PKO)\b/i,
  /password/i,
  /keychain/i,
  /terminal/i,
  /iterm/i,
  /1password/i,
  /wallet/i,
];

export const DEFAULT_MAC_ROOTS: readonly string[] = [
  "~/projects",
  "~/Documents",
  "~/Downloads",
  "~/Desktop",
];

export interface MacAppRef {
  name?: string | null;
  bundleId?: string | null;
}

export type PathCheck = { ok: true; path: string } | { ok: false; error: string };

const SENSITIVE_BUNDLE_SET = new Set(
  MAC_SENSITIVE_BUNDLE_IDS.map((id) => id.toLowerCase()),
);

export function isSensitiveApp(app: MacAppRef): boolean {
  const bundleId = app.bundleId?.trim();
  if (bundleId && SENSITIVE_BUNDLE_SET.has(bundleId.toLowerCase())) {
    return true;
  }
  const name = app.name?.trim();
  if (name) {
    for (const re of MAC_SENSITIVE_NAME_PATTERNS) {
      if (re.test(name)) return true;
    }
  }
  return false;
}

export function isTypingTargetAllowed(app: MacAppRef): boolean {
  const name = app.name?.trim();
  const bundleId = app.bundleId?.trim();
  if (!name && !bundleId) return false;
  return !isSensitiveApp(app);
}

function resolveHome(home?: string): string | undefined {
  if (home != null && home !== "") return home;
  try {
    const envHome =
      typeof process !== "undefined" && process?.env?.HOME
        ? process.env.HOME
        : undefined;
    if (envHome) return envHome;
  } catch {
    /* browser / sandboxed */
  }
  return undefined;
}

function expandTilde(path: string, home: string): string {
  if (path === "~") return home;
  if (path.startsWith("~/")) return `${home}${path.slice(1)}`;
  return path;
}

/** Pure string path normalize (no filesystem). Returns null if not absolute after expand. */
function normalizePathString(path: string): string | null {
  if (!path.startsWith("/")) return null;
  const parts = path.split("/");
  const out: string[] = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") {
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    if (part.includes("\0")) return null;
    out.push(part);
  }
  return `/${out.join("/")}`;
}

function pathInsideRoot(normalized: string, root: string): boolean {
  return normalized === root || normalized.startsWith(`${root}/`);
}

export function checkMacPath(
  path: string,
  roots: readonly string[],
  home?: string,
): PathCheck {
  if (path == null || String(path).trim() === "") {
    return { ok: false, error: "denied:path" };
  }
  if (path.includes("\0")) {
    return { ok: false, error: "denied:path" };
  }

  const homeDir = resolveHome(home);
  let expanded = path;
  if (path === "~" || path.startsWith("~/")) {
    if (!homeDir) return { ok: false, error: "denied:path" };
    expanded = expandTilde(path, homeDir);
  }

  if (!expanded.startsWith("/")) {
    return { ok: false, error: "denied:path" };
  }

  const normalized = normalizePathString(expanded);
  if (!normalized) {
    return { ok: false, error: "denied:path" };
  }

  const expandedRoots: string[] = [];
  for (const root of roots) {
    let r = root;
    if (r === "~" || r.startsWith("~/")) {
      if (!homeDir) continue;
      r = expandTilde(r, homeDir);
    }
    const nr = normalizePathString(r);
    if (nr) expandedRoots.push(nr);
  }

  for (const root of expandedRoots) {
    if (pathInsideRoot(normalized, root)) {
      return { ok: true, path: normalized };
    }
  }
  return { ok: false, error: "denied:path" };
}

export function isSecureFieldRole(role?: string | null): boolean {
  if (!role) return false;
  const r = role.trim();
  return (
    r === "AXSecureTextField" ||
    r === "AXSecureTextArea" ||
    /securetextfield/i.test(r)
  );
}
