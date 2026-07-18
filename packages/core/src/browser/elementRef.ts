/** Stable-enough DOM refs from the user element picker → agent turn context. */

export type PickedElementRef = {
  id: string;
  url: string;
  title?: string;
  selector: string;
  /** Index in the same ordering as get_interactive (if the node is interactive). */
  interactiveIndex?: number;
  scope?: "dialog" | "page";
  tag: string;
  role?: string;
  text?: string;
  name?: string;
  type?: string;
  placeholder?: string;
  href?: string;
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  checked?: boolean;
  value?: string;
  outerHtml?: string;
  rect?: { x: number; y: number; w: number; h: number };
  pickedAt: string;
};

/** Active browser tab at send time (always inject so the agent knows where it is). */
export type ActiveTabContext = {
  tabId?: number;
  url?: string;
  title?: string;
  /** ISO timestamp when the turn was sent. */
  at: string;
};

export function formatActiveTabBlock(tab: ActiveTabContext | null | undefined): string {
  if (!tab) return "";
  const lines = [
    "## Active browser tab",
    "This is the tab the user is looking at right now. Prefer tools against this tab unless they ask otherwise.",
    `at: ${tab.at}`,
  ];
  if (tab.tabId != null) lines.push(`tabId: ${tab.tabId}`);
  if (tab.url) lines.push(`url: ${tab.url}`);
  if (tab.title) lines.push(`title: ${JSON.stringify(tab.title)}`);
  return lines.join("\n");
}

/** Build a CSS selector path usable with click/type_text/extract. */
export function buildCssPath(el: Element): string {
  if (!(el instanceof Element)) return "";
  const doc = el.ownerDocument;
  const id = el.getAttribute("id");
  if (id && /^[A-Za-z][\w:-]*$/.test(id)) {
    try {
      if (doc.querySelectorAll(`#${cssEscape(id)}`).length === 1) {
        return `#${cssEscape(id)}`;
      }
    } catch {
      /* fall through */
    }
  }
  const testId =
    el.getAttribute("data-testid") ||
    el.getAttribute("data-test") ||
    el.getAttribute("data-cy");
  if (testId) {
    const sel = `[data-testid=${JSON.stringify(testId)}]`;
    try {
      if (doc.querySelectorAll(sel).length === 1) return sel;
    } catch {
      /* fall through */
    }
  }

  const parts: string[] = [];
  let cur: Element | null = el;
  while (cur && cur.nodeType === 1 && cur !== doc.documentElement) {
    const node: Element = cur;
    let part = node.tagName.toLowerCase();
    if (node.id && /^[A-Za-z][\w:-]*$/.test(node.id)) {
      parts.unshift(`#${cssEscape(node.id)}`);
      break;
    }
    const parent: Element | null = node.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(
        (c): c is Element => c.tagName === node.tagName,
      );
      if (siblings.length > 1) {
        const idx = siblings.indexOf(node) + 1;
        part += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(part);
    cur = parent;
    if (parts.length >= 8) break;
  }
  return parts.join(" > ") || el.tagName.toLowerCase();
}

function cssEscape(id: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(id);
  }
  return id.replace(/([ !"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, "\\$1");
}

export function formatPickedElementsBlock(refs: PickedElementRef[]): string {
  if (!refs.length) return "";
  const lines = [
    "## Picked element(s) from user",
    "The user selected these on the page. Treat them as the primary target for this turn.",
    "If interactiveIndex is set: call get_interactive first (indices may be stale after nav/DOM changes), then click_index / type_index.",
    "Otherwise use click / type_text / extract with the given CSS selector. Re-check with get_interactive if click misses.",
    "",
  ];
  refs.forEach((r, i) => {
    lines.push(`${i + 1}. pickedAt: ${r.pickedAt}`);
    lines.push(`   pageUrl: ${r.url}`);
    if (r.title) lines.push(`   pageTitle: ${JSON.stringify(r.title)}`);
    lines.push(`   selector: \`${r.selector}\``);
    if (r.interactiveIndex != null) {
      lines.push(
        `   interactiveIndex: ${r.interactiveIndex}${r.scope ? ` (scope=${r.scope})` : ""}`,
      );
    } else {
      lines.push("   interactiveIndex: (none — not in get_interactive list; use selector)");
    }
    lines.push(`   tag: ${r.tag}`);
    if (r.role) lines.push(`   role: ${r.role}`);
    if (r.type) lines.push(`   type: ${r.type}`);
    if (r.name) lines.push(`   name: ${r.name}`);
    if (r.ariaLabel) lines.push(`   aria-label: ${JSON.stringify(r.ariaLabel)}`);
    if (r.placeholder) lines.push(`   placeholder: ${r.placeholder}`);
    if (r.href) lines.push(`   href: ${r.href}`);
    if (r.className) lines.push(`   class: ${JSON.stringify(r.className)}`);
    if (r.disabled != null) lines.push(`   disabled: ${r.disabled}`);
    if (r.checked != null) lines.push(`   checked: ${r.checked}`);
    if (r.value) lines.push(`   value: ${JSON.stringify(r.value)}`);
    if (r.text) lines.push(`   text: ${JSON.stringify(r.text)}`);
    if (r.rect) {
      lines.push(
        `   rect: ${Math.round(r.rect.x)},${Math.round(r.rect.y)} ${Math.round(r.rect.w)}×${Math.round(r.rect.h)}`,
      );
    }
    if (r.outerHtml) lines.push(`   outerHTML: ${JSON.stringify(r.outerHtml)}`);
    lines.push("");
  });
  return lines.join("\n").trimEnd();
}

/** Combine tab + picks for the LLM user turn (single block). */
export function formatBrowserContextBlock(opts: {
  tab?: ActiveTabContext | null;
  picks?: PickedElementRef[];
}): string {
  return [formatActiveTabBlock(opts.tab), formatPickedElementsBlock(opts.picks ?? [])]
    .filter(Boolean)
    .join("\n\n");
}

export function pickedElementChipLabel(ref: PickedElementRef): string {
  const label = (ref.text || ref.name || ref.placeholder || ref.tag).trim().slice(0, 40);
  if (ref.interactiveIndex != null) return `[${ref.interactiveIndex}] ${label}`;
  return label || ref.selector.slice(0, 40);
}
