/** Publish files to ns-fc-uploads (public /upload or protected /v2/upload). */

export const DEFAULT_UPLOADS_BASE = "https://uploads.nextsolutions.studio";

export type PublishUploadInput = {
  /** Defaults to DEFAULT_UPLOADS_BASE */
  baseUrl?: string;
  filename: string;
  /** UTF-8 text or binary */
  body: string | Uint8Array | Blob;
  contentType?: string;
  workspaceId?: string;
  appName?: string;
  /** When set, uses POST /v2/upload with Bearer auth */
  bearerToken?: string;
  /** Optional subpath for protected tier */
  path?: string;
};

export type PublishUploadResult =
  | {
      ok: true;
      file_url: string;
      sha256?: string;
      size_bytes?: number;
      dedup?: boolean;
      tier: "public" | "protected";
    }
  | { ok: false; error: string };

function guessContentType(filename: string, explicit?: string): string {
  if (explicit) return explicit;
  const lower = filename.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "text/html; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".csv")) return "text/csv; charset=utf-8";
  if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".pdf")) return "application/pdf";
  return "application/octet-stream";
}

function toBlob(body: string | Uint8Array | Blob, contentType: string): Blob {
  if (body instanceof Blob) return body;
  if (typeof body === "string") return new Blob([body], { type: contentType });
  // Copy into a fresh ArrayBuffer for BlobPart typing across TS DOM libs.
  const ab = new ArrayBuffer(body.byteLength);
  new Uint8Array(ab).set(body);
  return new Blob([ab], { type: contentType });
}

/** Multipart upload to ns-fc-uploads. Public tier needs no key. */
export async function publishUpload(input: PublishUploadInput): Promise<PublishUploadResult> {
  const base = (input.baseUrl ?? DEFAULT_UPLOADS_BASE).replace(/\/$/, "");
  const filename = input.filename.trim() || "file.bin";
  const contentType = guessContentType(filename, input.contentType);
  const workspaceId = (input.workspaceId ?? "combo-x").trim() || "combo-x";
  const appName = (input.appName ?? "combo-x").trim() || "combo-x";
  const protectedTier = Boolean(input.bearerToken?.trim());
  const url = protectedTier ? `${base}/v2/upload` : `${base}/upload`;

  try {
    const form = new FormData();
    form.append("file", toBlob(input.body, contentType), filename);
    if (protectedTier && input.path?.trim()) {
      form.append("path", input.path.trim());
    }

    const headers: Record<string, string> = {
      "X-FC-Workspace-Id": workspaceId,
      "X-FC-App-Name": appName,
    };
    if (protectedTier) {
      const tok = input.bearerToken!.trim();
      headers.Authorization = /^Bearer\s/i.test(tok) ? tok : `Bearer ${tok}`;
    }

    const res = await fetch(url, { method: "POST", headers, body: form });
    const text = await res.text();
    let data: unknown = text;
    try {
      data = JSON.parse(text);
    } catch {
      /* plain */
    }

    if (!res.ok) {
      const snippet =
        typeof data === "object" && data && "error" in data
          ? String((data as { error: unknown }).error)
          : text.slice(0, 240);
      return { ok: false, error: `upload ${res.status}: ${snippet}` };
    }

    const obj = data as {
      ok?: boolean;
      file_url?: string;
      sha256?: string;
      size_bytes?: number;
      dedup?: boolean;
      error?: string;
      message?: string;
    };
    if (obj.ok === false || !obj.file_url) {
      return {
        ok: false,
        error: obj.error || obj.message || "upload response missing file_url",
      };
    }
    return {
      ok: true,
      file_url: obj.file_url,
      sha256: obj.sha256,
      size_bytes: obj.size_bytes,
      dedup: obj.dedup,
      tier: protectedTier ? "protected" : "public",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Decode a data URL to bytes + mime (for attachment publish). */
export function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/i.exec(dataUrl);
  if (!m) return null;
  const mime = m[1] || "application/octet-stream";
  const b64 = m[2];
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return { bytes, mime };
  } catch {
    return null;
  }
}
