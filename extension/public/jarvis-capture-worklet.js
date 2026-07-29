/**
 * Jarvis mic capture AudioWorklet — must be a real chrome-extension:// file.
 * MV3 CSP (script-src 'self') blocks blob:/data: worklet modules
 * ("Unable to load a worklet's module").
 */
class JarvisCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buf = new Float32Array(0);
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch || ch.length === 0) return true;
    const merged = new Float32Array(this._buf.length + ch.length);
    merged.set(this._buf);
    merged.set(ch, this._buf.length);
    const frame = 1024;
    let offset = 0;
    while (merged.length - offset >= frame) {
      this.port.postMessage(merged.slice(offset, offset + frame));
      offset += frame;
    }
    this._buf = merged.slice(offset);
    return true;
  }
}
registerProcessor("jarvis-capture", JarvisCaptureProcessor);
