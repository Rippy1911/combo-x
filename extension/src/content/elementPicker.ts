import {
  buildPickedElementRef,
  describePickHover,
  resolvePickTarget,
  type PickedElementRef,
} from "@combo-x/core";

const STYLE_ID = "combo-x-element-picker-style";
const HOVER_ID = "combo-x-element-picker-hover";
const BANNER_ID = "combo-x-element-picker-banner";
const TIP_ID = "combo-x-element-picker-tip";

type PickResult =
  | { ok: true; data: PickedElementRef }
  | { ok: false; cancelled?: boolean; error?: string };

let active = false;
let finish: ((result: PickResult) => void) | null = null;

function ensureStyle(doc: Document) {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
#${HOVER_ID} {
  position: fixed !important;
  pointer-events: none !important;
  z-index: 2147483646 !important;
  border: 2px solid #2563eb !important;
  background: rgba(37, 99, 235, 0.12) !important;
  border-radius: 2px !important;
  box-sizing: border-box !important;
  margin: 0 !important;
  padding: 0 !important;
}
#${BANNER_ID} {
  position: fixed !important;
  top: 12px !important;
  left: 50% !important;
  transform: translateX(-50%) !important;
  z-index: 2147483647 !important;
  background: #0f172a !important;
  color: #f8fafc !important;
  font: 13px/1.4 system-ui, sans-serif !important;
  padding: 8px 14px !important;
  border-radius: 8px !important;
  box-shadow: 0 8px 24px rgba(0,0,0,.35) !important;
  pointer-events: none !important;
}
#${TIP_ID} {
  position: fixed !important;
  pointer-events: none !important;
  z-index: 2147483647 !important;
  background: #0f172a !important;
  color: #e2e8f0 !important;
  font: 11px/1.35 ui-monospace, SFMono-Regular, Menlo, monospace !important;
  padding: 4px 8px !important;
  border-radius: 6px !important;
  box-shadow: 0 4px 16px rgba(0,0,0,.4) !important;
  max-width: min(360px, 90vw) !important;
  white-space: nowrap !important;
  overflow: hidden !important;
  text-overflow: ellipsis !important;
}
`;
  (doc.head || doc.documentElement).appendChild(style);
}

function ensureHover(doc: Document): HTMLElement {
  let box = doc.getElementById(HOVER_ID) as HTMLElement | null;
  if (!box) {
    box = doc.createElement("div");
    box.id = HOVER_ID;
    doc.documentElement.appendChild(box);
  }
  return box;
}

function ensureTip(doc: Document): HTMLElement {
  let tip = doc.getElementById(TIP_ID) as HTMLElement | null;
  if (!tip) {
    tip = doc.createElement("div");
    tip.id = TIP_ID;
    doc.documentElement.appendChild(tip);
  }
  return tip;
}

function ensureBanner(doc: Document) {
  if (doc.getElementById(BANNER_ID)) return;
  const banner = doc.createElement("div");
  banner.id = BANNER_ID;
  banner.textContent = "Combo-X: hover for details · click to pick · Esc cancel";
  doc.documentElement.appendChild(banner);
}

function clearUi(doc: Document) {
  doc.getElementById(HOVER_ID)?.remove();
  doc.getElementById(TIP_ID)?.remove();
  doc.getElementById(BANNER_ID)?.remove();
  doc.getElementById(STYLE_ID)?.remove();
}

function moveHover(doc: Document, el: HTMLElement | null, clientX: number, clientY: number) {
  if (!el) return;
  const box = ensureHover(doc);
  const tip = ensureTip(doc);
  const r = el.getBoundingClientRect();
  box.style.left = `${Math.max(0, r.left)}px`;
  box.style.top = `${Math.max(0, r.top)}px`;
  box.style.width = `${Math.max(0, r.width)}px`;
  box.style.height = `${Math.max(0, r.height)}px`;
  tip.textContent = describePickHover(el);
  const tipW = Math.min(360, (doc.defaultView?.innerWidth || 400) * 0.9);
  let left = clientX + 12;
  let top = clientY + 16;
  if (left + tipW > (doc.defaultView?.innerWidth || 0) - 8) left = clientX - tipW - 12;
  if (top > (doc.defaultView?.innerHeight || 0) - 40) top = clientY - 28;
  tip.style.left = `${Math.max(4, left)}px`;
  tip.style.top = `${Math.max(4, top)}px`;
}

function settle(result: PickResult) {
  if (!active) return;
  active = false;
  const doc = document;
  doc.removeEventListener("mousemove", onMove, true);
  doc.removeEventListener("click", onClick, true);
  doc.removeEventListener("keydown", onKey, true);
  doc.removeEventListener("scroll", onScroll, true);
  clearUi(doc);
  const cb = finish;
  finish = null;
  cb?.(result);
}

function onMove(ev: MouseEvent) {
  const el = resolvePickTarget(ev.clientX, ev.clientY, document);
  if (el) moveHover(document, el, ev.clientX, ev.clientY);
}

function onScroll() {
  /* tip updates on next mousemove */
}

function onClick(ev: MouseEvent) {
  ev.preventDefault();
  ev.stopPropagation();
  ev.stopImmediatePropagation();
  const el = resolvePickTarget(ev.clientX, ev.clientY, document);
  if (!el) {
    settle({ ok: false, error: "no element" });
    return;
  }
  try {
    const ref = buildPickedElementRef(el, document);
    settle({ ok: true, data: ref });
  } catch (e) {
    settle({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

function onKey(ev: KeyboardEvent) {
  if (ev.key === "Escape") {
    ev.preventDefault();
    ev.stopPropagation();
    settle({ ok: false, cancelled: true });
  }
}

export function stopElementPicker() {
  settle({ ok: false, cancelled: true });
}

export function startElementPicker(done: (result: PickResult) => void) {
  if (active) stopElementPicker();
  active = true;
  finish = done;
  const doc = document;
  ensureStyle(doc);
  ensureBanner(doc);
  ensureHover(doc);
  ensureTip(doc);
  doc.addEventListener("mousemove", onMove, true);
  doc.addEventListener("click", onClick, true);
  doc.addEventListener("keydown", onKey, true);
  doc.addEventListener("scroll", onScroll, true);
}

export function isElementPickerActive(): boolean {
  return active;
}
