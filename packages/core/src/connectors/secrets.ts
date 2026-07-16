/** Detect and sanitize secret-like values in MCP / connector JSON definitions. */

export interface ParsedSecret {
  suggestedLabel: string;
  value: string;
  path: string;
}

export interface ParseMcpDefinitionResult {
  sanitizedDef: string;
  secrets: ParsedSecret[];
}

const SENSITIVE_KEY =
  /password|api[_-]?key|token|authorization|secret/i;
const BEARER_RE = /^Bearer\s+\S+/i;
const SK_PREFIX_RE = /^sk-[a-zA-Z0-9_-]{8,}/;
const LONG_HEX_RE = /^[0-9a-fA-F]{32,}$/;
const LONG_B64_RE = /^[A-Za-z0-9+/]{40,}={0,2}$/;

function isSecretValue(value: string): boolean {
  const v = value.trim();
  if (!v || v.length < 8) return false;
  if (BEARER_RE.test(v)) return true;
  if (SK_PREFIX_RE.test(v)) return true;
  if (LONG_HEX_RE.test(v)) return true;
  if (LONG_B64_RE.test(v)) return true;
  return false;
}

function shouldRedactKey(key: string, value: string): boolean {
  if (SENSITIVE_KEY.test(key) && value.trim().length > 0) return true;
  return isSecretValue(value);
}

function pathSegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_|_$/g, "").toLowerCase();
}

function suggestedLabelFromPath(path: string): string {
  const parts = path.split(".").filter(Boolean).map(pathSegment);
  const tail = parts.slice(-2).join("_") || "secret";
  return tail.replace(/^_+|_+$/g, "") || "secret";
}

function walk(
  value: unknown,
  path: string,
  secrets: ParsedSecret[],
): unknown {
  if (value == null) return value;
  if (Array.isArray(value)) {
    return value.map((item, i) => walk(item, path ? `${path}.${i}` : String(i), secrets));
  }
  if (typeof value !== "object") return value;

  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if (typeof child === "string" && shouldRedactKey(key, child)) {
      const label = suggestedLabelFromPath(childPath);
      secrets.push({ suggestedLabel: label, value: child, path: childPath });
      out[key] = `{vault:${label}}`;
    } else {
      out[key] = walk(child, childPath, secrets);
    }
  }
  return out;
}

/** Parse raw MCP JSON and extract secret-like values into vault placeholders. */
export function parseMcpDefinition(raw: string): ParseMcpDefinitionResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { sanitizedDef: "", secrets: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    const secrets: ParsedSecret[] = [];
    const lines = trimmed.split("\n");
    const sanitizedLines = lines.map((line, i) => {
      const kv = line.match(/^\s*([^:=]+)[:=]\s*(.+)\s*$/);
      if (!kv) return line;
      const key = kv[1]!.trim();
      const value = kv[2]!.trim().replace(/^["']|["']$/g, "");
      if (!shouldRedactKey(key, value)) return line;
      const path = String(i);
      const label = suggestedLabelFromPath(`${pathSegment(key)}_${path}`);
      secrets.push({ suggestedLabel: label, value, path });
      return `${key}: {vault:${label}}`;
    });
    return { sanitizedDef: sanitizedLines.join("\n"), secrets };
  }

  const secrets: ParsedSecret[] = [];
  const sanitized = walk(parsed, "", secrets);
  return { sanitizedDef: JSON.stringify(sanitized, null, 2), secrets };
}
