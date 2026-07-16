export { getProtocolVersion, PROTOCOL_VERSION } from "./protocol/messages.js";
export type {
  BrowserToolName,
  ContentRequest,
  ContentResponse,
  RuntimeMessage,
} from "./protocol/messages.js";
export {
  BrowserToolNameSchema,
  ContentRequestSchema,
  ContentResponseSchema,
  RuntimeMessageSchema,
} from "./protocol/messages.js";

export { Vault, VaultLockedError, VaultSealedError, VAULT_KDF_ITERATIONS } from "./vault/vault.js";

export {
  OpenRouterClient,
  LlmError,
  parseSse,
} from "./llm/openrouter.js";
export type {
  ChatMessage,
  ChatResult,
  LlmUsage,
  ToolCall,
  ToolDefinition,
  OpenRouterOptions,
} from "./llm/openrouter.js";

export { MemoryStore, rankMemories } from "./memory/store.js";
export type { MemoryEntry, MemoryKind } from "./memory/store.js";

export { AGENT_TOOLS, parseToolArguments, toolArgsToContentRequest } from "./browser/tools.js";
export { handleContentRequest } from "./browser/content-handlers.js";

export { AgentLoop } from "./agent/loop.js";
export type {
  AgentEvent,
  AgentRunOptions,
  AgentRunResult,
  BrowserBridge,
} from "./agent/loop.js";
