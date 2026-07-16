import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

const WINDOW = 50;
const HALF = 25;
const EST_ROW_PX = 120;

export type MessagesViewportProps = {
  itemCount: number;
  /** Re-anchor to bottom when this changes (session id / load). */
  stickKey: string | null;
  children: (range: { start: number; end: number }) => ReactNode;
};

/**
 * Windowed message list: at most 50 turns.
 * - Stuck to bottom → last 50 (50 above)
 * - Near top → first 50
 * - Mid-scroll → ~25 above / 25 below estimated center
 */
export function MessagesViewport({ itemCount, stickKey, children }: MessagesViewportProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(WINDOW, itemCount) });
  const stickBottomRef = useRef(true);
  const lastStickKey = useRef<string | null>(null);

  const recompute = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || itemCount <= WINDOW) {
      setRange({ start: 0, end: itemCount });
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = el;
    const atBottom = scrollTop + clientHeight >= scrollHeight - 48;
    const atTop = scrollTop <= 48;

    if (stickBottomRef.current || atBottom) {
      stickBottomRef.current = atBottom;
      setRange({ start: itemCount - WINDOW, end: itemCount });
      return;
    }
    if (atTop) {
      setRange({ start: 0, end: WINDOW });
      return;
    }
    const maxScroll = Math.max(1, scrollHeight - clientHeight);
    const frac = scrollTop / maxScroll;
    const center = Math.floor(frac * itemCount);
    const start = Math.max(0, Math.min(itemCount - WINDOW, center - HALF));
    setRange({ start, end: start + WINDOW });
  }, [itemCount]);

  useLayoutEffect(() => {
    if (stickKey !== lastStickKey.current) {
      lastStickKey.current = stickKey;
      stickBottomRef.current = true;
      if (itemCount > WINDOW) {
        setRange({ start: itemCount - WINDOW, end: itemCount });
      } else {
        setRange({ start: 0, end: itemCount });
      }
    } else if (stickBottomRef.current && itemCount > WINDOW) {
      setRange({ start: itemCount - WINDOW, end: itemCount });
    } else if (itemCount <= WINDOW) {
      setRange({ start: 0, end: itemCount });
    }
  }, [stickKey, itemCount]);

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [stickKey, itemCount, range.end]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = el;
      stickBottomRef.current = scrollTop + clientHeight >= scrollHeight - 48;
      recompute();
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [recompute]);

  const topSpacer = range.start * EST_ROW_PX;
  const bottomSpacer = Math.max(0, itemCount - range.end) * EST_ROW_PX;

  const hiddenAbove = range.start;
  const hiddenBelow = Math.max(0, itemCount - range.end);

  const jumpOlder = () => {
    stickBottomRef.current = false;
    setRange((r) => {
      const start = Math.max(0, r.start - HALF);
      return { start, end: Math.min(itemCount, start + WINDOW) };
    });
    requestAnimationFrame(() => {
      const el = scrollerRef.current;
      if (el) el.scrollTop = Math.max(0, el.scrollTop - HALF * EST_ROW_PX);
    });
  };

  const jumpNewer = () => {
    setRange((r) => {
      const end = Math.min(itemCount, r.end + HALF);
      const start = Math.max(0, end - WINDOW);
      return { start, end };
    });
  };

  const jumpBottom = () => {
    stickBottomRef.current = true;
    setRange(
      itemCount > WINDOW
        ? { start: itemCount - WINDOW, end: itemCount }
        : { start: 0, end: itemCount },
    );
    requestAnimationFrame(() => {
      const el = scrollerRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    });
  };

  const label = useMemo(() => {
    if (itemCount <= WINDOW) return null;
    return `Showing ${range.start + 1}–${range.end} of ${itemCount}`;
  }, [itemCount, range]);

  return (
    <div className="messages messages-virtual" ref={scrollerRef}>
      {label ? <div className="virt-meta hint">{label}</div> : null}
      {hiddenAbove > 0 ? (
        <button type="button" className="virt-jump" onClick={jumpOlder}>
          ↑ {hiddenAbove} earlier message{hiddenAbove === 1 ? "" : "s"}
        </button>
      ) : null}
      <div style={{ height: topSpacer }} aria-hidden />
      {children(range)}
      <div style={{ height: bottomSpacer }} aria-hidden />
      {hiddenBelow > 0 ? (
        <button type="button" className="virt-jump" onClick={jumpNewer}>
          ↓ {hiddenBelow} newer message{hiddenBelow === 1 ? "" : "s"}
        </button>
      ) : null}
      {!stickBottomRef.current && itemCount > 0 ? (
        <button type="button" className="virt-jump bottom" onClick={jumpBottom}>
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}
