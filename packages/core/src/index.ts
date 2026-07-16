export { getProtocolVersion, PROTOCOL_VERSION, SENSITIVE_TOOLS } from "./protocol/messages.js";
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

export { OpenRouterClient, LlmError, parseSse } from "./llm/openrouter.js";
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

export {
  AGENT_TOOLS,
  parseToolArguments,
  toolArgsToContentRequest,
  rowsToCsv,
} from "./browser/tools.js";
export { handleContentRequest, waitMs } from "./browser/content-handlers.js";

export { AgentLoop } from "./agent/loop.js";
export type {
  AgentEvent,
  AgentRunOptions,
  AgentRunResult,
  BrowserBridge,
  ApprovalMode,
} from "./agent/loop.js";

export {
  DEFAULT_MODEL,
  DEFAULT_WORKER_MODEL,
  LEGACY_BAD_MODELS,
  MODEL_PRESETS,
  normalizeModelId,
} from "./models.js";

export { SessionStore } from "./sessions/store.js";
export type { ChatSession, SessionMessage } from "./sessions/store.js";

export {
  ArtifactStore,
  buildReportHtml,
} from "./local/artifacts.js";
export type { Bookmark, Reminder, ReportArtifact } from "./local/artifacts.js";
