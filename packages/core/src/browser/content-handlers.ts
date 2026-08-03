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

/**
 * Site chrome — nav/header/footer/sidebars. On app consoles (Google Play, GSC,
 * Base44) this is 10–50× the size of the actual content, so a naive body-text
 * read returns 100% chrome and the agent learns nothing. Everything here is
 * *tagged*, never silently deleted: callers opt in via `region`.
 */
const CHROME_SEL =
  'nav, header, footer, aside, [role="navigation"], [role="banner"], [role="contentinfo"], [role="complementary"], [role="menubar"], [role="toolbar"]';

/** Preferred primary-content roots, most specific first. */
const MAIN_SEL =
  'main, [role="main"], article, #main, #content, #main-content, .main-content, [class*="page-content"]';

/** Upper bound on elements scanned per get_interactive call (paging needs a total). */
const INTERACTIVE_SCAN_CAP = 600;

/**
 * The interactive map keyed off `document` survives client-side navigation in a
 * SPA, so its elements can be detached while the map still looks populated —
 * click_index would then "succeed" against a node nobody can see. Treat a map
 * whose entries have left the DOM as absent.
 */
function liveInteractiveMap(doc: Document): HTMLElement[] | undefined {
  const map = interactiveMaps.get(doc);
  if (!map?.length) return undefined;
  const connected = map.some((el) => el.isConnected !== false && doc.contains(el));
  if (!connected) {
    interactiveMaps.delete(doc);
    return undefined;
  }
  return map;
}

/** The page's primary content root, or null when the page has no clear main. */
function findMainRoot(doc: Document): HTMLElement | null {
  for (const sel of MAIN_SEL.split(",")) {
    const el = doc.querySelector(sel.trim());
    if (el instanceof HTMLElement && (el.textContent ?? "").trim().length > 40) {
      return el;
    }
  }
  return null;
}

/** "nav" when the element lives inside site chrome, else "main". */
function regionOf(el: Element, mainRoot: HTMLElement | null): "main" | "nav" {
  if (el.closest(CHROME_SEL)) return "nav";
  if (mainRoot) return mainRoot.contains(el) ? "main" : "nav";
  return "main";
}

/** Row-ish containers used by get_interactive `within` scoping. */
const ROW_CONTAINER_SEL =
  'tr, [role="row"], li, [role="listitem"], article, section, fieldset, dd, [class*="row"], [class*="Row"]';

/**
 * Validate a caller-supplied CSS selector for subtree pruning. Invalid
 * selectors become a no-op — a tool call must never throw on bad input.
 */
function safePruneSelector(doc: Document, raw: string | undefined): string | null {
  const sel = raw?.trim();
  if (!sel) return null;
  try {
    doc.querySelector(sel);
    return sel;
  } catch {
    return null;
  }
}

/** Remove matching subtrees from a cloned root; returns pruned char count. */
function pruneFromClone(clone: HTMLElement, pruneSel: string | null): number {
  if (!pruneSel) return 0;
  let chars = 0;
  for (const n of Array.from(clone.querySelectorAll(pruneSel))) {
    chars += (n.textContent ?? "").length;
    n.remove();
  }
  return chars;
}

function stripNonText(root: HTMLElement): void {
  for (const sel of [
    "script",
    "style",
    "noscript",
    "svg",
    "template",
    // Collapsed panels (e.g. a hidden chat column) still pollute text reads —
    // their markup stays in the DOM when hidden. Skip [hidden] and inline
    // display:none/visibility:hidden subtrees. aria-hidden is deliberately
    // NOT stripped: apps aria-hide the whole root behind open modals.
    "[hidden]",
    '[style*="display: none"]',
    '[style*="display:none"]',
    '[style*="visibility: hidden"]',
    '[style*="visibility:hidden"]',
  ]) {
    for (const n of Array.from(root.querySelectorAll(sel))) n.remove();
  }
}

function normalizeText(raw: string): string {
  return raw
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const BLOCK_TAGS = new Set([
  "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "BR", "BUTTON", "DD", "DIV", "DL", "DT",
  "FIELDSET", "FIGCAPTION", "FIGURE", "FOOTER", "FORM", "H1", "H2", "H3", "H4", "H5", "H6",
  "HEADER", "HR", "LABEL", "LI", "MAIN", "NAV", "OL", "OPTION", "P", "PRE", "SECTION",
  "TABLE", "TD", "TH", "TR", "UL",
]);

/**
 * Text with block elements separated by newlines.
 *
 * `innerText` only inserts line breaks for *rendered* elements — and we read
 * from a detached clone, so it degrades to `textContent` and glues every
 * paragraph into one line. That silently broke line-oriented features (and made
 * page text far harder to read). Emulate block separation ourselves.
 */
function blockAwareText(root: HTMLElement): string {
  const parts: string[] = [];
  const visit = (node: Node): void => {
    if (node.nodeType === 3 /* TEXT_NODE */) {
      parts.push(node.textContent ?? "");
      return;
    }
    if (node.nodeType !== 1 /* ELEMENT_NODE */) return;
    const el = node as Element;
    const block = BLOCK_TAGS.has(el.tagName);
    if (block) parts.push("\n");
    for (const child of Array.from(el.childNodes)) visit(child);
    if (block) parts.push("\n");
  };
  visit(root);
  return parts.join("");
}

/**
 * Text of the primary content region with site chrome removed.
 * Returns the chrome char count so the caller can tell the agent what it skipped.
 */
function mainText(
  doc: Document,
  pruneSel: string | null = null,
): { text: string; region: string; chromeChars: number; prunedChars: number } {
  const body = doc.body;
  if (!body) return { text: "", region: "none", chromeChars: 0, prunedChars: 0 };
  const mainRoot = findMainRoot(doc);
  const source = mainRoot ?? body;
  const clone = source.cloneNode(true) as HTMLElement;
  stripNonText(clone);

  const prunedChars = pruneFromClone(clone, pruneSel);
  let chromeChars = 0;
  for (const n of Array.from(clone.querySelectorAll(CHROME_SEL))) {
    chromeChars += (n.textContent ?? "").length;
    n.remove();
  }

  return {
    text: normalizeText(blockAwareText(clone)),
    region: mainRoot ? mainRoot.tagName.toLowerCase() : "body-minus-chrome",
    chromeChars,
    prunedChars,
  };
}

/** Keep only lines matching `needle` — lets the agent grep a huge document. */
function filterLines(text: string, needle: string): { text: string; matched: number } {
  const lower = needle.toLowerCase();
  const lines = text.split("\n");
  const kept = lines.filter((l) => l.toLowerCase().includes(lower));
  return { text: kept.join("\n"), matched: kept.length };
}

/** Inverse of `filterLines` — strips repeated boilerplate (cookie bars, legal footers). */
function dropLines(text: string, needle: string): { text: string; removed: number } {
  const lower = needle.toLowerCase();
  const lines = text.split("\n");
  const kept = lines.filter((l) => !l.toLowerCase().includes(lower));
  return { text: kept.join("\n"), removed: lines.length - kept.length };
}

/**
 * Window a string and describe the window so the agent can page instead of
 * giving up. `nextOffset` is null when the tail has been reached.
 */
function windowText(
  text: string,
  offset: number,
  cap: number,
): {
  slice: string;
  totalChars: number;
  offset: number;
  nextOffset: number | null;
  hasMore: boolean;
} {
  const start = Math.min(Math.max(0, offset), text.length);
  const end = Math.min(start + cap, text.length);
  const hasMore = end < text.length;
  return {
    slice: text.slice(start, end),
    totalChars: text.length,
    offset: start,
    nextOffset: hasMore ? end : null,
    hasMore,
  };
}

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
        // `main` is the default: whole-body reads on app consoles return pure
        // nav chrome and burn the char budget before reaching any content.
        const mode = request.mode ?? "main";
        const maxChars = request.maxChars ?? MAX_TEXT;
        if (mode === "structure") {
          return { ok: true, data: pageDigest(doc) };
        }

        const pruneSel = safePruneSelector(doc, request.excludeSelector);
        const useMain = mode === "main" || mode === "snippet";
        const extracted = useMain
          ? mainText(doc, pruneSel)
          : { text: visibleText(doc, pruneSel), region: "body", chromeChars: 0, prunedChars: 0 };

        let text = extracted.text;
        let filterMatched: number | undefined;
        if (request.filter?.trim()) {
          const filtered = filterLines(text, request.filter.trim());
          text = filtered.text;
          filterMatched = filtered.matched;
        }
        let excludedLines: number | undefined;
        if (request.exclude?.trim()) {
          const dropped = dropLines(text, request.exclude.trim());
          text = dropped.text;
          excludedLines = dropped.removed;
        }

        const cap = mode === "snippet" ? Math.min(maxChars, 2_500) : maxChars;
        const win = windowText(text, request.offset ?? 0, cap);

        return {
          ok: true,
          data: {
            title: doc.title,
            url: doc.location?.href ?? "",
            text: win.slice,
            mode,
            region: extracted.region,
            chromeSkippedChars: extracted.chromeChars || undefined,
            ...(filterMatched != null
              ? { filter: request.filter, filterMatchedLines: filterMatched }
              : {}),
            ...(excludedLines != null
              ? { exclude: request.exclude, excludedLines }
              : {}),
            totalChars: win.totalChars,
            offset: win.offset,
            nextOffset: win.nextOffset,
            hasMore: win.hasMore,
            truncated: win.hasMore,
            hint: win.hasMore
              ? `Showing chars ${win.offset}–${win.offset + win.slice.length} of ${win.totalChars}. Continue with get_page({offset:${win.nextOffset}${mode !== "main" ? `, mode:"${mode}"` : ""}}) or narrow with get_page({filter:"…"}).`
              : [
                  useMain && extracted.chromeChars > 0
                    ? `Skipped ${extracted.chromeChars} chars of nav/header/footer chrome. Use mode:"full" if you need it.`
                    : null,
                  extracted.prunedChars > 0
                    ? `Pruned ${extracted.prunedChars} chars matching excludeSelector.`
                    : null,
                ]
                  .filter(Boolean)
                  .join(" ") || undefined,
          },
        };
      }
      case "page_digest":
        return { ok: true, data: pageDigest(doc) };
      case "get_links": {
        const limit = request.limit ?? 30;
        const offset = request.offset ?? 0;
        const needle = request.filter?.trim().toLowerCase() ?? "";
        const banned = request.exclude?.trim().toLowerCase() ?? "";
        const wantRegion = request.region ?? "any";
        const wantOrigin = request.origin ?? "any";
        const pageOrigin = doc.location?.origin ?? "";
        const mainRoot = findMainRoot(doc);

        const scanned = Array.from(doc.querySelectorAll("a[href]"))
          .map((a) => ({
            text: (a.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 120),
            href: (a as HTMLAnchorElement).href,
            region: regionOf(a, mainRoot),
          }))
          .filter((l) => l.href)
          .filter((l) => wantRegion === "any" || l.region === wantRegion)
          .filter((l) => {
            if (wantOrigin === "any" || !pageOrigin) return true;
            const internal = l.href.startsWith(pageOrigin);
            return wantOrigin === "internal" ? internal : !internal;
          })
          .filter(
            (l) =>
              !needle ||
              l.text.toLowerCase().includes(needle) ||
              l.href.toLowerCase().includes(needle),
          )
          .filter(
            (l) =>
              !banned ||
              !(l.text.toLowerCase().includes(banned) || l.href.toLowerCase().includes(banned)),
          );

        // Drawer + header + footer usually repeat the same destinations; the
        // duplicates are pure token cost.
        let duplicates = 0;
        let all = scanned;
        if (request.unique) {
          const seen = new Set<string>();
          all = scanned.filter((l) => {
            if (seen.has(l.href)) return false;
            seen.add(l.href);
            return true;
          });
          duplicates = scanned.length - all.length;
        }

        const page = all.slice(offset, offset + limit).map((l) => projectFields(l, request.fields));
        const nextOffset = offset + page.length < all.length ? offset + page.length : null;
        return {
          ok: true,
          data: {
            links: page,
            shown: page.length,
            total: all.length,
            offset,
            nextOffset,
            hasMore: nextOffset != null,
            ...(duplicates > 0 ? { duplicatesCollapsed: duplicates } : {}),
            hint:
              nextOffset != null
                ? `${all.length} links match; showing ${page.length}. Page with get_links({offset:${nextOffset}}), or narrow with filter/exclude/region:"main"/unique:true.`
                : undefined,
          },
        };
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
        const offset = request.offset ?? 0;
        const contextChars = request.context ?? 0;
        const needle = request.text.toLowerCase();

        // Reuse the live interactive map when one exists so indices reported here
        // stay valid for click_index; build one on demand so find_text alone is
        // actionable. The map is per-Document, so navigation clears it naturally.
        let map = liveInteractiveMap(doc);
        let mapRefreshed = false;
        if (!map?.length) {
          map = collectInteractive(doc, INTERACTIVE_SCAN_CAP, "page").els;
          interactiveMaps.set(doc, map);
          mapRefreshed = true;
        }
        const mainRoot = findMainRoot(doc);

        type Hit = {
          index: number;
          text: string;
          tag: string;
          region: "main" | "nav";
          interactiveIndex?: number;
          clickable: boolean;
        };
        const banned = request.exclude?.trim().toLowerCase() ?? "";
        const wantRegion = request.region ?? "any";
        const pruneSel = safePruneSelector(doc, request.excludeSelector);
        const all: Hit[] = [];
        const walker = doc.createTreeWalker(doc.body ?? doc, NodeFilter.SHOW_TEXT);
        let node = walker.nextNode();
        while (node && all.length < 500) {
          const raw = (node.textContent ?? "").trim();
          if (raw.length > 1 && raw.toLowerCase().includes(needle)) {
            const parent = node.parentElement;
            const host = (parent?.closest(INTERACTIVE_SEL) as HTMLElement | null) ?? null;
            const mapIdx = host ? map.indexOf(host) : -1;
            const body =
              contextChars > 0
                ? normalizeText(parent?.textContent ?? raw).slice(0, 200 + contextChars)
                : raw.slice(0, 200);
            const region = parent ? regionOf(parent, mainRoot) : "main";
            const keep =
              (!request.clickableOnly || mapIdx >= 0) &&
              (wantRegion === "any" || region === wantRegion) &&
              (!banned || !body.toLowerCase().includes(banned)) &&
              (!pruneSel || !parent?.closest(pruneSel));
            if (keep) {
              all.push({
                index: all.length,
                text: body,
                tag: parent?.tagName?.toLowerCase() ?? "text",
                region,
                ...(mapIdx >= 0 ? { interactiveIndex: mapIdx } : {}),
                clickable: mapIdx >= 0,
              });
            }
          }
          node = walker.nextNode();
        }

        const matches = all.slice(offset, offset + limit);
        if (request.scrollIntoView && matches.length) {
          const first = matches[0]!;
          const el = first.interactiveIndex != null ? map[first.interactiveIndex] : null;
          el?.scrollIntoView?.({ block: "center", behavior: "instant" as ScrollBehavior });
        }
        const nextOffset = offset + matches.length < all.length ? offset + matches.length : null;
        const clickableCount = matches.filter((m) => m.clickable).length;

        return {
          ok: true,
          data: {
            matches,
            count: matches.length,
            total: all.length,
            offset,
            nextOffset,
            hasMore: nextOffset != null,
            mapRefreshed,
            hint: !all.length
              ? "No match. Text may be inside an iframe, lazily rendered, or differently cased/accented — try a shorter distinctive substring."
              : clickableCount > 0
                ? `${clickableCount} of ${matches.length} hits sit inside a control — act directly with click_index({index:<interactiveIndex>}).`
                : nextOffset != null
                  ? `Showing ${matches.length} of ${all.length}. Page with find_text({text:"…", offset:${nextOffset}}).`
                  : undefined,
          },
        };
      }
      case "get_interactive": {
        const limit = request.limit ?? 80;
        const offset = request.offset ?? 0;
        const scopeMode = request.scope ?? "auto";
        if (scopeMode === "dialog" && !findTopModal(doc)) {
          return {
            ok: false,
            error: "no open dialog/menu to scope to; use scope=auto or scope=page",
          };
        }

        // Scan a superset so `i` is an absolute, stable handle into the map:
        // filtering and paging then never invalidate click_index.
        const collected = collectInteractive(doc, INTERACTIVE_SCAN_CAP, scopeMode);
        interactiveMaps.set(doc, collected.els);
        const mainRoot = findMainRoot(doc);
        const all = collected.els.map((el, index) => describeInteractive(el, index, mainRoot));

        const needle = request.filter?.trim().toLowerCase() ?? "";
        const banned = request.exclude?.trim().toLowerCase() ?? "";
        const wantKind = request.kind ?? "any";
        const wantState = request.state ?? "any";
        let wantRegion = request.region ?? "any";
        const pruneSel = safePruneSelector(doc, request.excludeSelector);

        // Row-scoping: keep controls inside a container matching within.selector
        // and/or containing within.text. Post-scan filtering keeps `i` absolute,
        // so click_index stays valid.
        const withinSel = request.within?.selector
          ? safePruneSelector(doc, request.within.selector)
          : null;
        const withinText = request.within?.text?.trim().toLowerCase() ?? "";
        let withinIdx: Set<number> | null = null;
        if (withinSel || withinText) {
          const containers = new Set<Element>();
          if (withinSel) {
            for (const el of Array.from(doc.querySelectorAll(withinSel))) containers.add(el);
          }
          if (withinText && doc.body) {
            const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
            let node = walker.nextNode();
            let guard = 0;
            while (node && guard < 8000) {
              guard += 1;
              if ((node.textContent ?? "").toLowerCase().includes(withinText)) {
                const host = node.parentElement;
                if (host) containers.add(host.closest(ROW_CONTAINER_SEL) ?? host);
              }
              node = walker.nextNode();
            }
          }
          withinIdx = new Set<number>();
          collected.els.forEach((el, idx) => {
            for (const c of containers) {
              if (c === el || c.contains(el)) {
                withinIdx!.add(idx);
                break;
              }
            }
          });
        }

        const byKindAndFilter = all
          .filter((it) => wantKind === "any" || it.kind === wantKind)
          .filter((it) =>
            wantState === "any" ? true : wantState === "disabled" ? !!it.disabled : !it.disabled,
          )
          .filter((it) => !request.requireLabel || it.text.length > 0)
          .filter((it) => !needle || interactiveHaystack(it).includes(needle))
          .filter((it) => !banned || !interactiveHaystack(it).includes(banned))
          .filter((it) => !pruneSel || !collected.els[it.i]?.closest(pruneSel))
          .filter((it) => !withinIdx || withinIdx.has(it.i));

        // Adaptive default: on console-style pages the nav alone exceeds any
        // sane limit. When the caller did not choose, prefer main content and
        // say so — rather than silently handing back 100 sidebar links.
        let regionAuto = false;
        if (request.region == null && !needle) {
          const mainOnly = byKindAndFilter.filter((it) => it.region === "main");
          if (byKindAndFilter.length > limit && mainOnly.length > 0 && mainOnly.length < byKindAndFilter.length) {
            wantRegion = "main";
            regionAuto = true;
          }
        }

        const matched = byKindAndFilter.filter(
          (it) => wantRegion === "any" || it.region === wantRegion,
        );
        const items = matched
          .slice(offset, offset + limit)
          .map((it) => projectFields(it, request.fields, "i"));
        const nextOffset = offset + items.length < matched.length ? offset + items.length : null;

        const navCount = byKindAndFilter.filter((it) => it.region === "nav").length;
        const hints = [collected.hint];
        if (regionAuto) {
          hints.push(
            `Auto-scoped to main content (${matched.length} of ${byKindAndFilter.length} controls; ${navCount} nav/header/footer controls hidden). Pass region:"any" or region:"nav" to see them.`,
          );
        }
        if (nextOffset != null) {
          hints.push(
            `Showing ${items.length} of ${matched.length}. Page with get_interactive({offset:${nextOffset}}) or jump straight to one with get_interactive({filter:"<label>"}).`,
          );
        }
        if (needle && !matched.length) {
          hints.push(
            `No control matches "${request.filter}". Try a shorter substring, region:"any", state:"any", or find_text({text:"…"}) which reports a clickable interactiveIndex.`,
          );
        }
        if (withinIdx) {
          hints.push(
            withinIdx.size > 0
              ? `within scoping: ${withinIdx.size} control(s) sit inside the matching row/container(s) — indices stay absolute for click_index.`
              : `within matched no controls — check the exact row text (must match the cell) or selector, or drop within.`,
          );
        }
        const disabledHidden =
          wantState === "enabled" ? all.filter((it) => it.disabled).length : 0;
        if (disabledHidden > 0) {
          hints.push(`${disabledHidden} disabled control(s) hidden by state:"enabled".`);
        }
        if (!all.length) {
          hints.push(
            "No interactive elements found. Close overlays (press_key Escape), hard-refresh the tab, or reload the extension.",
          );
        }

        return {
          ok: true,
          data: {
            items,
            count: items.length,
            /** Controls left after kind/filter/region — `i` indexes the full scan. */
            matched: matched.length,
            total: all.length,
            offset,
            nextOffset,
            hasMore: nextOffset != null,
            region: wantRegion,
            regionCounts: {
              main: all.filter((it) => it.region === "main").length,
              nav: all.filter((it) => it.region === "nav").length,
            },
            /** dialog = open modal/menu/sheet; page = full document */
            scope: collected.scope,
            hint: hints.filter(Boolean).join(" ") || undefined,
          },
        };
      }
      case "list_form_fields": {
        const limit = request.limit ?? 100;
        const pruneSel = safePruneSelector(doc, request.excludeSelector);
        const wantRegion = request.region ?? "any";
        const mainRoot = findMainRoot(doc);

        // Refresh the interactive map so returned `i` handles work with type_index.
        let map = liveInteractiveMap(doc);
        let mapRefreshed = false;
        if (!map?.length) {
          map = collectInteractive(doc, INTERACTIVE_SCAN_CAP, "page").els;
          interactiveMaps.set(doc, map);
          mapRefreshed = true;
        }

        const raw = Array.from(doc.querySelectorAll(FORM_FIELD_SEL)) as HTMLElement[];
        const fields: Array<Record<string, unknown>> = [];
        let total = 0;
        for (const el of raw) {
          if (!isVisible(el)) continue;
          if (pruneSel && el.closest(pruneSel)) continue;
          const region = regionOf(el, mainRoot);
          if (wantRegion !== "any" && region !== wantRegion) continue;
          total += 1;
          if (fields.length >= limit) continue;
          const type = formFieldType(el);
          const isPassword = type === "password";
          const value = formFieldValue(el);
          const mapIdx = map.indexOf(el);
          fields.push({
            ...(mapIdx >= 0 ? { i: mapIdx } : {}),
            tag: el.tagName.toLowerCase(),
            type,
            label: formFieldLabel(el, doc),
            name: el.getAttribute("name") ?? undefined,
            placeholder: el.getAttribute("placeholder") ?? undefined,
            region,
            disabled: isDisabled(el) || undefined,
            hasValue: value.length > 0,
            ...(isPassword ? {} : { value: value.slice(0, 80) || undefined }),
            ...(mapIdx < 0 ? { unmapped: true } : {}),
          });
        }
        return {
          ok: true,
          data: {
            fields,
            count: fields.length,
            total,
            mapRefreshed: mapRefreshed || undefined,
            hint: fields.length
              ? "Rows carrying i are type_index-ready: type_index({index:<i>, text:\"…\"}). Passwords never return a value (hasValue only)."
              : "No form fields visible — inputs may appear after a click (inline editors) or live in an iframe.",
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
        const map = liveInteractiveMap(doc);
        if (!map?.length) {
          return {
            ok: false,
            error:
              "no live interactive map — the page changed since the last get_interactive. Call get_interactive (filter:\"…\") again, then click_index.",
          };
        }
        const el = map[request.index];
        if (!el) return { ok: false, error: `no interactive at index ${request.index}` };
        el.click();
        return { ok: true, data: { clickedIndex: request.index, tag: el.tagName.toLowerCase() } };
      }
      case "type_index": {
        const map = liveInteractiveMap(doc);
        if (!map?.length) {
          return {
            ok: false,
            error:
              "no live interactive map — the page changed since the last get_interactive. Call get_interactive (filter:\"…\") again, then type_index.",
          };
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
          el = liveInteractiveMap(doc)?.[request.index] ?? null;
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

export type InteractiveItem = {
  i: number;
  tag: string;
  kind: "link" | "button" | "input" | "select";
  region: "main" | "nav";
  role?: string;
  text: string;
  href?: string;
  type?: string;
  placeholder?: string;
  name?: string;
  title?: string;
  /** Only set when true — clicking it is a wasted turn. */
  disabled?: boolean;
};

/**
 * Narrow an item to the keys the caller asked for.
 *
 * A 100-control listing is mostly fields the agent will not read; `fields`
 * turns it into `{i, text}` and cuts the payload by an order of magnitude.
 * `always` keys (the click index) survive any projection.
 */
function projectFields<T extends Record<string, unknown>>(
  item: T,
  fields: readonly string[] | undefined,
  ...always: string[]
): Record<string, unknown> {
  if (!fields?.length) return item;
  const keep = new Set<string>([...fields, ...always]);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(item)) {
    if (keep.has(key) && item[key] !== undefined) out[key] = item[key];
  }
  return out;
}

/** `disabled` attribute, ARIA equivalent, or an inert ancestor fieldset. */
function isDisabled(el: HTMLElement): boolean {
  if ((el as HTMLButtonElement).disabled === true) return true;
  const aria = el.getAttribute("aria-disabled");
  if (aria === "true") return true;
  return el.closest("fieldset[disabled],[aria-disabled='true']") != null;
}

/** Coarse control family used by the `kind` filter. */
function interactiveKind(el: HTMLElement): InteractiveItem["kind"] {
  const tag = el.tagName;
  const role = (el.getAttribute("role") ?? "").toLowerCase();
  if (tag === "SELECT") return "select";
  if (tag === "TEXTAREA") return "input";
  if (tag === "INPUT") {
    const t = resolveInputType(el as HTMLInputElement);
    return t === "button" || t === "submit" || t === "reset" ? "button" : "input";
  }
  if (tag === "A" || role === "link") return "link";
  if (el.isContentEditable) return "input";
  return "button";
}

function describeInteractive(
  el: HTMLElement,
  index: number,
  mainRoot: HTMLElement | null,
): InteractiveItem {
  return {
    i: index,
    tag: el.tagName.toLowerCase(),
    kind: interactiveKind(el),
    region: regionOf(el, mainRoot),
    role: el.getAttribute("role") ?? undefined,
    text: (
      el.innerText ||
      el.textContent ||
      el.getAttribute("aria-label") ||
      el.getAttribute("title") ||
      ""
    )
      .trim()
      .replace(/\s+/g, " ")
      .slice(0, 100),
    href: el.tagName === "A" ? (el as HTMLAnchorElement).href : undefined,
    type: isInputEl(el) ? resolveInputType(el) : undefined,
    placeholder: isInputEl(el) || isTextAreaEl(el) ? el.placeholder || undefined : undefined,
    name: el.getAttribute("name") ?? undefined,
    title: el.getAttribute("title") ?? undefined,
    disabled: isDisabled(el) || undefined,
  };
}

/** Everything `filter` searches: label, aria/title, form name, placeholder, href. */
function interactiveHaystack(it: InteractiveItem): string {
  return [it.text, it.title, it.name, it.placeholder, it.href, it.role]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Fillable controls surfaced by list_form_fields. */
const FORM_FIELD_SEL =
  'input:not([type="hidden"]), textarea, select, [contenteditable="true"], [contenteditable=""]';

function formFieldType(el: HTMLElement): string {
  if (el.tagName === "TEXTAREA") return "textarea";
  if (el.tagName === "SELECT") return "select";
  // Attribute check too — jsdom does not always implement isContentEditable.
  if (el.isContentEditable || el.hasAttribute("contenteditable")) return "richtext";
  return resolveInputType(el as HTMLInputElement);
}

function formFieldValue(el: HTMLElement): string {
  if (el.tagName === "SELECT") {
    const sel = el as HTMLSelectElement;
    return (sel.selectedOptions?.[0]?.textContent ?? sel.value ?? "").trim();
  }
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    return ((el as HTMLInputElement).value ?? "").trim();
  }
  return (el.textContent ?? "").trim();
}

/**
 * Best-effort accessible label for a form control: label[for], wrapping
 * <label>, aria-label, aria-labelledby, a label-ish previous sibling, then
 * placeholder/name as the fallback identity.
 */
function formFieldLabel(el: HTMLElement, doc: Document): string | undefined {
  const clean = (raw: string | null | undefined): string | undefined => {
    const t = (raw ?? "").replace(/\s+/g, " ").trim();
    return t ? t.slice(0, 80) : undefined;
  };
  if (el.id) {
    const safeId =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(el.id)
        : el.id.replace(/["\\]/g, "");
    try {
      const t = clean(doc.querySelector(`label[for="${safeId}"]`)?.textContent);
      if (t) return t;
    } catch {
      /* fall through to the next strategy */
    }
  }
  const wrap = el.closest("label");
  if (wrap) {
    const t = clean(wrap.textContent);
    if (t) return t;
  }
  const aria = clean(el.getAttribute("aria-label"));
  if (aria) return aria;
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const t = clean(
      labelledBy
        .split(/\s+/)
        .map((id) => doc.getElementById(id)?.textContent ?? "")
        .join(" "),
    );
    if (t) return t;
  }
  const sib = el.previousElementSibling;
  if (sib && /^(LABEL|SPAN|DIV|P)$/.test(sib.tagName)) {
    const t = clean(sib.textContent);
    if (t) return t;
  }
  return clean(el.getAttribute("placeholder")) ?? clean(el.getAttribute("name"));
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

function visibleText(doc: Document, pruneSel: string | null = null): string {
  const body = doc.body;
  if (!body) return "";
  const clone = body.cloneNode(true) as HTMLElement;
  stripNonText(clone);
  pruneFromClone(clone, pruneSel);
  return normalizeText(blockAwareText(clone));
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
  // Same scan width as get_interactive so a picked element's interactiveIndex
  // matches the index the agent would see when it lists controls.
  const collected = collectInteractive(doc, INTERACTIVE_SCAN_CAP);
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
