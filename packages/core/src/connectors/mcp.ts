import { resolveHeaders, type GetSecretFn } from "./rest.js";
import type { McpConnector } from "./store.js";

type JsonRpcResult =
  | { ok: true; result: unknown }
  | { ok: false; error: string };

let rpcId = 1;

async function jsonRpc(
  connector: McpConnector,
  method: string,
  params: Record<string, unknown>,
  getSecret: GetSecretFn,
): Promise<JsonRpcResult> {
  if (connector.transport === "sse") {
    return { ok: false, error: "SSE MCP transport is not supported in v1 (use transport: http)" };
  }

  try {
    const headers = await resolveHeaders(connector.headers, getSecret);
    const res = await fetch(connector.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...headers,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: rpcId++,
        method,
        params,
      }),
    });
    const text = await res.text();
    let payload: {
      result?: unknown;
      error?: { message?: string; code?: number };
    };
    try {
      payload = JSON.parse(text) as typeof payload;
    } catch {
      return { ok: false, error: `MCP invalid JSON (${res.status}): ${text.slice(0, 200)}` };
    }
    if (!res.ok) {
      return {
        ok: false,
        error: `MCP HTTP ${res.status}: ${payload.error?.message ?? text.slice(0, 200)}`,
      };
    }
    if (payload.error) {
      return { ok: false, error: payload.error.message ?? `MCP error ${payload.error.code ?? ""}` };
    }
    return { ok: true, result: payload.result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function mcpListTools(
  connector: McpConnector,
  getSecret: GetSecretFn,
): Promise<{ ok: true; tools: unknown } | { ok: false; error: string }> {
  const out = await jsonRpc(connector, "tools/list", {}, getSecret);
  if (!out.ok) return out;
  return { ok: true, tools: out.result };
}

export async function mcpCall(
  connector: McpConnector,
  toolName: string,
  args: Record<string, unknown>,
  getSecret: GetSecretFn,
): Promise<{ ok: true; result: unknown } | { ok: false; error: string }> {
  const out = await jsonRpc(
    connector,
    "tools/call",
    { name: toolName, arguments: args },
    getSecret,
  );
  if (!out.ok) return out;
  return { ok: true, result: out.result };
}
