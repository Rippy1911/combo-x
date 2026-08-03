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

describe("DEFAULT_SYSTEM verify-before-claim (ns-agent discipline)", () => {
  it("forbids claiming done without tool proof and documents runtime gates", () => {
    expect(DEFAULT_SYSTEM).toMatch(/VERIFY BEFORE CLAIM/);
    expect(DEFAULT_SYSTEM).toMatch(/dialogOpened:false/);
    expect(DEFAULT_SYSTEM).toMatch(/VERIFY BEFORE DONE/);
    expect(DEFAULT_SYSTEM).toMatch(/Never invent page content/);
    expect(DEFAULT_SYSTEM).not.toMatch(/stuck_loop_blocked/);
  });
});
