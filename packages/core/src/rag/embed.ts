/** Deterministic hash embedder + keyword scoring for local RAG (no cloud embed required). */

export const RAG_EMBED_DIMS = 256;

export function mockVector(text: string, dimensions = RAG_EMBED_DIMS): number[] {
  const vec = new Array<number>(dimensions).fill(0);
  const tokens = tokenize(text);
  for (const token of tokens) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = (h >>> 0) % dimensions;
    vec[idx]! += 1;
  }
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dimensions; i++) vec[i]! /= norm;
  return vec;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_/.-]/gu, " ")
    .split(/[\s_/.-]+/)
    .filter((t) => t.length > 1);
}

/** Hybrid: keyword coverage + cosine of hash vectors. */
export function hybridScore(query: string, content: string, contentVec?: number[]): number {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return 0;
  const hay = tokenize(content);
  let hits = 0;
  for (const q of qTokens) {
    if (hay.includes(q)) hits += 1;
    else if (hay.some((h) => h.includes(q) || q.includes(h))) hits += 0.4;
  }
  const kw = hits / qTokens.length;
  const qv = mockVector(query);
  const cv = contentVec ?? mockVector(content);
  const cos = Math.max(0, cosineSimilarity(qv, cv));
  return kw * 0.65 + cos * 0.35;
}
