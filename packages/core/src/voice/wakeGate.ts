export const WAKE_PHRASES: readonly string[] = [
  "hey jarvis",
  "hi jarvis",
  "ok jarvis",
  "hej jarvis",
  "hej dżarwis",
  "hej dzarwis",
  "dżarwis",
  "dzarwis",
  "jarwis",
  "jarvis",
  // UI brand is Combo; strip these from STT when present (acoustic model is still hey_jarvis).
  "hey combo",
  "hi combo",
  "ok combo",
  "hej combo",
  "combo",
  // Azure pl-PL STT renders the spoken name this way — observed in
  // _artifacts/jarvis-azure-verify/result.json. Without these the wake phrase is
  // left glued to the command text.
  "hej jarvez",
  "jarvez",
  "dzarwez",
] as const;

export const WAKE_TOKEN_TTL_MS = 60_000;
export const WAKE_TOKEN_PREFIX = "wk_";

export interface WakeParse {
  armed: boolean;
  command: string;
  matchedPhrase: string | null;
}

function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "");
}

function normalizeForMatch(s: string): string {
  return stripDiacritics(s)
    .toLowerCase()
    .replace(/^[\s.,!?;:'"`]+|[\s.,!?;:'"`]+$/g, "")
    .trim();
}

/** Longest phrase first so "hey jarvis" wins over "jarvis". */
const SORTED_PHRASES = [...WAKE_PHRASES].sort((a, b) => b.length - a.length);

function findPhraseEndInOriginal(original: string, needle: string): number {
  let oi = 0;
  let ni = 0;
  while (oi < original.length && /[\s.,!?;:'"`]/.test(original[oi]!)) oi++;

  while (ni < needle.length && oi < original.length) {
    const ch = original[oi]!;
    if (needle[ni] === " ") {
      if (!/\s/.test(ch)) return -1;
      while (oi < original.length && /\s/.test(original[oi]!)) oi++;
      ni++;
      continue;
    }
    const stripped = stripDiacritics(ch).toLowerCase();
    if (stripped === "") {
      oi++;
      continue;
    }
    if (stripped.length === 1 && stripped === needle[ni]) {
      oi++;
      ni++;
      continue;
    }
    // Multi-char strip (rare); consume sequentially.
    for (const c of stripped) {
      if (ni >= needle.length || c !== needle[ni]) return -1;
      ni++;
    }
    oi++;
  }
  return ni === needle.length ? oi : -1;
}

export function parseWakeUtterance(text: string): WakeParse {
  const trimmed = text.trim();
  if (!trimmed) return { armed: false, command: "", matchedPhrase: null };

  const norm = normalizeForMatch(trimmed);
  for (const phrase of SORTED_PHRASES) {
    const needle = stripDiacritics(phrase).toLowerCase();
    if (norm !== needle) {
      if (!norm.startsWith(needle)) continue;
      const next = norm[needle.length];
      // Phrase must be a prefix boundary (space or punctuation), not e.g. "jarvison".
      if (next !== undefined && !/[\s.,!?;:'"`]/.test(next)) continue;
    }

    const endIdx = findPhraseEndInOriginal(trimmed, needle);
    if (endIdx < 0) continue;
    let command = trimmed.slice(endIdx).trim();
    command = command.replace(/^[,:\-–—]\s*/, "").trim();
    return { armed: true, command, matchedPhrase: phrase };
  }
  return { armed: false, command: "", matchedPhrase: null };
}

export function mintWakeToken(now?: () => number): string {
  const t = (now ?? (() => Date.now()))();
  const rand = Math.floor(Math.random() * 1e9).toString(36);
  return `${WAKE_TOKEN_PREFIX}${t.toString(36)}_${rand}`;
}

export function verifyWakeToken(
  token: string | null | undefined,
  opts?: { ttlMs?: number; now?: () => number },
): boolean {
  if (!token || !token.startsWith(WAKE_TOKEN_PREFIX)) return false;
  const body = token.slice(WAKE_TOKEN_PREFIX.length);
  const us = body.indexOf("_");
  if (us <= 0) return false;
  const tsPart = body.slice(0, us);
  const rand = body.slice(us + 1);
  if (!rand || !/^[0-9a-z]+$/i.test(tsPart)) return false;
  const minted = parseInt(tsPart, 36);
  if (!Number.isFinite(minted)) return false;
  const now = (opts?.now ?? (() => Date.now()))();
  const ttl = opts?.ttlMs ?? WAKE_TOKEN_TTL_MS;
  if (minted > now + 5_000) return false;
  if (now - minted > ttl) return false;
  return true;
}

export function isActuationAllowed(
  input: { source?: string | null; wakeToken?: string | null },
  opts?: { ttlMs?: number; now?: () => number },
): boolean {
  if (input.source !== "voice") return true;
  return verifyWakeToken(input.wakeToken, opts);
}
