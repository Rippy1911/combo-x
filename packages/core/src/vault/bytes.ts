/** Shared base64 helpers for sealed vault / pack export. */

export function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return btoa(s);
}

export function b64ToBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out as Uint8Array<ArrayBuffer>;
}

export function utf8ToB64(text: string): string {
  return bytesToB64(new TextEncoder().encode(text));
}

export function b64ToUtf8(b64: string): string {
  return new TextDecoder().decode(b64ToBytes(b64));
}
