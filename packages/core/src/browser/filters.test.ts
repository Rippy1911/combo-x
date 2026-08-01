/**
 * The cherry-pick surface: every read tool must let the agent describe what it
 * wants and drop the rest, rather than paging through a dump.
 *
 * Motivated by the Play Console transcript, where a 100-item control listing
 * was ~70% Material icon-ligature labels ("arrow_rightPodsumowanie") and nav
 * destinations the agent had already seen.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { handleContentRequest } from "./content-handlers.js";
import { toolArgsToContentRequest } from "./tools.js";

function renderConsole(): void {
  document.body.innerHTML = `
    <header><a href="https://console.test/home">home Strona główna</a></header>
    <nav>
      <a href="https://console.test/dash">dashboard Panel</a>
      <a href="https://console.test/stats">bar_chart Statystyki</a>
      <a href="https://console.test/dash">dashboard Panel</a>
    </nav>
    <main>
      <h1>Panel</h1>
      <button>Utwórz nową wersję</button>
      <button disabled>Wyślij do sprawdzenia</button>
      <button aria-disabled="true">Opublikuj</button>
      <button aria-label="">  </button>
      <input name="appName" placeholder="Nazwa aplikacji" />
      <select name="country"><option>PL</option></select>
      <a href="https://support.google.com/help">Więcej informacji</a>
    </main>`;
}

const ANY = { op: "get_interactive", scope: "page", region: "any" } as const;

describe("get_interactive cherry-picking", () => {
  beforeEach(renderConsole);

  it("exclude drops icon-ligature noise without touching indices", () => {
    const all = handleContentRequest({ ...ANY }, document).data as {
      items: { i: number; text: string }[];
    };
    const pruned = handleContentRequest({ ...ANY, exclude: "dashboard" }, document).data as {
      items: { i: number; text: string }[];
    };
    expect(all.items.some((it) => it.text.includes("dashboard"))).toBe(true);
    expect(pruned.items.some((it) => it.text.includes("dashboard"))).toBe(false);
    // Surviving controls keep the index they had in the unfiltered scan.
    for (const item of pruned.items) {
      expect(all.items.find((a) => a.i === item.i)?.text).toBe(item.text);
    }
  });

  it("reports disabled controls so the model does not click a dead button", () => {
    const data = handleContentRequest({ ...ANY }, document).data as {
      items: { text: string; disabled?: boolean }[];
    };
    const submit = data.items.find((it) => it.text === "Wyślij do sprawdzenia");
    expect(submit?.disabled).toBe(true);
    // Enabled controls must not spend tokens on `disabled:false`. Assert the
    // serialized form, since that is what actually reaches the model.
    const enabled = data.items.find((it) => it.text === "Utwórz nową wersję");
    expect(JSON.parse(JSON.stringify(enabled))).not.toHaveProperty("disabled");
  });

  it("treats aria-disabled as disabled", () => {
    const data = handleContentRequest({ ...ANY, filter: "Opublikuj" }, document).data as {
      items: { disabled?: boolean }[];
    };
    expect(data.items[0]?.disabled).toBe(true);
  });

  it("state:enabled hides blocked controls and says how many", () => {
    const res = handleContentRequest({ ...ANY, state: "enabled" }, document);
    const data = res.data as { items: { text: string }[]; hint?: string };
    expect(data.items.some((it) => it.text === "Wyślij do sprawdzenia")).toBe(false);
    expect(data.items.some((it) => it.text === "Utwórz nową wersję")).toBe(true);
    expect(data.hint).toMatch(/2 disabled control/);
  });

  it("state:disabled inspects exactly what is blocked", () => {
    const data = handleContentRequest({ ...ANY, state: "disabled" }, document).data as {
      items: { text: string }[];
    };
    expect(data.items.map((it) => it.text).sort()).toEqual([
      "Opublikuj",
      "Wyślij do sprawdzenia",
    ]);
  });

  it("requireLabel drops unnamed icon buttons", () => {
    const withBlank = handleContentRequest({ ...ANY }, document).data as {
      items: { text: string }[];
    };
    const named = handleContentRequest({ ...ANY, requireLabel: true }, document).data as {
      items: { text: string }[];
    };
    expect(withBlank.items.some((it) => it.text === "")).toBe(true);
    expect(named.items.some((it) => it.text === "")).toBe(false);
  });

  it("fields projects the payload down but always keeps the click index", () => {
    const data = handleContentRequest({ ...ANY, fields: ["text"] }, document).data as {
      items: Record<string, unknown>[];
    };
    const first = data.items[0]!;
    expect(Object.keys(first).sort()).toEqual(["i", "text"]);
    expect(typeof first.i).toBe("number");
  });

  it("kind and filter still compose with the new filters", () => {
    const data = handleContentRequest(
      { ...ANY, kind: "button", state: "enabled", requireLabel: true },
      document,
    ).data as { items: { text: string }[] };
    expect(data.items.map((it) => it.text)).toEqual(["Utwórz nową wersję"]);
  });
});

describe("get_links narrowing", () => {
  beforeEach(renderConsole);

  it("unique collapses the same destination rendered twice", () => {
    const dupes = handleContentRequest({ op: "get_links" }, document).data as {
      links: { href: string }[];
    };
    const res = handleContentRequest({ op: "get_links", unique: true }, document);
    const data = res.data as { links: { href: string }[]; duplicatesCollapsed?: number };
    expect(dupes.links.filter((l) => l.href.endsWith("/dash"))).toHaveLength(2);
    expect(data.links.filter((l) => l.href.endsWith("/dash"))).toHaveLength(1);
    expect(data.duplicatesCollapsed).toBe(1);
  });

  it("origin separates on-site navigation from outbound help links", () => {
    const internal = handleContentRequest({ op: "get_links", origin: "internal" }, document)
      .data as { links: { href: string }[] };
    const external = handleContentRequest({ op: "get_links", origin: "external" }, document)
      .data as { links: { href: string }[] };
    expect(internal.links.every((l) => l.href.startsWith("http://localhost"))).toBe(true);
    expect(external.links.map((l) => l.href)).toContain("https://support.google.com/help");
  });

  it("fields strips the payload to what was asked for", () => {
    const data = handleContentRequest({ op: "get_links", fields: ["href"] }, document).data as {
      links: Record<string, unknown>[];
    };
    expect(Object.keys(data.links[0]!)).toEqual(["href"]);
  });

  it("exclude drops matches by text or href", () => {
    const data = handleContentRequest({ op: "get_links", exclude: "support.google" }, document)
      .data as { links: { href: string }[] };
    expect(data.links.some((l) => l.href.includes("support.google"))).toBe(false);
  });
});

describe("find_text narrowing", () => {
  beforeEach(renderConsole);

  it("clickableOnly returns hits that are all immediately actionable", () => {
    const data = handleContentRequest(
      { op: "find_text", text: "Panel", clickableOnly: true },
      document,
    ).data as { matches: { clickable: boolean; interactiveIndex?: number }[] };
    expect(data.matches.length).toBeGreaterThan(0);
    for (const m of data.matches) {
      expect(m.clickable).toBe(true);
      expect(typeof m.interactiveIndex).toBe("number");
    }
  });

  it("region:main ignores the same label repeated in the sidebar", () => {
    const anywhere = handleContentRequest({ op: "find_text", text: "Panel" }, document).data as {
      total: number;
    };
    const mainOnly = handleContentRequest(
      { op: "find_text", text: "Panel", region: "main" },
      document,
    ).data as { total: number; matches: { region: string }[] };
    expect(mainOnly.total).toBeLessThan(anywhere.total);
    expect(mainOnly.matches.every((m) => m.region === "main")).toBe(true);
  });
});

describe("get_page exclude", () => {
  it("strips boilerplate lines and reports how many went", () => {
    document.body.innerHTML = `<main>
      <p>Keep this line</p>
      <p>Cookie notice: we use cookies</p>
      <p>Also keep this</p>
      <p>Cookie notice: we use cookies</p>
    </main>`;
    const data = handleContentRequest(
      { op: "get_page", exclude: "Cookie notice" },
      document,
    ).data as { text: string; excludedLines: number };
    expect(data.text).toContain("Keep this line");
    expect(data.text).not.toContain("Cookie notice");
    expect(data.excludedLines).toBe(2);
  });
});

describe("toolArgsToContentRequest passes the new controls through", () => {
  it("maps get_interactive filters and ignores junk values", () => {
    const req = toolArgsToContentRequest("get_interactive", {
      filter: "Save",
      exclude: "arrow_right",
      state: "enabled",
      requireLabel: true,
      kind: "button",
      fields: ["text", "nonsense"],
      region: "not-a-region",
    });
    expect(req).toMatchObject({
      op: "get_interactive",
      filter: "Save",
      exclude: "arrow_right",
      state: "enabled",
      requireLabel: true,
      kind: "button",
      fields: ["text"],
    });
    expect((req as { region?: string }).region).toBeUndefined();
  });

  it("maps get_links and find_text controls", () => {
    expect(
      toolArgsToContentRequest("get_links", { unique: true, origin: "internal", exclude: "utm" }),
    ).toMatchObject({ unique: true, origin: "internal", exclude: "utm" });
    expect(
      toolArgsToContentRequest("find_text", { text: "Publish", clickableOnly: true, region: "main" }),
    ).toMatchObject({ clickableOnly: true, region: "main" });
  });

  it("drops a fields array that contains nothing valid", () => {
    const req = toolArgsToContentRequest("get_interactive", { fields: ["bogus"] });
    expect((req as { fields?: unknown }).fields).toBeUndefined();
  });
});
