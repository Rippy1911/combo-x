/**
 * Detect secret-like substrings in chat composer text and rewrite them to `{vault:label}`
 * before the message is sent / persisted.
 */

export type ChatSecretKind =
  | "openai_sk"
  | "github_pat"
  | "aws_key"
  | "bearer"
  | "kv_line"
  | "long_token"
  | "manual";

export interface ChatSecretHit {
  value: string;
  suggestedLabel: string;
  kind: ChatSecretKind;
  /** First match index in source text. */
  index: number;
}

export interface ChatSecretEmbed {
  label: string;
  value: string;
  /** Short note for the agent context block (optional). */
  useNote?: string;
}

const LABEL_SAFE = /[^a-zA-Z0-9_]+/g;

function slugLabel(raw: string, fallback: string): string {
  const s = raw.replace(LABEL_SAFE, "_").replace(/^_+|_+$/g, "").toLowerCase();
  return s || fallback;
}

function uniquifyLabel(base: string, used: Set<string>): string {
  let label = base || "secret";
  if (!used.has(label)) {
    used.add(label);
    return label;
  }
  let i = 2;
  while (used.has(`${label}_${i}`)) i += 1;
  const next = `${label}_${i}`;
  used.add(next);
  return next;
}

/** Standalone high-signal token patterns (global). */
const TOKEN_PATTERNS: Array<{ re: RegExp; kind: ChatSecretKind; label: string }> = [
  { re: /\bsk-(?:or-|ant-|proj-)?[a-zA-Z0-9_-]{16,}\b/g, kind: "openai_sk", label: "api_key" },
  { re: /\bghp_[a-zA-Z0-9]{36,}\b/g, kind: "github_pat", label: "github_token" },
  { re: /\bgho_[a-zA-Z0-9]{36,}\b/g, kind: "github_pat", label: "github_token" },
  { re: /\bgithub_pat_[a-zA-Z0-9_]{20,}\b/g, kind: "github_pat", label: "github_pat" },
  { re: /\bAKIA[0-9A-Z]{16}\b/g, kind: "aws_key", label: "aws_access_key_id" },
  {
    re: /\bBearer\s+[A-Za-z0-9._\-+=\/]{20,}/gi,
    kind: "bearer",
    label: "bearer_token",
  },
];

const KV_RE =
  /(?:^|[\n\r;\s])(?<key>password|passwd|pass|api[_-]?key|access[_-]?token|secret|authorization|auth[_-]?token|client[_-]?secret|private[_-]?key)\s*[:=]\s*(?:["'](?<q>[^"']{6,})["']|(?<u>[^\s"'`,;]{6,}))/gi;

const LONG_HEX_RE = /\b[0-9a-fA-F]{40,}\b/g;
const LONG_B64_RE = /\b[A-Za-z0-9+/]{48,}={0,2}\b/g;

function pushUnique(
  hits: ChatSecretHit[],
  seenValues: Set<string>,
  value: string,
  suggestedLabel: string,
  kind: ChatSecretKind,
  index: number,
): void {
  const v = value.trim();
  if (!v || v.length < 6) return;
  if (v.startsWith("{vault:")) return;
  if (seenValues.has(v)) return;
  seenValues.add(v);
  hits.push({ value: v, suggestedLabel: slugLabel(suggestedLabel, "secret"), kind, index });
}

/** Scan free text / paste for secret-like values. Dedupes by value. */
export function detectChatSecrets(text: string): ChatSecretHit[] {
  if (!text) return [];
  const hits: ChatSecretHit[] = [];
  const seenValues = new Set<string>();

  for (const { re, kind, label } of TOKEN_PATTERNS) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) != null) {
      let value = m[0]!;
      if (kind === "bearer") {
        const parts = value.split(/\s+/);
        value = parts.length > 1 ? parts.slice(1).join(" ") : value;
      }
      pushUnique(hits, seenValues, value, label, kind, m.index);
    }
  }

  KV_RE.lastIndex = 0;
  let km: RegExpExecArray | null;
  while ((km = KV_RE.exec(text)) != null) {
    const key = km.groups?.key ?? "secret";
    const value = km.groups?.q ?? km.groups?.u ?? "";
    pushUnique(hits, seenValues, value, slugLabel(key, "secret"), "kv_line", km.index);
  }

  for (const { re, label } of [
    { re: LONG_HEX_RE, label: "hex_token" },
    { re: LONG_B64_RE, label: "b64_token" },
  ] as const) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) != null) {
      // Skip if already captured via kv/token patterns
      pushUnique(hits, seenValues, m[0]!, label, "long_token", m.index);
    }
  }

  return hits.sort((a, b) => a.index - b.index);
}

/** Assign unique vault labels, preferring suggested labels and avoiding `reserved`. */
export function assignUniqueLabels(
  hits: ChatSecretHit[],
  reserved: Iterable<string> = [],
): ChatSecretEmbed[] {
  const used = new Set([...reserved].map((s) => s.toLowerCase()).filter(Boolean));
  // Track case-preserving labels separately
  const usedExact = new Set([...reserved].filter(Boolean));
  return hits.map((h) => {
    let base = h.suggestedLabel || "secret";
    let label = base;
    if (usedExact.has(label) || used.has(label.toLowerCase())) {
      label = uniquifyLabel(base, usedExact);
      used.add(label.toLowerCase());
    } else {
      usedExact.add(label);
      used.add(label.toLowerCase());
    }
    return { label, value: h.value };
  });
}

/**
 * Replace secret values with `{vault:label}` (longest values first) and build a context footer.
 */
export function embedSecretsInMessage(
  text: string,
  embeds: ChatSecretEmbed[],
): { text: string; contextBlock: string; replaced: number } {
  if (!embeds.length) return { text, contextBlock: "", replaced: 0 };

  const sorted = [...embeds].sort((a, b) => b.value.length - a.value.length);
  let out = text;
  let replaced = 0;
  for (const e of sorted) {
    if (!e.value || !e.label.trim()) continue;
    if (!out.includes(e.value)) continue;
    const placeholder = `{vault:${e.label.trim()}}`;
    const parts = out.split(e.value);
    if (parts.length > 1) {
      replaced += parts.length - 1;
      out = parts.join(placeholder);
    }
  }

  const lines = embeds.map((e) => {
    const note = e.useNote?.trim() ? ` — ${e.useNote.trim().slice(0, 120)}` : "";
    return `- \`{vault:${e.label}}\`${note}`;
  });
  const contextBlock =
    `VAULT SECRETS EMBEDDED (plaintext values are in the Combo vault only — pass \`{vault:label}\` into type_index / type_text / login / connectors; Combo resolves them before the browser sees plaintext. Do not ask the user to paste them again):\n` +
    lines.join("\n");

  const trimmed = out.trimEnd();
  const withBlock = `${trimmed}\n\n${contextBlock}`;
  return { text: withBlock, contextBlock, replaced };
}

const VAULT_REF_RE = /\{vault:([a-zA-Z0-9_]+)\}/g;

export type GetVaultSecretFn = (label: string) => Promise<string | null>;

/**
 * Expand `{vault:label}` placeholders in tool args (strings, nested objects/arrays).
 * Used so agents can pass vault refs into type_index / login without seeing plaintext.
 */
export async function resolveVaultPlaceholders(
  value: unknown,
  getSecret: GetVaultSecretFn,
): Promise<unknown> {
  if (typeof value === "string") {
    if (!value.includes("{vault:")) return value;
    const exact = /^\{vault:([a-zA-Z0-9_]+)\}$/.exec(value.trim());
    if (exact) {
      const label = exact[1]!;
      const secret = await getSecret(label);
      if (secret == null) throw new Error(`vault secret missing: ${label}`);
      return secret;
    }
    const labels = [...value.matchAll(VAULT_REF_RE)].map((m) => m[1]!);
    let out = value;
    for (const label of [...new Set(labels)]) {
      const secret = await getSecret(label);
      if (secret == null) throw new Error(`vault secret missing: ${label}`);
      out = out.split(`{vault:${label}}`).join(secret);
    }
    return out;
  }
  if (Array.isArray(value)) {
    return Promise.all(value.map((v) => resolveVaultPlaceholders(v, getSecret)));
  }
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = await resolveVaultPlaceholders(v, getSecret);
    }
    return out;
  }
  return value;
}

/** Mask a secret for UI (keep short prefix/suffix). */
export function maskSecretValue(value: string, keep = 3): string {
  if (value.length <= keep * 2 + 1) return "•".repeat(Math.min(8, value.length));
  return `${value.slice(0, keep)}…${value.slice(-keep)}`;
}
