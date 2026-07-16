import type { McpConnector, SecretRef } from "@combo-x/core";

function toHeaderValue(value: unknown): string | SecretRef | undefined {
  if (typeof value !== "string") return undefined;
  if (value.startsWith("{vault:") && value.endsWith("}")) {
    return { vaultLabel: value.slice(7, -1) };
  }
  return value;
}

function walkHeaders(obj: Record<string, unknown>): Record<string, string | SecretRef> {
  const out: Record<string, string | SecretRef> = {};
  for (const [k, v] of Object.entries(obj)) {
    const hv = toHeaderValue(v);
    if (hv != null) out[k] = hv;
  }
  return out;
}

/** Build an MCP connector from sanitized parseMcpDefinition JSON. */
export function mcpConnectorFromSanitized(
  sanitizedDef: string,
  name: string,
  id?: string,
): McpConnector | { error: string } {
  try {
    const parsed = JSON.parse(sanitizedDef) as Record<string, unknown>;

    let url = "";
    let headers: Record<string, string | SecretRef> = {};
    let transport: "http" | "sse" = "http";

    if (typeof parsed.url === "string") {
      url = parsed.url;
      headers = walkHeaders((parsed.headers as Record<string, unknown>) ?? {});
      if (parsed.transport === "sse") transport = "sse";
    } else if (parsed.mcpServers && typeof parsed.mcpServers === "object") {
      const servers = parsed.mcpServers as Record<string, Record<string, unknown>>;
      const firstKey = Object.keys(servers)[0];
      if (!firstKey) return { error: "no mcpServers entry found" };
      const srv = servers[firstKey]!;
      if (srv.command) {
        return { error: "stdio MCP not supported in extension — use HTTP url transport" };
      }
      url = String(srv.url ?? "");
      headers = walkHeaders((srv.headers ?? srv.env ?? {}) as Record<string, unknown>);
      if (srv.transport === "sse") transport = "sse";
    } else {
      return { error: "unrecognized MCP JSON — need top-level url or mcpServers" };
    }

    if (!url.trim()) return { error: "MCP url missing" };

    return {
      id: id ?? crypto.randomUUID(),
      kind: "mcp",
      name: name.trim() || "MCP connector",
      transport,
      url: url.trim(),
      headers,
    };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
