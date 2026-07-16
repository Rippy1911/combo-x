import type { ContentRequest, ContentResponse } from "../protocol/messages.js";

/** Pure DOM helpers used by the content script (and unit-tested with jsdom). */

const MAX_TEXT = 12_000;
const interactiveMaps = new WeakMap<Document, HTMLElement[]>();

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
        return typeInto(doc.querySelector(request.selector), request.text, request.submit);
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
      case "scroll":
        return doScroll(doc, request.direction, request.percent, request.selector);
      case "wait":
        // Sync stub for unit tests; content script awaits via bridge helper if needed.
        return { ok: true, data: { waitedMs: Math.min(request.ms, 10_000) } };
      case "find_text": {
        const limit = request.limit ?? 20;
        const needle = request.text.toLowerCase();
        const matches: Array<{ index: number; text: string; tag: string }> = [];
        const walker = doc.createTreeWalker(doc.body ?? doc, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        let i = 0;
        while (node && matches.length < limit) {
          const raw = (node.textContent ?? "").trim();
          if (raw.length > 1 && raw.toLowerCase().includes(needle)) {
            const parent = node.parentElement;
            matches.push({
              index: i,
              text: raw.slice(0, 200),
              tag: parent?.tagName?.toLowerCase() ?? "text",
            });
            if (request.scrollIntoView && parent && matches.length === 1) {
              parent.scrollIntoView?.({ block: "center", behavior: "instant" as ScrollBehavior });
            }
            i += 1;
          }
          node = walker.nextNode();
        }
        return { ok: true, data: { matches, count: matches.length } };
      }
      case "get_interactive": {
        const limit = request.limit ?? 80;
        const els = collectInteractive(doc, limit);
        interactiveMaps.set(doc, els);
        const items = els.map((el, index) => ({
          i: index,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role") ?? undefined,
          text: (el.innerText || el.textContent || el.getAttribute("aria-label") || "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 100),
          href: el instanceof HTMLAnchorElement ? el.href : undefined,
          type: el instanceof HTMLInputElement ? el.type : undefined,
          name: el.getAttribute("name") ?? undefined,
        }));
        return { ok: true, data: { items, count: items.length } };
      }
      case "click_index": {
        const map = interactiveMaps.get(doc);
        if (!map?.length) {
          return { ok: false, error: "call get_interactive first on this page" };
        }
        const el = map[request.index];
        if (!el) return { ok: false, error: `no interactive at index ${request.index}` };
        el.click();
        return { ok: true, data: { clickedIndex: request.index, tag: el.tagName.toLowerCase() } };
      }
      case "type_index": {
        const map = interactiveMaps.get(doc);
        if (!map?.length) {
          return { ok: false, error: "call get_interactive first on this page" };
        }
        const el = map[request.index];
        if (!el) return { ok: false, error: `no interactive at index ${request.index}` };
        return typeInto(el, request.text, request.submit);
      }
      case "query_all": {
        const limit = request.limit ?? 80;
        const attrs = request.attributes ?? [];
        const nodes = Array.from(doc.querySelectorAll(request.selector)).slice(0, limit);
        const items = nodes.map((n) => {
          const item: Record<string, string | null> = {
            text: (n.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 300),
            href: n instanceof HTMLAnchorElement ? n.href : n.getAttribute("href"),
          };
          for (const a of attrs) item[a] = n.getAttribute(a);
          return item;
        });
        return { ok: true, data: { items, count: items.length } };
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

function typeInto(el: Element | null, text: string, submit?: boolean): ContentResponse {
  if (!el) return { ok: false, error: "no element" };
  if (
    !(el instanceof HTMLInputElement) &&
    !(el instanceof HTMLTextAreaElement) &&
    !(el instanceof HTMLElement && el.isContentEditable)
  ) {
    return { ok: false, error: "element is not typable" };
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
    el.focus();
    el.value = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    if (submit) {
      el.form?.requestSubmit?.() ??
        el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    }
  } else {
    (el as HTMLElement).focus();
    (el as HTMLElement).textContent = text;
    el.dispatchEvent(new Event("input", { bubbles: true }));
  }
  return { ok: true, data: { typed: text.length } };
}

function doScroll(
  doc: Document,
  direction: "up" | "down" | "top" | "bottom" | "percent",
  percent?: number,
  selector?: string,
): ContentResponse {
  const view = doc.defaultView;
  const target = selector ? doc.querySelector(selector) : null;
  const scrollEl =
    target instanceof HTMLElement
      ? target
      : (doc.scrollingElement as HTMLElement | null) ?? doc.documentElement;

  // Prefer scrollTop (works in jsdom + browsers); avoid window.scrollTo noise in tests.
  const el = target instanceof HTMLElement ? target : scrollEl;
  const viewport = view?.innerHeight ?? 600;
  if (el) {
    if (direction === "top") el.scrollTop = 0;
    else if (direction === "bottom") el.scrollTop = el.scrollHeight;
    else if (direction === "percent") {
      const p = Math.min(100, Math.max(0, percent ?? 50)) / 100;
      el.scrollTop = Math.max(0, el.scrollHeight - viewport) * p;
    } else {
      const delta = direction === "down" ? viewport * 0.8 : -viewport * 0.8;
      el.scrollTop = Math.max(0, el.scrollTop + delta);
    }
  }
  return { ok: true, data: { scrolled: direction, percent: percent ?? null } };
}

function collectInteractive(doc: Document, limit: number): HTMLElement[] {
  const sel =
    'a[href], button, input:not([type="hidden"]), textarea, select, [role="button"], [role="link"], summary, [contenteditable="true"]';
  const raw = Array.from(doc.querySelectorAll(sel)) as HTMLElement[];
  const out: HTMLElement[] = [];
  for (const el of raw) {
    if (out.length >= limit) break;
    if (!isVisible(el)) continue;
    out.push(el);
  }
  return out;
}

function isVisible(el: HTMLElement): boolean {
  if (el.getAttribute("aria-hidden") === "true") return false;
  const style = el.ownerDocument.defaultView?.getComputedStyle?.(el);
  if (style && (style.display === "none" || style.visibility === "hidden")) return false;
  const rect = el.getBoundingClientRect?.();
  if (rect && rect.width === 0 && rect.height === 0) {
    // jsdom often returns 0x0 — still allow if not display:none
    if (style?.display === "none") return false;
  }
  return true;
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

/** Async wait for content script (real delay). */
export async function waitMs(ms: number): Promise<void> {
  const capped = Math.min(Math.max(0, ms), 10_000);
  await new Promise((r) => setTimeout(r, capped));
}
