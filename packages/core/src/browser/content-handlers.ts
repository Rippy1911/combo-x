import type { ContentRequest, ContentResponse } from "../protocol/messages.js";

/** Pure DOM helpers used by the content script (and unit-tested with jsdom). */

const MAX_TEXT = 12_000;

export function handleContentRequest(request: ContentRequest, doc: Document = document): ContentResponse {
  try {
    switch (request.op) {
      case "get_page":
        return {
          ok: true,
          data: {
            title: doc.title,
            url: doc.location?.href ?? "",
            text: visibleText(doc).slice(0, MAX_TEXT),
          },
        };
      case "get_links": {
        const limit = request.limit ?? 30;
        const links = Array.from(doc.querySelectorAll("a[href]"))
          .slice(0, limit)
          .map((a) => ({
            text: (a.textContent ?? "").trim().slice(0, 120),
            href: (a as HTMLAnchorElement).href,
          }))
          .filter((l) => l.href);
        return { ok: true, data: { links } };
      }
      case "click": {
        const el = doc.querySelector(request.selector);
        if (!el) return { ok: false, error: `no element matching ${request.selector}` };
        if (el instanceof HTMLElement) el.click();
        else return { ok: false, error: "element is not HTMLElement" };
        return { ok: true, data: { clicked: request.selector } };
      }
      case "type_text": {
        const el = doc.querySelector(request.selector);
        if (!el) return { ok: false, error: `no element matching ${request.selector}` };
        if (
          !(el instanceof HTMLInputElement) &&
          !(el instanceof HTMLTextAreaElement) &&
          !(el instanceof HTMLElement && el.isContentEditable)
        ) {
          return { ok: false, error: "element is not typable" };
        }
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
          el.focus();
          el.value = request.text;
          el.dispatchEvent(new Event("input", { bubbles: true }));
          el.dispatchEvent(new Event("change", { bubbles: true }));
          if (request.submit) {
            el.form?.requestSubmit?.() ??
              el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
          }
        } else {
          (el as HTMLElement).focus();
          (el as HTMLElement).textContent = request.text;
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
        return { ok: true, data: { typed: request.text.length } };
      }
      case "extract": {
        const nodes = Array.from(doc.querySelectorAll(request.selector)).slice(0, 50);
        const values = nodes.map((n) => {
          if (request.attribute) return n.getAttribute(request.attribute);
          return (n.textContent ?? "").trim().slice(0, 500);
        });
        return { ok: true, data: { values } };
      }
      case "scrape_tables": {
        const sel = request.selector?.trim() || "table";
        const limit = request.limit ?? 20;
        const tables = Array.from(doc.querySelectorAll(sel))
          .filter((n) => n.tagName === "TABLE" || n.querySelector("table"))
          .slice(0, limit)
          .map((node, index) => {
            const table = node.tagName === "TABLE" ? node : node.querySelector("table");
            if (!table) return null;
            const rows = Array.from(table.querySelectorAll("tr")).map((tr) =>
              Array.from(tr.querySelectorAll("th,td")).map((c) =>
                (c.textContent ?? "").trim().replace(/\s+/g, " "),
              ),
            );
            return { index, rowCount: rows.length, rows: rows.slice(0, 500) };
          })
          .filter(Boolean);
        return { ok: true, data: { tables, count: tables.length } };
      }
      default:
        return { ok: false, error: "unknown op" };
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function visibleText(doc: Document): string {
  const body = doc.body;
  if (!body) return "";
  const clone = body.cloneNode(true) as HTMLElement;
  for (const sel of ["script", "style", "noscript", "svg"]) {
    for (const n of Array.from(clone.querySelectorAll(sel))) n.remove();
  }
  return (clone.innerText || clone.textContent || "").replace(/\s+\n/g, "\n").replace(/[ \t]+/g, " ").trim();
}
