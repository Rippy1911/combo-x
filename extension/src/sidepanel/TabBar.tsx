import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

export type TabDef = { id: string; label: string };

const ORDER_KEY = "combo_x_tab_order_v1";
const MORE_RESERVE_PX = 76;

function migrateTabId(id: string): string {
  if (id === "views" || id === "tools" || id === "mcp") return "libraries";
  return id;
}

function loadOrder(defaults: string[]): string[] {
  try {
    const raw = localStorage.getItem(ORDER_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as string[];
    if (!Array.isArray(parsed)) return defaults;
    const known = new Set(defaults);
    const ordered: string[] = [];
    for (const id of parsed.map(migrateTabId)) {
      if (!known.has(id) || ordered.includes(id)) continue;
      ordered.push(id);
    }
    for (const id of defaults) {
      if (!ordered.includes(id)) ordered.push(id);
    }
    return ordered;
  } catch {
    return defaults;
  }
}

function saveOrder(ids: string[]) {
  try {
    localStorage.setItem(ORDER_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export function TabBar({
  tabs,
  active,
  onSelect,
}: {
  tabs: TabDef[];
  active: string;
  onSelect: (id: string) => void;
}) {
  const defaultIds = useMemo(() => tabs.map((t) => t.id), [tabs]);
  const labelById = useMemo(() => new Map(tabs.map((t) => [t.id, t.label])), [tabs]);
  const [order, setOrder] = useState<string[]>(() => loadOrder(defaultIds));
  const [visibleCount, setVisibleCount] = useState(tabs.length);
  const [dragId, setDragId] = useState<string | null>(null);

  const navRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOrder((prev) => {
      const merged = prev.filter((id) => defaultIds.includes(id));
      for (const id of defaultIds) if (!merged.includes(id)) merged.push(id);
      return merged.length ? merged : loadOrder(defaultIds);
    });
  }, [defaultIds]);

  const orderedTabs = useMemo(
    () =>
      order
        .map((id) => ({ id, label: labelById.get(id) ?? id }))
        .filter((t) => labelById.has(t.id)),
    [order, labelById],
  );

  const recompute = useCallback(() => {
    const nav = navRef.current;
    const measure = measureRef.current;
    if (!nav || !measure || !orderedTabs.length) return;

    const kids = [...measure.querySelectorAll<HTMLElement>("[data-measure-tab]")];
    const widths = kids.map((el) => el.offsetWidth);
    const gap = 2;
    const fullWidth = widths.reduce((s, w) => s + w + gap, 0);

    // Everything fits — no More menu.
    if (fullWidth <= nav.clientWidth - 4) {
      setVisibleCount(orderedTabs.length);
      return;
    }

    const budget = nav.clientWidth - MORE_RESERVE_PX - 4;
    let used = 0;
    let count = 0;
    for (const w of widths) {
      if (count > 0 && used + w + gap > budget) break;
      used += w + gap;
      count += 1;
    }
    count = Math.max(1, count);

    // Keep the active tab in the visible strip when possible.
    const activeIdx = orderedTabs.findIndex((t) => t.id === active);
    if (activeIdx >= count) {
      // Show tabs up through active, then trim from the left until it fits.
      let start = 0;
      let end = activeIdx + 1;
      const widthRange = (a: number, b: number) => {
        let s = 0;
        for (let i = a; i < b; i++) s += (widths[i] ?? 0) + gap;
        return s;
      };
      while (start < activeIdx && widthRange(start, end) > budget) {
        start += 1;
      }
      // Display still uses order prefix; if active is far right, bump count.
      count = Math.min(orderedTabs.length, Math.max(count, activeIdx + 1));
      while (count > 1 && widthRange(0, count) > budget && activeIdx < count - 1) {
        count -= 1;
      }
      if (activeIdx >= count) count = activeIdx + 1;
    }

    setVisibleCount(Math.min(orderedTabs.length, Math.max(1, count)));
  }, [active, orderedTabs]);

  useLayoutEffect(() => {
    recompute();
  }, [recompute]);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => recompute());
    ro.observe(nav);
    return () => ro.disconnect();
  }, [recompute]);

  const visible = orderedTabs.slice(0, visibleCount);
  const overflow = orderedTabs.slice(visibleCount);
  const moreValue = overflow.some((t) => t.id === active) ? active : "";

  const moveTab = (fromId: string, toId: string) => {
    if (fromId === toId) return;
    setOrder((prev) => {
      const next = [...prev];
      const from = next.indexOf(fromId);
      const to = next.indexOf(toId);
      if (from < 0 || to < 0) return prev;
      next.splice(from, 1);
      next.splice(to, 0, fromId);
      saveOrder(next);
      return next;
    });
  };

  return (
    <nav className="tabs" ref={navRef} aria-label="Main">
      <div className="tabs-measure" ref={measureRef} aria-hidden>
        {orderedTabs.map((t) => (
          <button key={t.id} type="button" className="tab" data-measure-tab={t.id} tabIndex={-1}>
            {t.label}
          </button>
        ))}
      </div>

      {visible.map((t) => (
        <button
          key={t.id}
          type="button"
          className={
            active === t.id
              ? dragId === t.id
                ? "tab active dragging"
                : "tab active"
              : dragId === t.id
                ? "tab dragging"
                : "tab"
          }
          draggable
          onDragStart={() => setDragId(t.id)}
          onDragEnd={() => setDragId(null)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (dragId) moveTab(dragId, t.id);
            setDragId(null);
          }}
          onClick={() => onSelect(t.id)}
          title="Drag to reorder (saved on this device)"
        >
          {t.label}
        </button>
      ))}

      {overflow.length > 0 ? (
        <select
          className="tab-more"
          aria-label="More tabs"
          value={moreValue}
          onChange={(e) => {
            const id = e.target.value;
            if (id) onSelect(id);
          }}
        >
          <option value="">More…</option>
          {overflow.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      ) : null}
    </nav>
  );
}
