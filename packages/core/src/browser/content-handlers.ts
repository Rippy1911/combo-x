import type { ContentRequest, ContentResponse } from "../protocol/messages.js";
import {
  PREVIEW_STYLE_ID,
  validatePreviewCss,
} from "../vision/annotateHtml.js";
import { buildCssPath, type PickedElementRef } from "./elementRef.js";

/** Pure DOM helpers used by the content script (and unit-tested with jsdom). */

const MAX_TEXT = 12_000;
const interactiveMaps = new WeakMap<Document, HTMLElement[]>();

const EAN_RE = /\b(\d{8}|\d{13}|\d{14})\b/g;

function metaContent(doc: Document, nameOrProp: string): string | undefined {
  for (const meta of Array.from(doc.querySelectorAll("meta"))) {
    const name = meta.getAttribute("name") ?? "";
    const prop = meta.getAttribute("property") ?? "";
    if (
      name.toLowerCase() === nameOrProp.toLowerCase() ||
      prop.toLowerCase() === nameOrProp.toLowerCase()
    ) {
      const content = meta.getAttribute("content")?.trim();
      if (content) return content;
    }
  }
  return undefined;
}

function collectJsonLdTypes(doc: Document): string[] {
  const out: string[] = [];
  const pushType = (t: unknown) => {
    if (typeof t === "string" && t.trim()) out.push(t.trim());
    else if (Array.isArray(t)) for (const x of t) pushType(x);
  };
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }
    const obj = node as Record<string, unknown>;
    if ("@type" in obj) pushType(obj["@type"]);
    if (Array.isArray(obj["@graph"])) walk(obj["@graph"]);
  };
  for (const script of Array.from(
    doc.querySelectorAll('script[type="application/ld+json"]'),
  ).slice(0, 12)) {
    const raw = (script.textContent ?? "").trim();
    if (!raw) continue;
    try {
      walk(JSON.parse(raw));
    } catch {
      /* ignore broken JSON-LD */
    }
  }
  return [...new Set(out)].slice(0, 20);
}

function pageDigestSeo(doc: Document): Record<string, unknown> {
  const canonicalEl = doc.querySelector('link[rel="canonical"]') as HTMLLinkElement | null;
  return {
    metaDescription: metaContent(doc, "description"),
    robots: metaContent(doc, "robots"),
    googlebot: metaContent(doc, "googlebot"),
    canonical: canonicalEl?.href || undefined,
    ogTitle: metaContent(doc, "og:title"),
    ogDescription: metaContent(doc, "og:description"),
    ogImage: metaContent(doc, "og:image"),
    lang: doc.documentElement?.lang?.trim() || undefined,
    h1Count: doc.querySelectorAll("h1").length,
    jsonLdTypes: collectJsonLdTypes(doc),
  };
}

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
    seo: pageDigestSeo(doc),
    hint: "Use extract/query_all for precise fields; avoid get_page full. seo.* = meta/canonical/JSON-LD.",
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
        const nodes = Array.from(doc.querySelectorAll(request.selector));
        return typeInto(pickTypableTarget(nodes, request.text), request.text, request.submit);
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
        const scopeMode = request.scope ?? "auto";
        if (scopeMode === "dialog" && !findTopModal(doc)) {
          return {
            ok: false,
            error: "no open dialog/menu to scope to; use scope=auto or scope=page",
          };
        }
        const collected = collectInteractive(doc, limit, scopeMode);
        interactiveMaps.set(doc, collected.els);
        const items = collected.els.map((el, index) => ({
          i: index,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role") ?? undefined,
          text: (el.innerText || el.textContent || el.getAttribute("aria-label") || el.getAttribute("title") || "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 100),
          href: el.tagName === "A" ? (el as HTMLAnchorElement).href : undefined,
          type: isInputEl(el) ? resolveInputType(el) : undefined,
          placeholder:
            isInputEl(el) || isTextAreaEl(el) ? el.placeholder || undefined : undefined,
          name: el.getAttribute("name") ?? undefined,
          title: el.getAttribute("title") ?? undefined,
        }));
        return {
          ok: true,
          data: {
            items,
            count: items.length,
            /** dialog = open modal/menu/sheet; page = full document */
            scope: collected.scope,
            hint:
              collected.hint ??
              (items.length === 0
                ? "No interactive elements found. Close overlays (press_key Escape), hard-refresh the tab, or reload the extension."
                : undefined),
          },
        };
      }
      case "press_key": {
        const key = request.key;
        const target =
          (doc.activeElement instanceof HTMLElement ? doc.activeElement : null) ??
          (doc.body as HTMLElement | null) ??
          (doc.documentElement as HTMLElement | null);
        if (!target) return { ok: false, error: "no element to receive key event" };
        const code =
          key === "Escape"
            ? "Escape"
            : key === "Enter"
              ? "Enter"
              : key === "Tab"
                ? "Tab"
                : key === "ArrowDown"
                  ? "ArrowDown"
                  : key === "ArrowUp"
                    ? "ArrowUp"
                    : key;
        const opts: KeyboardEventInit = { key, code, bubbles: true, cancelable: true };
        target.dispatchEvent(new KeyboardEvent("keydown", opts));
        target.dispatchEvent(new KeyboardEvent("keyup", opts));
        return {
          ok: true,
          data: { key, target: target.tagName.toLowerCase() },
        };
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
      case "inject_css": {
        const checked = validatePreviewCss(request.css);
        if (!checked.ok) return { ok: false, error: checked.error };
        const head = doc.head ?? doc.documentElement;
        if (!head) return { ok: false, error: "no document head" };
        let style = doc.getElementById(PREVIEW_STYLE_ID) as HTMLStyleElement | null;
        if (!style) {
          style = doc.createElement("style");
          style.id = PREVIEW_STYLE_ID;
          head.appendChild(style);
        }
        style.textContent = checked.css;
        return {
          ok: true,
          data: { injected: true, id: PREVIEW_STYLE_ID, bytes: checked.css.length },
        };
      }
      case "clear_css": {
        const el = doc.getElementById(PREVIEW_STYLE_ID);
        if (el) el.remove();
        return { ok: true, data: { cleared: true, id: PREVIEW_STYLE_ID } };
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

/** Inputs that accept free-text titles (not temporal/numeric constrained types). */
const FREE_TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "password",
  "email",
  "url",
  "tel",
  "",
]);

/** Prefer tagName — content-script `instanceof` can fail across JS realms. */
function isInputEl(el: Element): el is HTMLInputElement {
  return el.tagName === "INPUT";
}
function isTextAreaEl(el: Element): el is HTMLTextAreaElement {
  return el.tagName === "TEXTAREA";
}
function isContentEditable(el: Element): el is HTMLElement {
  return el instanceof HTMLElement && el.isContentEditable;
}

function resolveInputType(el: HTMLInputElement): string {
  const attr = (el.getAttribute("type") || "").toLowerCase().trim();
  const prop = (typeof el.type === "string" ? el.type : "").toLowerCase().trim();
  return attr || prop || "text";
}

function looksLikeFreeTextTitle(text: string): boolean {
  const v = text.trim();
  if (!v) return false;
  // "Test Push Day", names, etc. — not HH:mm / YYYY-MM-DD / pure numbers
  if (/^\d{1,2}:\d{2}/.test(v)) return false;
  if (/^\d{4}-\d{2}-\d{2}/.test(v)) return false;
  if (/^-?\d+(\.\d+)?$/.test(v)) return false;
  return /[A-Za-z\u00C0-\u024F]/.test(v) || /\s/.test(v);
}

/**
 * Constrained HTML input types reject free text.
 * Chrome logs (and may throw) "does not conform to the required format" if we assign anyway —
 * so we must never call the value setter for invalid temporal values.
 */
function constrainedInputError(el: HTMLInputElement, text: string): string | null {
  const kind = resolveInputType(el);
  const v = text.trim();
  const show = text.length > 48 ? `${text.slice(0, 48)}…` : text;

  if (looksLikeFreeTextTitle(text) && !FREE_TEXT_INPUT_TYPES.has(kind)) {
    return (
      `Refusing to type free text into input[type=${kind || "unknown"}] (got "${show}"). ` +
      `For a plan/workout title: click the "Plan title" pencil first, then type into the text input — not time/date/number fields.`
    );
  }

  if (kind === "time" && !/^\d{1,2}:\d{2}(:\d{2}(\.\d{1,3})?)?$/.test(v)) {
    return `Cannot type into input[type=time] — value must be HH:mm (got "${show}").`;
  }
  if (kind === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    return `Cannot type into input[type=date] — value must be YYYY-MM-DD (got "${show}").`;
  }
  if (kind === "datetime-local" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) {
    return `Cannot type into input[type=datetime-local] — value must be YYYY-MM-DDTHH:mm (got "${show}").`;
  }
  if (kind === "month" && !/^\d{4}-\d{2}$/.test(v)) {
    return `Cannot type into input[type=month] — value must be YYYY-MM (got "${show}").`;
  }
  if (kind === "week" && !/^\d{4}-W\d{2}$/i.test(v)) {
    return `Cannot type into input[type=week] — value must be YYYY-Www (got "${show}").`;
  }
  if (kind === "number" && v !== "" && Number.isNaN(Number(v))) {
    return `Cannot type into input[type=number] — value must be numeric (got "${show}").`;
  }
  return null;
}

/** When type_text selector matches many nodes, prefer a field that can accept this value. */
function pickTypableTarget(nodes: Element[], text: string): Element | null {
  if (!nodes.length) return null;
  if (!looksLikeFreeTextTitle(text)) return nodes[0] ?? null;
  const textual = nodes.find((n) => {
    if (isTextAreaEl(n) || isContentEditable(n)) return true;
    if (!isInputEl(n)) return false;
    return FREE_TEXT_INPUT_TYPES.has(resolveInputType(n));
  });
  return textual ?? nodes[0] ?? null;
}

function setInputValue(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  // Prefer native setter so React controlled inputs pick up the change.
  const proto = isTextAreaEl(el) ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const desc = Object.getOwnPropertyDescriptor(proto, "value");
  if (desc?.set) desc.set.call(el, text);
  else el.value = text;
}

function typeInto(el: Element | null, text: string, submit?: boolean): ContentResponse {
  if (!el) return { ok: false, error: "no element" };
  if (!isInputEl(el) && !isTextAreaEl(el) && !isContentEditable(el)) {
    return { ok: false, error: "element is not typable" };
  }
  try {
    if (isInputEl(el) || isTextAreaEl(el)) {
      if (isInputEl(el)) {
        const bad = constrainedInputError(el, text);
        if (bad) return { ok: false, error: bad };
      }
      el.focus();
      setInputValue(el, text);
      // If the browser rejected a temporal value, .value stays empty / unchanged — treat as failure.
      if (isInputEl(el)) {
        const kind = resolveInputType(el);
        if (
          (kind === "time" || kind === "date" || kind === "datetime-local" || kind === "month" || kind === "week") &&
          text.trim() &&
          !el.value
        ) {
          return {
            ok: false,
            error: `Browser rejected value for input[type=${kind}] (got "${text.slice(0, 48)}"). Wrong field — use a text input for titles.`,
          };
        }
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      if (submit) {
        el.form?.requestSubmit?.() ??
          el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      }
    } else {
      el.focus();
      el.textContent = text;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    return { ok: true, data: { typed: text.length } };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error:
        msg.includes("required format") || msg.includes("HH:mm")
          ? `${msg} — wrong field (likely typed a title into a time/date input). Click Plan title / text input, then retry.`
          : msg,
    };
  }
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

/** Exported for element picker targeting. */
export const INTERACTIVE_SEL =
  'a[href], button, input:not([type="hidden"]), textarea, select, summary, [contenteditable="true"], [role="button"], [role="link"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="tab"], [role="switch"], [role="checkbox"], [role="radio"]';

const PAGINATION_LABEL_RE =
  /rows?\s*per\s*page|na\s*stron[eę]|wierszy|liczba\s*wierszy|items?\s*per\s*page|per\s*page/i;

/** GSC / data-grid "5,10,25,50…" listboxes must not steal get_interactive scope. */
function isEphemeralPaginationOverlay(el: HTMLElement): boolean {
  const label = [
    el.getAttribute("aria-label") ?? "",
    el.getAttribute("aria-labelledby")
      ? (el.ownerDocument.getElementById(el.getAttribute("aria-labelledby")!)?.textContent ?? "")
      : "",
    el.getAttribute("title") ?? "",
  ]
    .join(" ")
    .trim();
  if (label && PAGINATION_LABEL_RE.test(label)) return true;

  const options = Array.from(
    el.querySelectorAll('[role="option"], [role="menuitem"], button, li'),
  ) as HTMLElement[];
  const texts = options
    .map((o) => (o.innerText || o.textContent || "").trim().replace(/\s+/g, " "))
    .filter((t) => t.length > 0)
    .slice(0, 24);
  if (texts.length < 2) return false;
  // All-numeric options alone are NOT enough — quantity/year/rating/floor pickers
  // are also all-numeric. Require a pagination label on the host or its parent.
  const allNumeric = texts.every((t) => /^\d+$/.test(t));
  const near = el.parentElement?.textContent?.slice(0, 200) ?? "";
  if (allNumeric && PAGINATION_LABEL_RE.test(label)) return true;
  if (allNumeric && PAGINATION_LABEL_RE.test(near)) return true;
  return false;
}

function pickTopVisible(candidates: HTMLElement[]): HTMLElement | null {
  for (let i = candidates.length - 1; i >= 0; i--) {
    const el = candidates[i]!;
    if (!isVisible(el)) continue;
    if (el.getAttribute("aria-hidden") === "true") continue;
    return el;
  }
  return null;
}

/**
 * Topmost open dialog/modal/menu (tiered).
 * 1) ARIA dialog / aria-modal
 * 2) Menus (Radix) — skip pagination-like
 * 3) Listboxes — skip pagination-like (GSC rows-per-page)
 * 4) Heuristic: high-z fixed/absolute portals on document.body
 */
function findTopModal(doc: Document): HTMLElement | null {
  const dialogs = Array.from(
    doc.querySelectorAll('[aria-modal="true"], dialog[open], [role="dialog"]'),
  ) as HTMLElement[];
  const dialog = pickTopVisible(dialogs);
  if (dialog) return dialog;

  const menus = (
    Array.from(
      doc.querySelectorAll(
        '[role="menu"], [data-radix-menu-content], [data-radix-dropdown-menu-content], [data-state="open"][role="menu"]',
      ),
    ) as HTMLElement[]
  ).filter((el) => !isEphemeralPaginationOverlay(el));
  const menu = pickTopVisible(menus);
  if (menu) return menu;

  const listboxes = (
    Array.from(doc.querySelectorAll('[role="listbox"]')) as HTMLElement[]
  ).filter((el) => !isEphemeralPaginationOverlay(el));
  const listbox = pickTopVisible(listboxes);
  if (listbox) return listbox;

  return findTopStackedOverlay(doc);
}

function optionTextsLookLikePagination(els: HTMLElement[]): boolean {
  if (!els.length) return false;
  const texts = els
    .map((el) => (el.innerText || el.textContent || "").trim().replace(/\s+/g, " "))
    .filter((t) => t.length > 0);
  if (texts.length < 2) return false;
  return texts.every((t) => /^\d+$/.test(t));
}

/** Body-level fixed/absolute portals with high z-index + interactive children. */
function findTopStackedOverlay(doc: Document): HTMLElement | null {
  const view = doc.defaultView;
  const body = doc.body;
  if (!view || !body) return null;

  type Hit = { el: HTMLElement; z: number; score: number };
  const hits: Hit[] = [];

  const consider = (el: HTMLElement) => {
    if (!isVisible(el)) return;
    if (el.getAttribute("aria-hidden") === "true") return;
    // Skip pagination portals — they are tier-below real dialogs (Bugbot fix).
    if (isEphemeralPaginationOverlay(el)) return;
    const style = view.getComputedStyle(el);
    // Prefer computed; fall back to inline (jsdom / React style props).
    const pos = style.position !== "static" ? style.position : el.style.position || style.position;
    if (pos !== "fixed" && pos !== "absolute") return;
    const zRaw = style.zIndex !== "auto" && style.zIndex !== "" ? style.zIndex : el.style.zIndex || "0";
    const z = zRaw === "auto" ? 0 : Number.parseInt(zRaw, 10);
    if (!Number.isFinite(z) || z < 50) return;
    const interactives = el.querySelectorAll(INTERACTIVE_SEL);
    if (interactives.length < 2) return; // need a real panel, not a lone FAB
    const rect = el.getBoundingClientRect?.();
    if (!rect || (rect.width < 120 && rect.height < 120)) return;
    // Prefer compact floating panels over full-viewport shells that wrap the app.
    const vw = view.innerWidth || 1;
    const vh = view.innerHeight || 1;
    const cover = (rect.width * rect.height) / (vw * vh);
    // Full-screen dimmers (cover≈1) are OK if they host the dialog content.
    const score = z * 1000 + interactives.length * 10 - (cover > 0.95 ? 0 : cover * 5);
    hits.push({ el, z, score });
  };

  // Portals almost always append as direct body children (React createPortal).
  for (const child of Array.from(body.children) as HTMLElement[]) {
    consider(child);
    // One level deeper: wrapper > panel (mobile sheet pattern).
    for (const nested of Array.from(child.children).slice(0, 8) as HTMLElement[]) {
      consider(nested);
    }
  }

  if (!hits.length) return null;
  hits.sort((a, b) => b.score - a.score || b.z - a.z);
  return hits[0]!.el;
}

function isInsideEphemeralPagination(el: HTMLElement): boolean {
  const host = el.closest('[role="listbox"], [role="menu"]') as HTMLElement | null;
  if (!host) return false;
  return isEphemeralPaginationOverlay(host);
}

function collectFromRoot(
  _doc: Document,
  root: ParentNode,
  limit: number,
  skipOccluded: boolean,
  /** When true (scope=dialog), keep the dialog's own children even if it is a
   * pagination overlay — the caller explicitly asked for this overlay. */
  keepPaginationChildren = false,
): HTMLElement[] {
  const raw = Array.from(root.querySelectorAll(INTERACTIVE_SEL)) as HTMLElement[];
  const out: HTMLElement[] = [];
  for (const el of raw) {
    if (out.length >= limit) break;
    if (!isVisible(el)) continue;
    if (skipOccluded && isOccluded(el)) continue;
    // On scope=page/auto, hide rows-per-page options so they don't crowd the index.
    // On scope=dialog, the user explicitly asked for this overlay's contents.
    if (!keepPaginationChildren && isInsideEphemeralPagination(el)) continue;
    out.push(el);
  }
  return out;
}

function collectInteractive(
  doc: Document,
  limit: number,
  scopeMode: "auto" | "page" | "dialog" = "auto",
): { els: HTMLElement[]; scope: "dialog" | "page"; hint?: string } {
  if (scopeMode === "page") {
    const out = collectFromRoot(doc, doc, limit, true);
    if (!out.length) {
      const relaxed = collectFromRoot(doc, doc, limit, false);
      if (relaxed.length) {
        return {
          els: relaxed,
          scope: "page",
          hint: "scope=page; controls were under aria-hidden — showing them anyway.",
        };
      }
    }
    return { els: out, scope: "page", hint: "scope=page — full document (overlays ignored)." };
  }

  const modal = findTopModal(doc);
  if (scopeMode === "dialog") {
    // Caller already verified modal exists when scope=dialog.
    // keepPaginationChildren=true: the user explicitly asked for this overlay,
    // so even if it is a rows-per-page listbox, return its options (Bugbot fix).
    const out = collectFromRoot(doc, modal ?? doc, limit, false, true);
    return {
      els: out,
      scope: "dialog",
      hint: "Scoped to topmost dialog/menu/overlay — indices are only inside that layer.",
    };
  }

  // auto
  if (modal) {
    const scoped = collectFromRoot(doc, modal, limit, false);
    if (scoped.length && !optionTextsLookLikePagination(scoped)) {
      return {
        els: scoped,
        scope: "dialog",
        hint: "Scoped to topmost dialog/menu/overlay — indices are only inside that layer. Stuck? press_key Escape then get_interactive({scope:\"page\"}).",
      };
    }
    // Ephemeral pagination slipped through, or empty — fall through to page.
    const pageEls = collectFromRoot(doc, doc, limit, true);
    return {
      els: pageEls.length ? pageEls : collectFromRoot(doc, doc, limit, false),
      scope: "page",
      hint: "Ignored ephemeral listbox/menu; use press_key Escape if UI still open. Or get_interactive({scope:\"page\"}).",
    };
  }

  const out = collectFromRoot(doc, doc, limit, true);
  // Radix/shadcn often set aria-hidden on #root while a portal menu is open.
  // If that hides every control and we didn't detect the portal, fall back.
  if (!out.length) {
    const raw = Array.from(doc.querySelectorAll(INTERACTIVE_SEL)) as HTMLElement[];
    if (raw.length) {
      const relaxed = collectFromRoot(doc, doc, limit, false);
      if (relaxed.length) {
        return {
          els: relaxed,
          scope: "page",
          hint: "Page controls were under aria-hidden (open overlay?). Showing them anyway — prefer get_interactive again after closing menus (press_key Escape).",
        };
      }
    }
  }
  return { els: out, scope: "page" };
}

/** Deepest useful pick target under the cursor (not the whole page/nav). */
export function resolvePickTarget(
  clientX: number,
  clientY: number,
  doc: Document = document,
): HTMLElement | null {
  const view = doc.defaultView;
  if (!view) return null;
  const stack = (view.document.elementsFromPoint(clientX, clientY) || []) as Element[];
  const usable = stack.filter(
    (el): el is HTMLElement =>
      el instanceof HTMLElement &&
      el.id !== "combo-x-element-picker-hover" &&
      el.id !== "combo-x-element-picker-banner" &&
      el.id !== "combo-x-element-picker-tip" &&
      el.id !== "combo-x-element-picker-style",
  );
  if (!usable.length) return null;

  for (const el of usable) {
    if (el.matches(INTERACTIVE_SEL)) return el;
  }
  for (const el of usable) {
    const a = el.closest(INTERACTIVE_SEL) as HTMLElement | null;
    if (a) return a;
  }

  const vw = view.innerWidth || 1;
  const vh = view.innerHeight || 1;
  let best: HTMLElement | null = null;
  let bestArea = Infinity;
  for (const el of usable.slice(0, 16)) {
    if (el === doc.body || el === doc.documentElement) continue;
    const r = el.getBoundingClientRect();
    const area = Math.max(0, r.width) * Math.max(0, r.height);
    if (area < 16) continue;
    if (area / (vw * vh) > 0.45) continue;
    if (area < bestArea) {
      best = el;
      bestArea = area;
    }
  }
  return best ?? usable.find((el) => el !== doc.body && el !== doc.documentElement) ?? null;
}

/** One-line hover tip for the picker. */
export function describePickHover(el: HTMLElement): string {
  const tag = el.tagName.toLowerCase();
  const label =
    (el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      (el as HTMLInputElement).placeholder ||
      el.getAttribute("name") ||
      (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ")
    ).slice(0, 48) || tag;
  const interactive = el.matches(INTERACTIVE_SEL) ? "interactive" : "node";
  return `${tag} · ${interactive} · ${label}`;
}

/** Hidden by an ancestor (common for closed drawers / offscreen menus). */
function isOccluded(el: HTMLElement): boolean {
  if (el.closest("[inert]")) return true;
  let p: HTMLElement | null = el.parentElement;
  while (p) {
    if (p.getAttribute("aria-hidden") === "true") return true;
    p = p.parentElement;
  }
  return false;
}

function isVisible(el: HTMLElement): boolean {
  if (el.getAttribute("aria-hidden") === "true") return false;
  if (el.hasAttribute("inert")) return false;
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

/**
 * Snapshot a user-picked element for agent context.
 * Refreshes the interactive map so interactiveIndex matches get_interactive.
 */
export function buildPickedElementRef(el: HTMLElement, doc: Document = document): PickedElementRef {
  const collected = collectInteractive(doc, 120);
  interactiveMaps.set(doc, collected.els);
  let target = el;
  let interactiveIndex = collected.els.indexOf(el);
  if (interactiveIndex < 0) {
    const ancestor = el.closest(INTERACTIVE_SEL) as HTMLElement | null;
    if (ancestor) {
      target = ancestor;
      interactiveIndex = collected.els.indexOf(ancestor);
    }
  }
  const rect = target.getBoundingClientRect?.();
  const ariaLabel = target.getAttribute("aria-label")?.trim() || undefined;
  const titleAttr = target.getAttribute("title")?.trim() || undefined;
  const text = (
    ariaLabel ||
    titleAttr ||
    target.innerText ||
    target.textContent ||
    ""
  )
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 160);
  const className = (target.getAttribute("class") || "")
    .trim()
    .replace(/\s+/g, " ")
    .slice(0, 160);
  let value: string | undefined;
  if (isInputEl(target) || isTextAreaEl(target)) {
    const v = target.value?.trim();
    if (v) value = v.slice(0, 120);
  } else if (target instanceof HTMLSelectElement) {
    const v = target.value?.trim();
    if (v) value = v.slice(0, 120);
  }
  const outerHtml = (target.outerHTML || "").replace(/\s+/g, " ").trim().slice(0, 280);
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `pick-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return {
    id,
    url: doc.location?.href ?? "",
    title: doc.title || undefined,
    selector: buildCssPath(target),
    interactiveIndex: interactiveIndex >= 0 ? interactiveIndex : undefined,
    scope: collected.scope,
    tag: target.tagName.toLowerCase(),
    role: target.getAttribute("role") ?? undefined,
    text: text || undefined,
    name: target.getAttribute("name") ?? undefined,
    type: isInputEl(target) ? resolveInputType(target) : undefined,
    placeholder:
      isInputEl(target) || isTextAreaEl(target) ? target.placeholder || undefined : undefined,
    href: target.tagName === "A" ? (target as HTMLAnchorElement).href : undefined,
    ariaLabel,
    className: className || undefined,
    disabled:
      target.hasAttribute("disabled") || target.getAttribute("aria-disabled") === "true"
        ? true
        : undefined,
    checked:
      isInputEl(target) && (target.type === "checkbox" || target.type === "radio")
        ? target.checked
        : undefined,
    value,
    outerHtml: outerHtml || undefined,
    rect: rect
      ? { x: rect.x, y: rect.y, w: rect.width, h: rect.height }
      : undefined,
    pickedAt: new Date().toISOString(),
  };
}
