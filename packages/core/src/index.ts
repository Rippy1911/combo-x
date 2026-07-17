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
export {
  detectChatSecrets,
  assignUniqueLabels,
  embedSecretsInMessage,
  maskSecretValue,
} from "./vault/chatSecrets.js";
export type { ChatSecretHit, ChatSecretEmbed, ChatSecretKind } from "./vault/chatSecrets.js";

export {
  extractProductsFromOrderCsv,
  parseCsv,
  wantsProductListFromCsv,
} from "./local/csvProducts.js";
export type { CsvProductRow } from "./local/csvProducts.js";

export { OpenRouterClient, LlmError, parseSse, extractReasoningText } from "./llm/openrouter.js";
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

export { SkillStore, seedSkillDefinitions, SEED_REVISION } from "./skills/store.js";
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
  ChatPreviewPayload,
} from "./agent/loop.js";
export {
  leanHistory,
  historyFromUiTurns,
  redactToolResultSnippet,
  scrubDataUrls,
} from "./agent/leanHistory.js";
export type { UiHistoryTurn } from "./agent/leanHistory.js";

export {
  DEFAULT_VISION_SETTINGS,
  VISION_STORAGE_KEYS,
  mergeVisionSettings,
  loadVisionSettingsFromStorage,
  persistVisionSettings,
} from "./vision/settings.js";
export type { VisionSettings, ImageDetail } from "./vision/settings.js";
export {
  promoteScreenshotToVision,
  screenshotToolStub,
  visionPartsFromPending,
  dataUrlByteLength,
} from "./vision/promote.js";
export type { PendingVision, PromoteResult } from "./vision/promote.js";
export {
  buildAnnotateScreenshotHtml,
  validatePreviewCss,
  isSafeDataUrlForSrcDoc,
  PREVIEW_STYLE_ID,
} from "./vision/annotateHtml.js";
export type { AnnotateMarker, AnnotateHighlight } from "./vision/annotateHtml.js";
export {
  embedAttachmentsInHtml,
  extractAttachmentPlaceholders,
  appendAttachmentGallery,
} from "./vision/embedAttachments.js";
export {
  resolveVisionCapability,
  modalitySupportsVision,
  presetVisionFlag,
  UX_VISION_WORKER_SYSTEM,
} from "./vision/capability.js";
export type { VisionCapability } from "./vision/capability.js";
export { chatArtifactSandbox, isSafeChatArtifactSandbox } from "./vision/sandbox.js";

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
export {
  githubRestTemplate,
  uploadsRestTemplate,
  nsFoodRestTemplate,
} from "./connectors/templates.js";
export {
  publishUpload,
  dataUrlToBytes,
  DEFAULT_UPLOADS_BASE,
} from "./uploads/publish.js";
export type { PublishUploadInput, PublishUploadResult } from "./uploads/publish.js";
export {
  buildMapHtml,
  fetchMapStyleJson,
  MAP_STYLE_URLS,
} from "./maps/buildMapHtml.js";
export type { MapMarker, BuildMapHtmlInput } from "./maps/buildMapHtml.js";

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
  PACK_SKILL_NAMES,
} from "./tools/promptCatalog.js";
export { CustomToolStore, runCustomTool } from "./tools/customStore.js";
export type { CustomTool, CustomToolKind } from "./tools/customStore.js";

export { CORE_TOOL_NAMES, pickToolsForGoal } from "./tools/pickTools.js";
export type { ToolPickerLlm } from "./tools/pickTools.js";

export {
  ALWAYS_ON_TOOL_NAMES,
  FORCE_ATTACH_TOOL_NAMES,
  SKILL_GATED_TOOL_NAMES,
  SKILL_META_TOOLS,
  TOOL_PACKS,
  isAlwaysOnTool,
  isSkillGatedTool,
  packForTool,
  initialActiveTools,
  ensureForceAttachTools,
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
export { compareTasksByOrder, taskProgress } from "./tasks/store.js";
export { formatOpenTasksBlock, pickOpenTasksForInject } from "./tasks/inject.js";

export {
  DEFAULT_MODEL,
  DEFAULT_WORKER_MODEL,
  LEGACY_BAD_MODELS,
  MODEL_PRESETS,
  normalizeModelId,
} from "./models.js";
export type { ModelPreset } from "./models.js";

export {
  SessionStore,
  cloneJsonSafe,
  sanitizeSessionTools,
  sanitizeSessionBlocks,
  slimRunContextForStorage,
} from "./sessions/store.js";
export type {
  ChatSession,
  SessionMessage,
  SessionArtifactPayload,
  SessionRunContext,
  SessionTurnBlock,
} from "./sessions/store.js";

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
  ApprovalPolicyStore,
  targetKeyFromArgs,
  policyMatches,
} from "./local/approvalPolicy.js";
export type { ApprovalPolicy } from "./local/approvalPolicy.js";

export {
  ChangeLogStore,
  computeUpsertDelta,
} from "./local/changeLog.js";
export type { ChangeLogEntry, ChangeOp, UpsertDelta } from "./local/changeLog.js";

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
