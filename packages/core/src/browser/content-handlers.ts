import type { ContentRequest, ContentResponse } from "../protocol/messages.js";

/** Pure DOM helpers used by the content script (and unit-tested with jsdom). */

const MAX_TEXT = 12_000;
const interactiveMaps = new WeakMap<Document, HTMLElement[]>();

const EAN_RE = /\b(\d{8}|\d{13}|\d{14})\b/g;

function pageDigest(doc: Document): Record<string, unknown> {
  const url = doc.location?.href ?? "";
  const title = doc.title;
  const headings = Array.from(doc.querySelectorAll("h1,h2,h3"))
    .slice(0, 20)
    .map((h) => ({
      tag: h.tagName.toLowerCase(),
      text: (h.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 160),
    }))
    .filter((h) => h.text);

  const labelHits: Array<{ label: string; value: string }> = [];
  const bodyText = visibleText(doc);
  const labelPatterns = [
    /EAN\s*Opakowanie\s*zbiorcze\s*:?\s*(\d{8,14})/i,
    /EAN\s*:?\s*(\d{8,14})/i,
    /Numer\s*katalogowy\s*:?\s*(\d+)/i,
    /Catalog(?:ue)?\s*(?:no|number|#)\s*:?\s*(\w+)/i,
    /Materiał\s*:?\s*(\d+)/i,
  ];
  for (const re of labelPatterns) {
    const m = bodyText.match(re);
    if (m) labelHits.push({ label: re.source.slice(0, 40), value: m[1]! });
  }

  const eans = [...new Set((bodyText.match(EAN_RE) ?? []).slice(0, 40))];
  const main =
    doc.querySelector("main, article, [class*='product'], [id*='product']") ??
    doc.body;
  const mainSample = (main?.textContent ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 900);

  return {
    title,
    url,
    headings,
    labelHits,
    eans,
    mainSample,
    hint: "Use extract/query_all for precise fields; avoid get_page full.",
  };
}

export function handleContentRequest(request: ContentRequest, doc: Document = document): ContentResponse {
  try {
    switch (request.op) {
      case "get_page": {
        const mode = request.mode ?? "full";
        const maxChars = request.maxChars ?? MAX_TEXT;
        if (mode === "structure") {
          return { ok: true, data: pageDigest(doc) };
        }
        const text = visibleText(doc);
        const cap = mode === "snippet" ? Math.min(maxChars, 2_500) : maxChars;
        return {
          ok: true,
          data: {
            title: doc.title,
            url: doc.location?.href ?? "",
            text: text.slice(0, cap),
            truncated: text.length > cap,
            mode,
          },
        };
      }
      case "page_digest":
        return { ok: true, data: pageDigest(doc) };
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
      case "element_rect": {
        let el: Element | null = null;
        if (request.selector) {
          el = doc.querySelector(request.selector);
        } else if (request.index != null) {
          const map = interactiveMaps.get(doc);
          el = map?.[request.index] ?? null;
        }
        if (!el || !(el instanceof HTMLElement)) {
          return { ok: false, error: "element not found" };
        }
        const rect = el.getBoundingClientRect();
        const dpr = doc.defaultView?.devicePixelRatio ?? 1;
        return {
          ok: true,
          data: {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
            dpr,
            tag: el.tagName.toLowerCase(),
          },
        };
      }
      case "page_metrics": {
        const view = doc.defaultView;
        const root =
          (doc.scrollingElement as HTMLElement | null) ?? doc.documentElement ?? doc.body;
        const dpr = view?.devicePixelRatio ?? 1;
        return {
          ok: true,
          data: {
            scrollWidth: root?.scrollWidth ?? 0,
            scrollHeight: root?.scrollHeight ?? 0,
            clientWidth: root?.clientWidth ?? view?.innerWidth ?? 0,
            clientHeight: root?.clientHeight ?? view?.innerHeight ?? 0,
            scrollX: view?.scrollX ?? root?.scrollLeft ?? 0,
            scrollY: view?.scrollY ?? root?.scrollTop ?? 0,
            dpr,
          },
        };
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
