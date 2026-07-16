/**
 * Page extensions (browser userscripts) — MAIN-world inject only.
 * Isolated data plane: combo_x_page_ext_* — never opens combo sessions/vault/views.
 */

export type PageExtApproval = "draft" | "approved" | "revoked";

/** Channels the page script may export; agent must configure explicitly. */
export type PageExtBridgeSpec = {
  /** Allowed export channel names (postMessage). Empty = no exports accepted. */
  exportChannels: string[];
  /** Allow isolated KV storage ops for this extension (namespaced by script id). */
  allowStorage?: boolean;
  /** Max JSON payload bytes for a single export/storage value (default 64_000). */
  maxPayloadBytes?: number;
};

export type PageExtension = {
  id: string;
  name: string;
  description?: string;
  /** JS source run in page MAIN world with ComboX API. */
  source: string;
  match: { patterns: string[] };
  enabled: boolean;
  runAt: "document_idle" | "document_end" | "document_start";
  /** Always MAIN — never isolated (no chrome.*). */
  world: "MAIN";
  approval: PageExtApproval;
  version: number;
  createdAt: string;
  updatedAt: string;
  createdBy: "agent" | "user";
  createdInSessionId?: string;
  approvedAt?: string;
  approvedBy?: "user" | "agent";
  lastInjectedAt?: string;
  lastInjectedUrl?: string;
  /** Null/undefined = no bridge out of the page. */
  bridge?: PageExtBridgeSpec | null;
  /** SHA-256 hex of source at last approve (traceability). */
  sourceHash?: string;
  /** When true, SW auto-injects on matching navigations (default false). */
  autoInject?: boolean;
};

export type PageExtAuditAction =
  | "create"
  | "update"
  | "enable"
  | "disable"
  | "approve"
  | "revoke"
  | "inject"
  | "bridge_set"
  | "bridge_clear"
  | "storage_set"
  | "storage_delete"
  | "export"
  | "data_clear"
  | "delete";

export type PageExtAuditEntry = {
  id: string;
  at: string;
  extensionId: string;
  action: PageExtAuditAction;
  actor: "agent" | "user" | "system" | "page";
  sessionId?: string;
  runId?: string;
  pageUrl?: string;
  tabId?: number;
  detail?: Record<string, unknown>;
};

/** Isolated KV row — only accessible via bridge / agent tools, not combo DB APIs. */
export type PageExtDataRow = {
  id: string; // `${extensionId}::${key}`
  extensionId: string;
  key: string;
  value: unknown;
  updatedAt: string;
};
