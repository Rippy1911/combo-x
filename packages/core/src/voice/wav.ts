export function encodeWav16(samples: Float32Array, sampleRate = 16_000): ArrayBuffer {
  const n = samples.length;
  const dataBytes = n * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };

  writeStr(0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeStr(36, "data");
  view.setUint32(40, dataBytes, true);

  let o = 44;
  for (let i = 0; i < n; i++) {
    const x = Math.max(-1, Math.min(1, samples[i]!));
    const s = x < 0 ? Math.round(x * 0x8000) : Math.round(x * 0x7fff);
    view.setInt16(o, s, true);
    o += 2;
  }
  return buffer;
}

export function concatFloat32(chunks: readonly Float32Array[]): Float32Array {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Float32Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export function downsampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === 16_000) return input;
  if (inputRate <= 0 || input.length === 0) return new Float32Array(0);
  const ratio = inputRate / 16_000;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const i1 = Math.min(i0 + 1, input.length - 1);
    const t = src - i0;
    out[i] = input[i0]! * (1 - t) + input[i1]! * t;
  }
  return out;
}
