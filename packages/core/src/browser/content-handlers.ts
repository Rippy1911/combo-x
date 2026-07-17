import type { ContentRequest, ContentResponse } from "../protocol/messages.js";
import {
  PREVIEW_STYLE_ID,
  validatePreviewCss,
} from "../vision/annotateHtml.js";

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
        const collected = collectInteractive(doc, limit);
        interactiveMaps.set(doc, collected.els);
        const items = collected.els.map((el, index) => ({
          i: index,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role") ?? undefined,
          text: (el.innerText || el.textContent || el.getAttribute("aria-label") || "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 100),
          href: el.tagName === "A" ? (el as HTMLAnchorElement).href : undefined,
          type: isInputEl(el) ? resolveInputType(el) : undefined,
          placeholder:
            isInputEl(el) || isTextAreaEl(el) ? el.placeholder || undefined : undefined,
          name: el.getAttribute("name") ?? undefined,
        }));
        return {
          ok: true,
          data: {
            items,
            count: items.length,
            /** dialog = open modal/sheet; page = full document */
            scope: collected.scope,
            hint:
              collected.scope === "dialog"
                ? "Scoped to topmost dialog/overlay (ARIA or high-z portal) — indices are only inside that layer, not the page behind."
                : undefined,
          },
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

const INTERACTIVE_SEL =
  'a[href], button, input:not([type="hidden"]), textarea, select, [role="button"], [role="link"], summary, [contenteditable="true"]';

/**
 * Topmost open dialog/modal.
 * 1) ARIA: [aria-modal], role=dialog, dialog[open]
 * 2) Heuristic (Nanobrowser-style stacking): high-z fixed/absolute portals on
 *    document.body — e.g. airon.coach FloatingWorkoutEditor (z-index 9999) which
 *    historically lacked role=dialog, so calendar buttons filled the index.
 */
function findTopModal(doc: Document): HTMLElement | null {
  const candidates = Array.from(
    doc.querySelectorAll('[aria-modal="true"], dialog[open], [role="dialog"]'),
  ) as HTMLElement[];
  for (let i = candidates.length - 1; i >= 0; i--) {
    const el = candidates[i]!;
    if (!isVisible(el)) continue;
    if (el.getAttribute("aria-hidden") === "true") continue;
    return el;
  }
  return findTopStackedOverlay(doc);
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

function collectInteractive(
  doc: Document,
  limit: number,
): { els: HTMLElement[]; scope: "dialog" | "page" } {
  const modal = findTopModal(doc);
  const root: ParentNode = modal ?? doc;
  const raw = Array.from(root.querySelectorAll(INTERACTIVE_SEL)) as HTMLElement[];
  const out: HTMLElement[] = [];
  for (const el of raw) {
    if (out.length >= limit) break;
    if (!isVisible(el)) continue;
    // When scoped to dialog, keep everything visible inside it.
    // On full page, skip nodes under aria-hidden / inert ancestors.
    if (!modal && isOccluded(el)) continue;
    out.push(el);
  }
  return { els: out, scope: modal ? "dialog" : "page" };
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
