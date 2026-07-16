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
export {
  messageContentAsText,
  stripImageParts,
} from "./llm/openrouter.js";
export type {
  ChatMessage,
  ChatContent,
  ContentPart,
  ChatResult,
  LlmUsage,
  ToolCall,
  ToolDefinition,
  OpenRouterOptions,
} from "./llm/openrouter.js";

export { AttachmentStore } from "./attachments/store.js";
export type { AttachmentRecord } from "./attachments/store.js";
export {
  parseAttachment,
  detectKind,
  formatAttachmentInventory,
  setPdfWorkerSrc,
  ATTACH_MAX_BYTES,
  ATTACH_INLINE_PREVIEW,
} from "./attachments/parse.js";
export type { AttachmentKind, ParseResult } from "./attachments/parse.js";

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
export { leanHistory } from "./agent/leanHistory.js";

export { RagStore } from "./rag/store.js";
export type { RagChunkRow, RagMeta, IndexedFile } from "./rag/store.js";
export {
  grantAndIndex,
  reindexSaved,
  reindexAll,
  indexDirectory,
  pickDirectory,
  ensureDirPermission,
  shouldIndexFile,
  DEFAULT_SKIP_DIRS,
} from "./rag/folder.js";
export type { IndexProgress, IndexOptions } from "./rag/folder.js";
export {
  BUDGET_MAX_STEPS,
  BUDGET_GET_PAGE_CHARS,
  resolveMaxSteps,
  defaultGetPageMaxChars,
  BUDGET_SYSTEM_ADDON,
} from "./agent/budget.js";
export type { AgentBudgetMode } from "./agent/budget.js";
export {
  PageTemplateCache,
  pathKindFromUrl,
  templateKey,
} from "./agent/pageTemplateCache.js";
export type { PageTemplateEntry } from "./agent/pageTemplateCache.js";
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

export {
  ViewStore,
  redactSensitiveFields,
  redactSensitiveDeep,
  siteProfileLabelName,
} from "./local/views.js";
export type { SavedView, ViewChartSpec, ViewSource } from "./local/views.js";

export {
  sortTableRows,
  filterTableRows,
  detectNumericColumns,
  buildBarSeries,
  tableToJson,
} from "./local/table.js";
export type { BarSeriesPoint } from "./local/table.js";

export {
  INSPECTABLE_DBS,
  listObjectStores,
  inspectStore,
} from "./local/idbInspect.js";
export type { InspectRow } from "./local/idbInspect.js";

export {
  ActionLogStore,
  summarizeResult,
  redactToolArgs,
  extractTargetUrl,
  resultOk,
  resultError,
  approvalDecisionFor,
} from "./local/actionLog.js";
export type { ActionLogEntry, ActionApprovalDecision } from "./local/actionLog.js";
