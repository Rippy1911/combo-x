import { describe, expect, it } from "vitest";
import { AGENT_TOOLS } from "../browser/tools.js";
import {
  ALWAYS_ON_TOOL_NAMES,
  FORCE_ATTACH_TOOL_NAMES,
  SKILL_GATED_TOOL_NAMES,
  TOOL_PACKS,
  effectiveToolHints,
  ensureForceAttachTools,
  initialActiveTools,
  isSkillGatedTool,
  unlockFromHints,
} from "./gating.js";

describe("tool gating", () => {
  it("every AGENT_TOOLS name is always-on or gated", () => {
    const covered = new Set([...ALWAYS_ON_TOOL_NAMES, ...SKILL_GATED_TOOL_NAMES]);
    for (const t of AGENT_TOOLS) {
      expect(covered.has(t.function.name)).toBe(true);
    }
  });

  it("always-on and gated do not overlap", () => {
    const always = new Set(ALWAYS_ON_TOOL_NAMES);
    for (const n of SKILL_GATED_TOOL_NAMES) {
      expect(always.has(n)).toBe(false);
    }
  });

  it("packs match SKILL_GATED_TOOL_NAMES", () => {
    expect([...Object.values(TOOL_PACKS).flat()].sort()).toEqual(
      [...SKILL_GATED_TOOL_NAMES].sort(),
    );
  });

  it("initialActiveTools respects ceiling", () => {
    const ceiling = new Set(["navigate", "page_digest", "scrape_pdps", "skill_search"]);
    const active = initialActiveTools(ceiling);
    expect(active).toContain("navigate");
    expect(active).toContain("skill_search");
    expect(active).not.toContain("scrape_pdps");
  });

  it("ensureForceAttachTools merges Vision Lab + connector setup into non-empty allowlists", () => {
    expect(FORCE_ATTACH_TOOL_NAMES).toContain("ux_critique");
    expect(FORCE_ATTACH_TOOL_NAMES).toContain("ensure_github_connector");
    const next = ensureForceAttachTools(["navigate", "get_page"]);
    expect(next).toContain("navigate");
    expect(next).toContain("ux_critique");
    expect(next).toContain("annotate_screenshot");
    expect(next).toContain("page_css_preview");
    expect(next).toContain("ensure_github_connector");
    expect(ensureForceAttachTools([])).toEqual([]);
  });

  it("connector setup tools are always-on (not skill-gated)", () => {
    expect(ALWAYS_ON_TOOL_NAMES).toContain("ensure_github_connector");
    expect(ALWAYS_ON_TOOL_NAMES).toContain("list_connectors");
    expect(ALWAYS_ON_TOOL_NAMES).toContain("save_rest_connector");
    expect(ALWAYS_ON_TOOL_NAMES).toContain("dispatch_cursor_agent");
    expect(FORCE_ATTACH_TOOL_NAMES).toContain("dispatch_cursor_agent");
    expect(isSkillGatedTool("ensure_github_connector")).toBe(false);
    expect(isSkillGatedTool("dispatch_cursor_agent")).toBe(false);
    expect(isSkillGatedTool("rest_request")).toBe(true);
  });

  it("unlockFromHints expands active set", () => {
    const ceiling = new Set(["navigate", "scrape_pdps", "ensure_scrape_table"]);
    const { active, unlocked } = unlockFromHints(
      ["navigate"],
      [...TOOL_PACKS.scrape],
      ceiling,
    );
    expect(unlocked).toContain("scrape_pdps");
    expect(active).toContain("scrape_pdps");
    expect(isSkillGatedTool("scrape_pdps")).toBe(true);
  });

  it("effectiveToolHints merges live rest pack over stale IDB hints", () => {
    const hints = effectiveToolHints("combo-rest", ["rest_request"]);
    expect(hints).toEqual(expect.arrayContaining([...TOOL_PACKS.rest]));
    expect(hints).toContain("mcp_call");
    expect(effectiveToolHints("custom-skill", ["navigate"])).toEqual(["navigate"]);
  });
});
