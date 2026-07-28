/**
 * Client for the jarvisd native-messaging daemon.
 * Chrome native messaging owns the 4-byte length framing; this module
 * speaks the JSON request/response envelope and client-side pre-checks.
 */

import {
  checkMacPath,
  DEFAULT_MAC_ROOTS,
} from "./safety.js";

export const JARVIS_NATIVE_HOST = "studio.nextsolutions.jarvisd";

export const MAC_TOOL_NAMES = [
  "mac_ui_tree",
  "mac_screenshot",
  "mac_click",
  "mac_type",
  "mac_key",
  "mac_apps",
  "mac_focus",
  "mac_list_dir",
  "mac_read_file",
  "index_dir",
  "ambient_recall",
] as const;

export type MacToolName = (typeof MAC_TOOL_NAMES)[number];

export const MAC_NAMED_KEYS: ReadonlySet<string> = new Set([
  "return",
  "enter",
  "tab",
  "space",
  "escape",
  "esc",
  "delete",
  "backspace",
  "up",
  "down",
  "left",
  "right",
  "home",
  "end",
  "pageup",
  "pagedown",
  "f1",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f7",
  "f8",
  "f9",
  "f10",
  "f11",
  "f12",
]);

const MODIFIER_TOKENS = new Set([
  "cmd",
  "command",
  "ctrl",
  "control",
  "alt",
  "option",
  "shift",
  "fn",
]);

const MAC_TOOL_SET = new Set<string>(MAC_TOOL_NAMES);

export interface JarvisNativeRequest {
  id: string;
  op: string;
  args: Record<string, unknown>;
}

export interface JarvisNativeResponse {
  id: string;
  ok: boolean;
  data?: unknown;
  error?: string;
}

export interface JarvisNativePort {
  readonly connected: boolean;
  send(op: string, args?: Record<string, unknown>): Promise<JarvisNativeResponse>;
}

export interface MacToolDeps {
  port: JarvisNativePort | null;
  roots?: readonly string[];
  home?: string;
}

export function isMacToolName(name: string): name is MacToolName {
  return MAC_TOOL_SET.has(name);
}

export function macToolOp(name: MacToolName): string {
  return name.startsWith("mac_") ? name.slice(4) : name;
}

export function parseKeyCombo(
  combo: string,
): { ok: true; modifiers: string[]; key: string } | { ok: false; error: string } {
  const raw = combo?.trim();
  if (!raw) return { ok: false, error: "bad_request:combo" };
  const parts = raw.split("+").map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return { ok: false, error: "bad_request:combo" };

  const modifiers: string[] = [];
  let key: string | undefined;
  for (let i = 0; i < parts.length; i++) {
    const tok = parts[i]!.toLowerCase();
    const isLast = i === parts.length - 1;
    if (!isLast) {
      if (!MODIFIER_TOKENS.has(tok)) {
        return { ok: false, error: "bad_request:combo" };
      }
      modifiers.push(tok);
      continue;
    }
    if (MODIFIER_TOKENS.has(tok)) {
      return { ok: false, error: "bad_request:combo" };
    }
    if (MAC_NAMED_KEYS.has(tok)) {
      key = tok;
    } else if (/^[a-z0-9]{1,12}$/i.test(tok)) {
      key = tok;
    } else {
      return { ok: false, error: "bad_request:combo" };
    }
  }
  if (!key) return { ok: false, error: "bad_request:combo" };
  return { ok: true, modifiers, key };
}

export function describeMacError(error: string): string {
  switch (error) {
    case "unavailable:accessibility":
      return "Accessibility permission required — grant Access for Assistive Devices in System Settings → Privacy & Security → Accessibility";
    case "unavailable:screen_recording":
      return "Screen Recording permission required — grant it in System Settings → Privacy & Security → Screen Recording";
    case "denied:sensitive_app":
      return "refused: sensitive app (password manager / terminal / banking)";
    case "denied:path":
      return "refused: path outside the allowed roots";
    default:
      return error;
  }
}

function toolTimeoutMs(name: MacToolName): number {
  if (name === "index_dir") return 30_000;
  if (name === "mac_screenshot") return 45_000;
  return 20_000;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | { __timeout: true }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ __timeout: true }>((resolve) => {
    timer = setTimeout(() => resolve({ __timeout: true }), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer != null) clearTimeout(timer);
  }) as Promise<T | { __timeout: true }>;
}

function precheck(
  name: MacToolName,
  args: Record<string, unknown>,
  deps: MacToolDeps,
): { ok: true; args: Record<string, unknown> } | { ok: false; error: string } {
  if (name === "mac_list_dir" || name === "mac_read_file" || name === "index_dir") {
    const path = typeof args.path === "string" ? args.path : "";
    const checked = checkMacPath(path, deps.roots ?? DEFAULT_MAC_ROOTS, deps.home);
    if (!checked.ok) return { ok: false, error: checked.error };
    return { ok: true, args: { ...args, path: checked.path } };
  }

  if (name === "mac_type") {
    const text = typeof args.text === "string" ? args.text : "";
    if (!text.trim()) return { ok: false, error: "bad_request:text" };
    return { ok: true, args };
  }

  if (name === "mac_click") {
    const hasIndex =
      typeof args.index === "number" &&
      Number.isInteger(args.index) &&
      args.index >= 0;
    const point = args.point;
    const hasPoint =
      point != null &&
      typeof point === "object" &&
      typeof (point as { x?: unknown }).x === "number" &&
      typeof (point as { y?: unknown }).y === "number";
    if (!hasIndex && !hasPoint) {
      return { ok: false, error: "bad_request:click" };
    }
    return { ok: true, args };
  }

  if (name === "mac_key") {
    const combo = typeof args.combo === "string" ? args.combo : "";
    const parsed = parseKeyCombo(combo);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    return { ok: true, args };
  }

  return { ok: true, args };
}

export async function runMacTool(
  name: string,
  args: Record<string, unknown>,
  deps: MacToolDeps,
): Promise<{ ok: boolean; [k: string]: unknown }> {
  try {
    if (!isMacToolName(name)) {
      return { ok: false, error: `unknown mac tool: ${name}` };
    }
    const port = deps.port;
    if (port == null || !port.connected) {
      return {
        ok: false,
        error: "jarvisd not connected — install native/jarvisd (see docs/JARVIS.md)",
      };
    }

    const checked = precheck(name, args, deps);
    if (!checked.ok) {
      return { ok: false, error: describeMacError(checked.error) };
    }

    const op = macToolOp(name);
    const raced = await withTimeout(
      port.send(op, checked.args),
      toolTimeoutMs(name),
    );
    if (raced && typeof raced === "object" && "__timeout" in raced) {
      return { ok: false, error: "timeout" };
    }
    const resp = raced as JarvisNativeResponse;
    if (!resp.ok) {
      return {
        ok: false,
        error: describeMacError(resp.error || "unknown"),
      };
    }
    const data = resp.data;
    if (data != null && typeof data === "object" && !Array.isArray(data)) {
      return { ok: true, ...(data as Record<string, unknown>) };
    }
    return { ok: true, data };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
