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
/** Hysteresis: stick when within this of bottom; unstick only when further away. */
const STICK_PX = 96;
const UNSTICK_PX = 160;

export type MessagesViewportProps = {
  itemCount: number;
  /** Re-anchor to bottom when this changes (session id / load). */
  stickKey: string | null;
  /** Bump when streaming content grows so we re-stick without changing itemCount. */
  contentTick?: number | string;
  children: (range: { start: number; end: number }) => ReactNode;
};

/**
 * Windowed message list: at most 50 turns.
 * Sticks to bottom while the user is near the bottom; ResizeObserver follows
 * content growth without fighting mid-scroll.
 */
export function MessagesViewport({
  itemCount,
  stickKey,
  contentTick = 0,
  children,
}: MessagesViewportProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [range, setRange] = useState({ start: 0, end: Math.min(WINDOW, itemCount) });
  const [showJump, setShowJump] = useState(false);
  const stickBottomRef = useRef(true);
  const lastStickKey = useRef<string | null>(null);
  const scrollingProgrammatically = useRef(false);

  const scrollToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || !stickBottomRef.current) return;
    scrollingProgrammatically.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => {
      scrollingProgrammatically.current = false;
    });
  }, []);

  const recomputeWindow = useCallback(() => {
    const el = scrollerRef.current;
    if (!el || itemCount <= WINDOW) {
      setRange({ start: 0, end: itemCount });
      return;
    }
    if (stickBottomRef.current) {
      setRange({ start: itemCount - WINDOW, end: itemCount });
      return;
    }
    const { scrollTop, scrollHeight, clientHeight } = el;
    if (scrollTop <= 48) {
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
      setShowJump(false);
      if (itemCount > WINDOW) {
        setRange({ start: itemCount - WINDOW, end: itemCount });
      } else {
        setRange({ start: 0, end: itemCount });
      }
    } else if (stickBottomRef.current && itemCount > WINDOW) {
      setRange((r) => {
        const next = { start: itemCount - WINDOW, end: itemCount };
        return r.start === next.start && r.end === next.end ? r : next;
      });
    } else if (itemCount <= WINDOW) {
      setRange((r) => (r.start === 0 && r.end === itemCount ? r : { start: 0, end: itemCount }));
    }
  }, [stickKey, itemCount]);

  useLayoutEffect(() => {
    scrollToBottom();
  }, [stickKey, itemCount, range.end, contentTick, scrollToBottom]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const onScroll = () => {
      if (scrollingProgrammatically.current) return;
      const { scrollTop, scrollHeight, clientHeight } = el;
      const dist = scrollHeight - clientHeight - scrollTop;
      if (stickBottomRef.current) {
        if (dist > UNSTICK_PX) {
          stickBottomRef.current = false;
          setShowJump(true);
          recomputeWindow();
        }
      } else if (dist <= STICK_PX) {
        stickBottomRef.current = true;
        setShowJump(false);
        recomputeWindow();
        scrollToBottom();
      } else {
        recomputeWindow();
      }
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, [recomputeWindow, scrollToBottom]);

  // Follow content height while stuck (streaming / tool chips).
  useEffect(() => {
    const root = scrollerRef.current;
    const inner = contentRef.current;
    if (!root) return;
    const ro = new ResizeObserver(() => {
      if (stickBottomRef.current) scrollToBottom();
    });
    ro.observe(root);
    if (inner) ro.observe(inner);
    return () => ro.disconnect();
  }, [scrollToBottom, itemCount, range.end]);

  const topSpacer = range.start * EST_ROW_PX;
  const bottomSpacer = Math.max(0, itemCount - range.end) * EST_ROW_PX;
  const hiddenAbove = range.start;
  const hiddenBelow = Math.max(0, itemCount - range.end);

  const jumpOlder = () => {
    stickBottomRef.current = false;
    setShowJump(true);
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
    setShowJump(false);
    setRange(
      itemCount > WINDOW
        ? { start: itemCount - WINDOW, end: itemCount }
        : { start: 0, end: itemCount },
    );
    requestAnimationFrame(() => scrollToBottom());
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
      <div ref={contentRef} className="messages-virtual-inner">
        {children(range)}
      </div>
      <div style={{ height: bottomSpacer }} aria-hidden />
      {hiddenBelow > 0 ? (
        <button type="button" className="virt-jump" onClick={jumpNewer}>
          ↓ {hiddenBelow} newer message{hiddenBelow === 1 ? "" : "s"}
        </button>
      ) : null}
      {showJump && itemCount > 0 ? (
        <button type="button" className="virt-jump bottom" onClick={jumpBottom}>
          Jump to latest
        </button>
      ) : null}
    </div>
  );
}
