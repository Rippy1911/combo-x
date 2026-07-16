/** Recursive character chunker (portable; no pglite). */

const SEPARATORS = ["\n\n\n", "\n\n", "\n", ". ", "? ", "! ", " ", ""];

export const RAG_DEFAULT_CHUNK_SIZE = 800;
export const RAG_DEFAULT_OVERLAP = 80;

function splitRecursive(text: string, max: number, separators: string[], depth: number): string[] {
  if (text.length <= max || depth >= separators.length) return [text];
  const sep = separators[depth]!;
  if (sep === "") {
    const out: string[] = [];
    for (let i = 0; i < text.length; i += max) out.push(text.slice(i, i + max));
    return out;
  }
  const parts = text.split(sep);
  if (parts.length <= 1) return splitRecursive(text, max, separators, depth + 1);
  const splitParts: string[] = [];
  for (const part of parts) {
    if (part.length === 0) continue;
    splitParts.push(...splitRecursive(part, max, separators, depth + 1));
  }
  const merged: string[] = [];
  let cur = "";
  for (const part of splitParts) {
    const candidate = cur ? cur + sep + part : part;
    if (candidate.length > max && cur) {
      merged.push(cur);
      cur = part;
    } else {
      cur = candidate;
    }
  }
  if (cur) merged.push(cur);
  return merged;
}

function applyOverlap(chunks: string[], overlap: number, max: number): string[] {
  if (overlap <= 0 || chunks.length <= 1) return chunks;
  const result = [chunks[0]!];
  for (let i = 1; i < chunks.length; i++) {
    const prev = chunks[i - 1]!;
    const tail = prev.slice(Math.max(0, prev.length - Math.min(overlap, prev.length)));
    const combined = tail + chunks[i];
    result.push(combined.length > max + overlap ? combined.slice(0, max + overlap) : combined);
  }
  return result;
}

export function chunkText(
  text: string,
  options: { maxChunkSize?: number; overlap?: number } = {},
): string[] {
  const max = options.maxChunkSize ?? RAG_DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap ?? RAG_DEFAULT_OVERLAP;
  const trimmed = text.replace(/\r\n/g, "\n").trim();
  if (!trimmed) return [];
  const raw = splitRecursive(trimmed, max, SEPARATORS, 0).filter((c) => c.trim().length > 0);
  return applyOverlap(raw, overlap, max);
}
