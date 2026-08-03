/**
 * Acceptance fixture for the Base44-style failure mode (2026-08-03):
 * chat column + 5-row meta-tags table with unlabeled pencils + a labeled form.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { handleContentRequest } from "./content-handlers.js";
import { toolArgsToContentRequest } from "./tools.js";

function renderAcceptanceFixture(): void {
  document.body.innerHTML = `
    <div id="app">
      <aside data-testid="chat-panel">
        <p>Description: old chat message about FaqPage</p>
        <p>Description: another chat hit</p>
        <button>Send chat</button>
      </aside>
      <main>
        <h1>Per-Page Meta Tags</h1>
        <table>
          <tbody>
            <tr><td>HomePage</td><td>Home</td><td>Welcome</td>
              <td><button class="edit" aria-label=""></button></td></tr>
            <tr><td>AboutPage</td><td>About</td><td>About us</td>
              <td><button class="edit" aria-label=""></button></td></tr>
            <tr><td>Row3</td><td>Row three</td><td>Desc three</td>
              <td><button class="edit" id="pencil-row3" aria-label=""></button></td></tr>
            <tr><td>FaqPage</td><td>FAQ</td><td>Answers</td>
              <td><button class="edit" id="pencil-faq" aria-label=""></button></td></tr>
            <tr><td>ContactPage</td><td>Contact</td><td>Reach us</td>
              <td><button class="edit" aria-label=""></button></td></tr>
          </tbody>
        </table>
        <form id="meta-form">
          <label for="title-input">Page title</label>
          <input id="title-input" name="title" type="text" value="FAQ" />
          <label>Description<textarea name="description" placeholder="Meta description"></textarea></label>
          <input aria-label="Canonical URL" name="canonical" type="url" />
          <input name="secret" type="password" value="s3cret!" />
        </form>
      </main>
    </div>`;
}

describe("acceptance: within + excludeSelector + list_form_fields", () => {
  beforeEach(renderAcceptanceFixture);

  it("get_interactive({within:{text:'Row3'}}) returns exactly that row's pencil with absolute i", () => {
    const all = handleContentRequest(
      { op: "get_interactive", scope: "page", region: "any" },
      document,
    ).data as { items: { i: number; tag: string; text: string }[]; total: number };

    const scoped = handleContentRequest(
      { op: "get_interactive", scope: "page", region: "any", within: { text: "Row3" } },
      document,
    ).data as { items: { i: number; tag: string }[]; matched: number };

    expect(scoped.matched).toBe(1);
    expect(scoped.items).toHaveLength(1);
    const pencil = scoped.items[0]!;
    expect(pencil.tag).toBe("button");
    // Absolute index: same handle as in the unfiltered scan.
    expect(all.items.find((it) => it.i === pencil.i)?.tag).toBe("button");
    expect(document.getElementById("pencil-row3")).toBeTruthy();

    const clicked = handleContentRequest({ op: "click_index", index: pencil.i }, document);
    expect(clicked.ok).toBe(true);
  });

  it("find_text({excludeSelector:'aside'}) drops chat hits and keeps workspace hits", () => {
    const noisy = handleContentRequest(
      { op: "find_text", text: "Description", region: "any" },
      document,
    ).data as { total: number; matches: { text: string; tag: string }[] };
    expect(noisy.total).toBeGreaterThanOrEqual(2);

    const clean = handleContentRequest(
      { op: "find_text", text: "Description", excludeSelector: "aside" },
      document,
    ).data as { total: number; matches: { text: string }[] };
    expect(clean.matches.every((m) => !m.text.includes("old chat"))).toBe(true);
    expect(clean.total).toBeLessThan(noisy.total);
  });

  it("get_page({excludeSelector:'aside'}) prunes the chat column", () => {
    const full = handleContentRequest({ op: "get_page", mode: "full" }, document).data as {
      text: string;
    };
    expect(full.text).toContain("old chat message");

    const pruned = handleContentRequest(
      { op: "get_page", mode: "full", excludeSelector: "aside,[data-testid='chat-panel']" },
      document,
    ).data as { text: string };
    expect(pruned.text).not.toContain("old chat message");
    expect(pruned.text).toContain("Per-Page Meta Tags");
    expect(pruned.text).toContain("FaqPage");
  });

  it("get_interactive({excludeSelector:'aside'}) hides chat controls but keeps absolute i", () => {
    const all = handleContentRequest(
      { op: "get_interactive", scope: "page", region: "any" },
      document,
    ).data as { items: { i: number; text: string }[]; total: number };
    const pruned = handleContentRequest(
      { op: "get_interactive", scope: "page", region: "any", excludeSelector: "aside" },
      document,
    ).data as { items: { i: number; text: string }[]; total: number; matched: number };
    expect(pruned.total).toBe(all.total);
    expect(pruned.items.some((it) => it.text.includes("Send chat"))).toBe(false);
    expect(pruned.matched).toBeLessThan(all.items.length);
    for (const item of pruned.items) {
      expect(all.items.find((a) => a.i === item.i)?.text).toBe(item.text);
    }
  });

  it("list_form_fields maps 3 labeling styles + password hasValue only", () => {
    const data = handleContentRequest(
      { op: "list_form_fields", scope: "page", region: "any" },
      document,
    ).data as {
      fields: Array<{
        i: number;
        label: string;
        type: string;
        name?: string;
        hasValue: boolean;
        value?: unknown;
      }>;
    };

    const byName = Object.fromEntries(
      data.fields.filter((f) => f.name).map((f) => [f.name!, f]),
    );
    expect(byName.title?.label).toMatch(/Page title/i);
    expect(byName.description?.label).toMatch(/Description/i);
    expect(byName.canonical?.label).toMatch(/Canonical URL/i);
    expect(byName.secret?.type).toBe("password");
    expect(byName.secret?.hasValue).toBe(true);
    expect(byName.secret).not.toHaveProperty("value");
    // Serialized payload must never leak the password.
    expect(JSON.stringify(data)).not.toContain("s3cret!");

    // type_index works on the same absolute handle.
    const title = byName.title!;
    const typed = handleContentRequest(
      { op: "type_index", index: title.i, text: "New FAQ title" },
      document,
    );
    expect(typed.ok).toBe(true);
    expect((document.getElementById("title-input") as HTMLInputElement).value).toBe(
      "New FAQ title",
    );
  });

  it("toolArgsToContentRequest maps within + excludeSelector + list_form_fields", () => {
    expect(
      toolArgsToContentRequest("get_interactive", {
        within: { text: "FaqPage" },
        excludeSelector: "aside",
      }),
    ).toMatchObject({
      op: "get_interactive",
      within: { text: "FaqPage" },
      excludeSelector: "aside",
    });
    expect(
      toolArgsToContentRequest("find_text", {
        text: "Description",
        excludeSelector: "aside",
      }),
    ).toMatchObject({ excludeSelector: "aside" });
    expect(
      toolArgsToContentRequest("list_form_fields", { region: "main", excludeSelector: "aside" }),
    ).toMatchObject({ op: "list_form_fields", region: "main", excludeSelector: "aside" });
  });
});
