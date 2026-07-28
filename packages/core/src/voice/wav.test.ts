import { describe, expect, it } from "vitest";
import { concatFloat32, downsampleTo16k, encodeWav16 } from "./wav.js";

describe("encodeWav16", () => {
  it("writes a valid RIFF/WAVE header and data size", () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1]);
    const buf = encodeWav16(samples, 16_000);
    const view = new DataView(buf);
    const ascii = (o: number, n: number) =>
      String.fromCharCode(...Array.from({ length: n }, (_, i) => view.getUint8(o + i)));

    expect(ascii(0, 4)).toBe("RIFF");
    expect(ascii(8, 4)).toBe("WAVE");
    expect(ascii(12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(samples.length * 2);
    expect(buf.byteLength).toBe(44 + samples.length * 2);
  });

  it("clamps out-of-range samples", () => {
    const buf = encodeWav16(new Float32Array([2, -2]));
    const view = new DataView(buf);
    expect(view.getInt16(44, true)).toBe(0x7fff);
    expect(view.getInt16(46, true)).toBe(-0x8000);
  });
});

describe("concatFloat32", () => {
  it("concatenates chunks", () => {
    const out = concatFloat32([Float32Array.of(1, 2), Float32Array.of(3)]);
    expect(Array.from(out)).toEqual([1, 2, 3]);
  });
});

describe("downsampleTo16k", () => {
  it("is identity at 16 kHz", () => {
    const input = Float32Array.of(0.1, 0.2, 0.3);
    expect(downsampleTo16k(input, 16_000)).toBe(input);
  });

  it("produces expected length for 48 kHz", () => {
    const input = new Float32Array(4800);
    const out = downsampleTo16k(input, 48_000);
    expect(out.length).toBe(1600);
  });
});
