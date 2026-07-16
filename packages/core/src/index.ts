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
  ConnectorBundle,
  SiteProfile,
  ProfileStore,
} from "./agent/loop.js";

export { RagStore } from "./rag/store.js";
export type { RagChunkRow, RagMeta, IndexedFile } from "./rag/store.js";
export {
  grantAndIndex,
  reindexSaved,
  indexDirectory,
  pickDirectory,
  ensureDirPermission,
  shouldIndexFile,
} from "./rag/folder.js";
export type { IndexProgress } from "./rag/folder.js";
export { chunkText, RAG_DEFAULT_CHUNK_SIZE } from "./rag/chunk.js";
export { hybridScore, mockVector, tokenize } from "./rag/embed.js";

export { ideaforgeSearch, clearIdeaForgeTokenCache } from "./connectors/ideaforge.js";
export type { IdeaForgeConfig, IdeaForgeSearchHit } from "./connectors/ideaforge.js";
export { githubSearchCode, githubGetFile } from "./connectors/github.js";
export type { GitHubConfig, GitHubCodeHit } from "./connectors/github.js";

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
