import { describe, expect, it } from "vitest";
import { handleContentRequest } from "./content-handlers.js";

describe("handleContentRequest", () => {
  it("get_page returns title and text", () => {
    document.body.innerHTML = `<h1>Hello</h1><p>World of agents</p>`;
    document.title = "Test Page";
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
    const interactive = (snap.data as { items: Array<{ i: number; tag: string }> }).items;
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
});
