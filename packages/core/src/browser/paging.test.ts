/**
 * Regression tests for the 2026-08-01 Play Console failure: the agent spent a
 * 48-step budget re-reading nav chrome because page reads were whole-body and
 * truncation was terminal (no offset, no filter, no way to act on a text hit).
 */
import { beforeEach, describe, expect, it } from "vitest";
import { handleContentRequest } from "./content-handlers.js";

/** A console-style page: giant sidebar nav, small main content. */
function renderConsolePage(navLinks = 60): void {
  const nav = Array.from(
    { length: navLinks },
    (_, i) => `<a href="/nav/${i}">Sidebar destination number ${i}</a>`,
  ).join("");
  document.body.innerHTML = `
    <header><a href="/home">Konsola Google Play</a></header>
    <nav aria-label="primary">${nav}</nav>
    <main>
      <h1>Panel</h1>
      <p>Twoja tymczasowa nazwa aplikacji to com.example.app</p>
      <button>Zawartość aplikacji</button>
      <button>Utwórz nową wersję</button>
      <a href="/publishing">Przegląd publikowanych zmian</a>
    </main>
    <footer><a href="/tos">Warunki</a></footer>`;
}

describe("get_page region + paging", () => {
  beforeEach(() => {
    renderConsolePage();
  });

  it("defaults to main content and reports the chrome it skipped", () => {
    const res = handleContentRequest({ op: "get_page" }, document);
    expect(res.ok).toBe(true);
    const data = res.data as {
      text: string;
      region: string;
      chromeSkippedChars?: number;
    };
    expect(data.text).toContain("Twoja tymczasowa nazwa aplikacji");
    expect(data.text).not.toContain("Sidebar destination number 5");
    expect(data.region).toBe("main");
  });

  it("mode=full still includes chrome for the rare case that needs it", () => {
    const res = handleContentRequest({ op: "get_page", mode: "full" }, document);
    const data = res.data as { text: string };
    expect(data.text).toContain("Sidebar destination number 5");
  });

  it("pages through long text with offset/nextOffset instead of dead-ending", () => {
    const body = Array.from({ length: 500 }, (_, i) => `row${String(i).padStart(5, "0")}`).join("");
    document.body.innerHTML = `<main>${body}</main>`;
    const first = handleContentRequest({ op: "get_page", maxChars: 1_000 }, document);
    const a = first.data as {
      text: string;
      totalChars: number;
      nextOffset: number | null;
      hasMore: boolean;
      hint?: string;
    };
    expect(a.text).toHaveLength(1_000);
    expect(a.totalChars).toBe(4_000);
    expect(a.hasMore).toBe(true);
    expect(a.nextOffset).toBe(1_000);
    expect(a.hint).toMatch(/offset:1000/);

    const second = handleContentRequest(
      { op: "get_page", maxChars: 1_000, offset: a.nextOffset! },
      document,
    );
    const b = second.data as { text: string; offset: number; nextOffset: number | null };
    expect(b.offset).toBe(1_000);
    expect(b.nextOffset).toBe(2_000);
    expect(b.text).not.toBe(a.text);
  });

  it("reaches the tail and reports hasMore=false", () => {
    document.body.innerHTML = `<main>${"x".repeat(1_200)}</main>`;
    const res = handleContentRequest({ op: "get_page", maxChars: 1_000, offset: 1_000 }, document);
    const data = res.data as { text: string; hasMore: boolean; nextOffset: number | null };
    expect(data.text).toHaveLength(200);
    expect(data.hasMore).toBe(false);
    expect(data.nextOffset).toBeNull();
  });

  it("filter greps a long document down to matching lines", () => {
    document.body.innerHTML =
      "<main><p>alpha one</p><p>beta two</p><p>alpha three</p><p>gamma four</p></main>";
    const res = handleContentRequest({ op: "get_page", filter: "alpha" }, document);
    const data = res.data as { text: string; filterMatchedLines?: number };
    expect(data.text).toContain("alpha");
    expect(data.text).not.toContain("gamma");
  });
});

describe("get_interactive search + paging", () => {
  beforeEach(() => {
    renderConsolePage();
  });

  it("filter cherry-picks one control out of a crowded page", () => {
    const res = handleContentRequest(
      { op: "get_interactive", filter: "Zawartość", scope: "page" },
      document,
    );
    const data = res.data as { items: Array<{ text: string }>; matched: number };
    expect(data.matched).toBe(1);
    expect(data.items[0]!.text).toContain("Zawartość aplikacji");
  });

  it("keeps item.i as an absolute handle so click_index survives filtering", () => {
    const unfiltered = handleContentRequest(
      { op: "get_interactive", scope: "page", region: "any", limit: 200 },
      document,
    );
    const all = (unfiltered.data as { items: Array<{ i: number; text: string }> }).items;
    const target = all.find((x) => x.text.includes("Utwórz nową wersję"))!;

    const filtered = handleContentRequest(
      { op: "get_interactive", filter: "Utwórz", scope: "page" },
      document,
    );
    const hit = (filtered.data as { items: Array<{ i: number }> }).items[0]!;
    expect(hit.i).toBe(target.i);

    const clicked = handleContentRequest({ op: "click_index", index: hit.i }, document);
    expect(clicked.ok).toBe(true);
  });

  it("auto-scopes to main content when nav would swamp the limit, and says so", () => {
    const res = handleContentRequest({ op: "get_interactive", scope: "page", limit: 10 }, document);
    const data = res.data as {
      items: Array<{ region: string }>;
      region: string;
      regionCounts: { main: number; nav: number };
      hint?: string;
    };
    expect(data.region).toBe("main");
    expect(data.items.every((i) => i.region === "main")).toBe(true);
    expect(data.regionCounts.nav).toBeGreaterThan(10);
    expect(data.hint).toMatch(/Auto-scoped to main content/);
  });

  it("region:any is honoured when the caller asks for it explicitly", () => {
    const res = handleContentRequest(
      { op: "get_interactive", scope: "page", limit: 10, region: "any" },
      document,
    );
    const data = res.data as { region: string; matched: number };
    expect(data.region).toBe("any");
    expect(data.matched).toBeGreaterThan(10);
  });

  it("pages the control list with offset instead of truncating blind", () => {
    const first = handleContentRequest(
      { op: "get_interactive", scope: "page", region: "nav", limit: 20 },
      document,
    );
    const a = first.data as {
      items: Array<{ i: number }>;
      matched: number;
      nextOffset: number | null;
      hasMore: boolean;
    };
    expect(a.items).toHaveLength(20);
    expect(a.hasMore).toBe(true);
    expect(a.nextOffset).toBe(20);

    const second = handleContentRequest(
      { op: "get_interactive", scope: "page", region: "nav", limit: 20, offset: a.nextOffset! },
      document,
    );
    const b = second.data as { items: Array<{ i: number }> };
    expect(b.items[0]!.i).not.toBe(a.items[0]!.i);
  });

  it("kind narrows to a control family", () => {
    document.body.innerHTML = `<main>
      <a href="/x">link</a><button>press</button>
      <input type="text" name="q" /><select><option>a</option></select>
    </main>`;
    const buttons = handleContentRequest(
      { op: "get_interactive", scope: "page", kind: "button" },
      document,
    );
    const data = buttons.data as { items: Array<{ kind: string }> };
    expect(data.items.length).toBeGreaterThan(0);
    expect(data.items.every((i) => i.kind === "button")).toBe(true);
  });

  it("explains itself when a filter matches nothing", () => {
    const res = handleContentRequest(
      { op: "get_interactive", scope: "page", filter: "zzzz-not-here" },
      document,
    );
    const data = res.data as { matched: number; hint?: string };
    expect(data.matched).toBe(0);
    expect(data.hint).toMatch(/find_text/);
  });
});

describe("find_text is actionable", () => {
  beforeEach(() => {
    renderConsolePage();
  });

  it("returns an interactiveIndex that click_index accepts", () => {
    const res = handleContentRequest({ op: "find_text", text: "Utwórz nową" }, document);
    const data = res.data as {
      matches: Array<{ interactiveIndex?: number; clickable: boolean }>;
      total: number;
    };
    const hit = data.matches.find((m) => m.clickable);
    expect(hit).toBeDefined();
    const clicked = handleContentRequest(
      { op: "click_index", index: hit!.interactiveIndex! },
      document,
    );
    expect(clicked.ok).toBe(true);
  });

  it("does not clobber indices from a prior get_interactive", () => {
    const listed = handleContentRequest(
      { op: "get_interactive", scope: "page", region: "any", limit: 200 },
      document,
    );
    const target = (listed.data as { items: Array<{ i: number; text: string }> }).items.find((x) =>
      x.text.includes("Zawartość aplikacji"),
    )!;
    const found = handleContentRequest({ op: "find_text", text: "Zawartość aplikacji" }, document);
    const data = found.data as {
      matches: Array<{ interactiveIndex?: number }>;
      mapRefreshed: boolean;
    };
    expect(data.mapRefreshed).toBe(false);
    expect(data.matches.find((m) => m.interactiveIndex != null)!.interactiveIndex).toBe(target.i);
  });

  it("pages hits and reports the true total", () => {
    document.body.innerHTML = `<main>${Array.from(
      { length: 12 },
      (_, i) => `<p>needle row ${i}</p>`,
    ).join("")}</main>`;
    const res = handleContentRequest({ op: "find_text", text: "needle", limit: 5 }, document);
    const data = res.data as { matches: unknown[]; total: number; nextOffset: number | null };
    expect(data.matches).toHaveLength(5);
    expect(data.total).toBe(12);
    expect(data.nextOffset).toBe(5);
  });

  it("says why a miss happened instead of returning a bare empty list", () => {
    const res = handleContentRequest({ op: "find_text", text: "nothing-here" }, document);
    const data = res.data as { total: number; hint?: string };
    expect(data.total).toBe(0);
    expect(data.hint).toMatch(/iframe|substring/i);
  });
});

describe("get_links filter + region", () => {
  beforeEach(() => {
    renderConsolePage();
  });

  it("region:main drops nav and footer links", () => {
    const res = handleContentRequest({ op: "get_links", region: "main" }, document);
    const data = res.data as { links: Array<{ href: string }>; total: number };
    expect(data.total).toBe(1);
    expect(data.links[0]!.href).toContain("/publishing");
  });

  it("filter matches text or href and still reports the total", () => {
    const res = handleContentRequest({ op: "get_links", filter: "/nav/1", limit: 5 }, document);
    const data = res.data as { links: unknown[]; total: number; hasMore: boolean };
    expect(data.total).toBeGreaterThan(5);
    expect(data.links).toHaveLength(5);
    expect(data.hasMore).toBe(true);
  });
});
