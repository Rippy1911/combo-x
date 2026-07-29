import { describe, expect, it } from "vitest";
import { DEFAULT_SYSTEM } from "./loop.js";

describe("DEFAULT_SYSTEM Combo voice speech rule", () => {
  it("points azure_speech_* at Combo voice and forbids REST connectors", () => {
    expect(DEFAULT_SYSTEM).toMatch(/azure_speech_key/);
    expect(DEFAULT_SYSTEM).toMatch(/Combo voice/i);
    expect(DEFAULT_SYSTEM).toMatch(/Test Speech/);
    expect(DEFAULT_SYSTEM).toMatch(/Never create Azure Speech/i);
    expect(DEFAULT_SYSTEM).toMatch(/save_rest_connector/);
  });
});
