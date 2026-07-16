export type {
  CropRect,
  ParsedDataUrl,
  RecordingSession,
  ScreenshotResult,
} from "./media/capture.js";
export {
  blobToDataUrl,
  buildDataUrl,
  cropDataUrl,
  parseDataUrl,
  stitchTilesVertically,
} from "./media/capture.js";

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
  OpenRouterModelInfo,
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
export type { MemoryEntry, MemoryKind, MemoryScope } from "./memory/store.js";

export { SkillStore, seedSkillDefinitions } from "./skills/store.js";
export type { Skill, SkillScope } from "./skills/store.js";

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
  SubagentEvent,
  RunContextSnapshot,
} from "./agent/loop.js";
export { leanHistory, historyFromUiTurns, redactToolResultSnippet } from "./agent/leanHistory.js";
export type { UiHistoryTurn } from "./agent/leanHistory.js";

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
  shouldRejectGetPageFull,
  preferPageDigest,
  rewriteGetPageArgs,
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

export { ConnectorStore } from "./connectors/store.js";
export type {
  Connector,
  RestConnector,
  McpConnector,
  RestToolSpec,
  SecretRef,
} from "./connectors/store.js";
export { parseMcpDefinition } from "./connectors/secrets.js";
export type { ParsedSecret, ParseMcpDefinitionResult } from "./connectors/secrets.js";
export { resolveHeaders, restRequest } from "./connectors/rest.js";
export type { GetSecretFn, RestRequestOptions } from "./connectors/rest.js";
export { mcpListTools, mcpCall } from "./connectors/mcp.js";
export { githubRestTemplate } from "./connectors/templates.js";

export { AgentProfileStore, resolveAgentProfile } from "./agents/profiles.js";
export type {
  AgentProfile,
  AgentToolMode,
  ResolvedAgentProfile,
  ToolAllowlist,
  ApprovalMode as AgentProfileApprovalMode,
} from "./agents/profiles.js";

export {
  TOOL_CATALOG,
  catalogEntry,
  catalogForPrompt,
  filterToolsByNames,
} from "./tools/catalog.js";
export type { ToolCatalogEntry, ToolGroup } from "./tools/catalog.js";
export {
  formatSkillIndexBlock,
  formatToolSchemaBlock,
  customToolToDefinition,
} from "./tools/promptCatalog.js";
export { CustomToolStore, runCustomTool } from "./tools/customStore.js";
export type { CustomTool, CustomToolKind } from "./tools/customStore.js";

export { CORE_TOOL_NAMES, pickToolsForGoal } from "./tools/pickTools.js";
export type { ToolPickerLlm } from "./tools/pickTools.js";

export {
  ALWAYS_ON_TOOL_NAMES,
  SKILL_GATED_TOOL_NAMES,
  SKILL_META_TOOLS,
  TOOL_PACKS,
  isAlwaysOnTool,
  isSkillGatedTool,
  packForTool,
  initialActiveTools,
  unlockFromHints,
} from "./tools/gating.js";
export type { ToolPackId } from "./tools/gating.js";

export { UsageStore, providerFromModel } from "./usage/store.js";
export type {
  UsageEvent,
  UsageKind,
  UsageListOptions,
  UsageTotals,
  UsageAggregateRow,
  MessageRole,
} from "./usage/store.js";

export { TaskStore } from "./tasks/store.js";
export type { Task, TaskStatus, TaskListOptions } from "./tasks/store.js";
export { formatOpenTasksBlock, pickOpenTasksForInject } from "./tasks/inject.js";

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
  ensureView,
  upsertRows,
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

export { PageExtensionStore } from "./pageExtensions/store.js";
export { urlMatches, patternToRegExp } from "./pageExtensions/match.js";
export type { PageExtMatch } from "./pageExtensions/match.js";
export { runPageExtensionInMainWorld, isOverbroadPattern } from "./pageExtensions/inject.js";
export { sha256Hex } from "./pageExtensions/hash.js";
export type {
  PageExtension,
  PageExtBridgeSpec,
  PageExtAuditEntry,
  PageExtAuditAction,
  PageExtDataRow,
  PageExtApproval,
} from "./pageExtensions/types.js";
