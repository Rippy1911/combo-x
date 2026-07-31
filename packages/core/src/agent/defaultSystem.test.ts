import { describe, expect, it } from "vitest";
import { DEFAULT_SYSTEM } from "./loop.js";

describe("DEFAULT_SYSTEM Voice mode speech rule", () => {
  it("points azure_speech_* at Voice mode and forbids REST connectors", () => {
    expect(DEFAULT_SYSTEM).toMatch(/azure_speech_key/);
    expect(DEFAULT_SYSTEM).toMatch(/Voice mode|Voice panel/i);
    expect(DEFAULT_SYSTEM).toMatch(/Test Speech/);
    expect(DEFAULT_SYSTEM).toMatch(/Never create Azure Speech/i);
    expect(DEFAULT_SYSTEM).toMatch(/save_rest_connector/);
  });
});
