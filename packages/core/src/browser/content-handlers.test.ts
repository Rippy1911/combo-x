import { describe, expect, it } from "vitest";
import { handleContentRequest } from "./content-handlers.js";

describe("handleContentRequest", () => {
  it("page_digest returns compact map not full chrome dump", () => {
    document.body.innerHTML = `
      <nav>Huge nav with 100 links</nav>
      <main>
        <h1>Baton Bakalland</h1>
        <p>EAN: 5900749610926</p>
        <p>EAN Opakowanie zbiorcze: 5900749611923</p>
        <p>Numer katalogowy: 29597</p>
      </main>`;
    Object.defineProperty(document, "title", {
      value: "PDP",
      configurable: true,
      writable: true,
    });
    const res = handleContentRequest({ op: "page_digest" });
    expect(res.ok).toBe(true);
    const data = res.data as {
      eans?: string[];
      labelHits?: unknown[];
      mainSample?: string;
    };
    expect(data.eans?.length).toBeGreaterThan(0);
    expect(JSON.stringify(data).length).toBeLessThan(5000);
  });

  it("get_page returns title and text", () => {
    document.body.innerHTML = `<h1>Hello</h1><p>World of agents</p>`;
    Object.defineProperty(document, "title", {
      value: "Test Page",
      configurable: true,
      writable: true,
    });
    const res = handleContentRequest({ op: "get_page" }, document);
    expect(res.ok).toBe(true);
    const data = res.data as { title: string; text: string };
    expect(data.title).toBe("Test Page");
    expect(data.text).toContain("Hello");
    expect(data.text).toContain("World of agents");
  });

  it("click and type_text work", () => {
    document.body.innerHTML = `
      <button id="go">Go</button>
      <input id="q" value="" />
    `;
    let clicked = false;
    document.getElementById("go")!.addEventListener("click", () => {
      clicked = true;
    });
    expect(handleContentRequest({ op: "click", selector: "#go" }, document).ok).toBe(true);
    expect(clicked).toBe(true);

    const typed = handleContentRequest(
      { op: "type_text", selector: "#q", text: "supplements" },
      document,
    );
    expect(typed.ok).toBe(true);
    expect((document.getElementById("q") as HTMLInputElement).value).toBe("supplements");
  });

  it("extract returns attribute values", () => {
    document.body.innerHTML = `<a id="a" href="https://example.com/x">Link</a>`;
    const res = handleContentRequest(
      { op: "extract", selector: "#a", attribute: "href" },
      document,
    );
    expect(res.ok).toBe(true);
    expect((res.data as { values: string[] }).values[0]).toContain("example.com");
  });

  it("returns error for missing selector", () => {
    const res = handleContentRequest({ op: "click", selector: "#missing" }, document);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/no element/);
  });

  it("query_all and get_interactive + click_index", () => {
    document.body.innerHTML = `
      <a class="card" href="https://shop.example/p1">Piadina EAN 111</a>
      <button id="go">Go</button>
      <input id="q" />
    `;
    const q = handleContentRequest(
      { op: "query_all", selector: "a.card", attributes: ["href"] },
      document,
    );
    expect(q.ok).toBe(true);
    const items = (q.data as { items: Array<{ text: string }> }).items;
    expect(items[0]?.text).toMatch(/Piadina/);

    const snap = handleContentRequest({ op: "get_interactive", limit: 20 }, document);
    expect(snap.ok).toBe(true);
    const data = snap.data as { items: Array<{ i: number; tag: string }>; scope: string };
    expect(data.scope).toBe("page");
    const interactive = data.items;
    expect(interactive.length).toBeGreaterThan(0);

    let clicked = false;
    document.getElementById("go")!.addEventListener("click", () => {
      clicked = true;
    });
    const btn = interactive.find((x) => x.tag === "button");
    expect(btn).toBeTruthy();
    expect(
      handleContentRequest({ op: "click_index", index: btn!.i }, document).ok,
    ).toBe(true);
    expect(clicked).toBe(true);
  });

  it("get_interactive scopes to high-z fixed portal without role=dialog (FloatingWorkoutEditor)", () => {
    const dayButtons = Array.from({ length: 90 }, (_, i) =>
      `<button type="button">Add workout day ${i}</button>`,
    ).join("");
    document.body.innerHTML = `
      <main id="app">${dayButtons}</main>
      <div id="float" style="position:fixed;z-index:9999;left:40px;top:40px;width:420px;height:400px">
        <button type="button">Plan title</button>
        <input type="time" />
        <button type="button">+ Add exercise</button>
        <button type="button" id="save">Save</button>
        <button type="button">Cancel</button>
      </div>
    `;
    // jsdom: ensure getComputedStyle reports fixed + z-index
    const float = document.getElementById("float")!;
    Object.defineProperty(float, "getBoundingClientRect", {
      value: () => ({ width: 420, height: 400, top: 40, left: 40, right: 460, bottom: 440, x: 40, y: 40, toJSON: () => ({}) }),
    });

    const snap = handleContentRequest({ op: "get_interactive", limit: 80 }, document);
    expect(snap.ok).toBe(true);
    const data = snap.data as {
      items: Array<{ text: string }>;
      scope: string;
    };
    expect(data.scope).toBe("dialog");
    expect(data.items.some((x) => /Add workout day/.test(x.text))).toBe(false);
    expect(data.items.some((x) => x.text === "Save")).toBe(true);
    expect(data.items.some((x) => x.text === "Plan title")).toBe(true);
  });

  it("get_interactive scopes to open dialog when page has many buttons behind it", () => {
    const dayButtons = Array.from({ length: 90 }, (_, i) =>
      `<button type="button">Add workout day ${i}</button>`,
    ).join("");
    document.body.innerHTML = `
      <main>${dayButtons}</main>
      <div role="dialog" aria-modal="true">
        <h2>New Plan</h2>
        <button type="button">Plan title</button>
        <button type="button">+ Add exercise</button>
        <button type="button" id="save">Save</button>
        <button type="button">Cancel</button>
      </div>
    `;
    const snap = handleContentRequest({ op: "get_interactive", limit: 80 }, document);
    expect(snap.ok).toBe(true);
    const data = snap.data as {
      items: Array<{ i: number; text: string }>;
      scope: string;
    };
    expect(data.scope).toBe("dialog");
    expect(data.items.some((x) => /Add workout day/.test(x.text))).toBe(false);
    expect(data.items.some((x) => x.text === "Save")).toBe(true);
    expect(data.items.some((x) => x.text === "Plan title")).toBe(true);

    let saved = false;
    document.getElementById("save")!.addEventListener("click", () => {
      saved = true;
    });
    const saveIdx = data.items.find((x) => x.text === "Save")!.i;
    expect(handleContentRequest({ op: "click_index", index: saveIdx }, document).ok).toBe(true);
    expect(saved).toBe(true);
  });

  it("type_index rejects free text into input[type=time]", () => {
    document.body.innerHTML = `
      <div role="dialog" aria-modal="true">
        <input type="time" id="t" />
        <input type="text" id="title" placeholder="Plan title" />
      </div>
    `;
    const snap = handleContentRequest({ op: "get_interactive", limit: 10 }, document);
    const items = (
      snap.data as {
        items: Array<{ i: number; type?: string; placeholder?: string }>;
      }
    ).items;
    const timeIdx = items.find((x) => x.type === "time")!.i;
    const bad = handleContentRequest(
      { op: "type_index", index: timeIdx, text: "Test Push Day" },
      document,
    );
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/type=time|free text|Plan title/i);
    expect((document.getElementById("t") as HTMLInputElement).value).toBe("");

    const textItem = items.find((x) => x.placeholder === "Plan title");
    expect(textItem).toBeTruthy();
    const ok = handleContentRequest(
      { op: "type_index", index: textItem!.i, text: "Test Push Day" },
      document,
    );
    expect(ok.ok).toBe(true);
    expect((document.getElementById("title") as HTMLInputElement).value).toBe("Test Push Day");
  });

  it("type_text with broad input selector prefers text over time for titles", () => {
    document.body.innerHTML = `
      <input type="time" id="t" />
      <input type="text" id="title" placeholder="Plan title" />
    `;
    const res = handleContentRequest(
      { op: "type_text", selector: "input", text: "Test Push Day" },
      document,
    );
    expect(res.ok).toBe(true);
    expect((document.getElementById("t") as HTMLInputElement).value).toBe("");
    expect((document.getElementById("title") as HTMLInputElement).value).toBe("Test Push Day");
  });

  it("find_text and scroll", () => {
    document.body.innerHTML = `<p>Hello foodwell catalog</p>`;
    const found = handleContentRequest(
      { op: "find_text", text: "foodwell", scrollIntoView: false },
      document,
    );
    expect(found.ok).toBe(true);
    expect((found.data as { count: number }).count).toBeGreaterThan(0);
    expect(handleContentRequest({ op: "scroll", direction: "top" }, document).ok).toBe(true);
  });

  it("inject_css then clear_css", () => {
    document.documentElement.innerHTML = "<head></head><body></body>";
    const bad = handleContentRequest(
      { op: "inject_css", css: "@import url('https://evil.test/x.css');" },
      document,
    );
    expect(bad.ok).toBe(false);
    const ok = handleContentRequest(
      { op: "inject_css", css: "h1{color:tomato!important}" },
      document,
    );
    expect(ok.ok).toBe(true);
    expect(document.getElementById("combo-x-css-preview")?.textContent).toContain("tomato");
    expect(handleContentRequest({ op: "clear_css" }, document).ok).toBe(true);
    expect(document.getElementById("combo-x-css-preview")).toBeNull();
  });
});
