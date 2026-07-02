"use client";
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useT } from "@/lib/i18n";

/** First letters of the first two words, upper-cased ("Renault Clio" -> "RC"). */
export function initialsOf(name: string): string {
  const p = (name || "").trim().split(/\s+/);
  const i = ((p[0] || "")[0] || "") + ((p[1] || "")[0] || "");
  return i.toUpperCase() || "—";
}

/**
 * Swipe-style rental card shell (ported from the "Swipe Rentals" design, kept in
 * the app's monochrome branding): a neutral header band with an initials avatar,
 * name + mono reference and an optional pill chip, over a themeable body.
 *
 * Shared by the Fleet, Customers and Reservations card views (via SwipeDeck) so
 * the three stay in lockstep. Everything themes off the app tokens, so it follows
 * night mode and any super-admin recolour automatically.
 */
export function SwipeCard({
  name,
  reference,
  chip,
  chipTitle,
  initials,
  children,
}: {
  name: string;
  reference?: ReactNode;
  chip?: ReactNode;
  chipTitle?: string;
  /** Override the avatar text (defaults to the first letters of `name`). */
  initials?: string;
  children: ReactNode;
}) {
  return (
    <div className="swipe-card h-full flex flex-col">
      <div className="swipe-band">
        <div className="swipe-avatar">{initials ?? initialsOf(name)}</div>
        <div className="min-w-0 flex-1">
          <div className="swipe-name">{name}</div>
          {reference != null && <div className="swipe-ref">{reference}</div>}
        </div>
        {chip != null && (
          <div className="swipe-chip" title={chipTitle}>
            {chip}
          </div>
        )}
      </div>
      <div className="swipe-body flex-1">{children}</div>
    </div>
  );
}

/** A labelled body cell — tiny uppercase label above its value(s). */
export function SwipeField({
  label,
  children,
  className = "",
}: {
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="swipe-label">{label}</div>
      {children}
    </div>
  );
}

/** The highlighted sub-panel (period / pricing / summary). */
export function SwipePanel({ children }: { children: ReactNode }) {
  return <div className="swipe-panel">{children}</div>;
}

// Cards per page by breakpoint (matches the design's 3-up desktop stage).
function usePerPage() {
  const [pp, setPp] = useState(3);
  useEffect(() => {
    const calc = () => {
      const w = window.innerWidth;
      setPp(w >= 1024 ? 3 : w >= 640 ? 2 : 1);
    };
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, []);
  return pp;
}

// Numbered-pagination window with ellipses: always show first/last two + the
// current neighbourhood; `null` marks a gap. Ported from the design's pageItems.
function pageWindow(cur: number, n: number): (number | null)[] {
  const idx = [...new Set([0, 1, cur - 1, cur, cur + 1, n - 2, n - 1])]
    .filter((i) => i >= 0 && i < n)
    .sort((a, b) => a - b);
  const out: (number | null)[] = [];
  let prev = -1;
  idx.forEach((i) => {
    if (i - prev > 1) out.push(null);
    out.push(i);
    prev = i;
  });
  return out;
}

/**
 * Swipe deck — a horizontal drag-scroll strip of cards with side prev/next nav and
 * a numbered pagination bar, showing `perPage` cards in view (3/2/1 by breakpoint).
 *
 * Interactions (matches a mobile carousel):
 *  - Touch: native horizontal scroll (keeps iOS momentum/rubber-band).
 *  - Mouse/pen: pointer-drag (a 6px threshold + one-shot click suppressor keeps a
 *    drag from firing a card's action button).
 *  - Seamless infinite loop: when there are more items than fit, the list is
 *    rendered three times and the scroll position is silently kept inside the
 *    middle copy, so swiping past either end flows straight into the other.
 *
 * Optional props let non-deck callers (the dashboard availability carousel) reuse
 * it with fixed-width cards: `cardClassName`, `itemWidth`, `gap`, `loop`.
 */
export function SwipeDeck<T>({
  items,
  render,
  keyOf,
  empty,
  cardClassName = "",
  itemWidth,
  gap = 16,
  loop = true,
}: {
  items: T[];
  render: (item: T) => ReactNode;
  keyOf: (item: T) => string | number;
  empty?: ReactNode;
  /** Extra class on each card wrapper (e.g. the dashboard's `card p-3 space-y-2`). */
  cardClassName?: string;
  /** Fixed card width classes (e.g. `w-[260px] sm:w-[280px]`); omit for deck sizing. */
  itemWidth?: string;
  /** Gap between cards in px (kept in sync with the flex gap; default 16 = gap-4). */
  gap?: number;
  /** Seamless wrap-around when the list overflows (default true). */
  loop?: boolean;
}) {
  const t = useT();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));
  const perPage = usePerPage();
  const n = items.length;
  const looping = loop && n > perPage;

  const scrollRef = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  // Mutable drag state — never triggers a re-render mid-drag.
  const drag = useRef({ down: false, startX: 0, startScroll: 0, moved: false, id: 0 });
  // Guards the scroll handler while we reposition programmatically (loop wrap).
  const adjusting = useRef(false);

  const stepOf = () => {
    const el = scrollRef.current;
    const first = el?.firstElementChild as HTMLElement | null;
    return first ? first.offsetWidth + gap : 0;
  };

  // Center on the middle copy whenever the count / breakpoint / gap changes.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    setIdx(0);
    const step = stepOf();
    adjusting.current = true;
    el.scrollLeft = looping ? n * step : 0;
    requestAnimationFrame(() => {
      adjusting.current = false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [n, perPage, looping, gap]);

  const onScroll = () => {
    const el = scrollRef.current;
    if (!el || adjusting.current) return;
    const step = stepOf();
    if (step <= 0) return;
    let sl = el.scrollLeft;
    if (looping) {
      const copyW = n * step;
      // Keep the viewport parked inside the middle copy so both ends have runway.
      if (sl < copyW * 0.5) {
        sl += copyW;
        adjusting.current = true;
        el.scrollLeft = sl;
        requestAnimationFrame(() => {
          adjusting.current = false;
        });
      } else if (sl > copyW * 1.5) {
        sl -= copyW;
        adjusting.current = true;
        el.scrollLeft = sl;
        requestAnimationFrame(() => {
          adjusting.current = false;
        });
      }
      setIdx(((Math.round((sl - copyW) / step) % n) + n) % n);
    } else {
      setIdx(Math.max(0, Math.min(n - 1, Math.round(sl / step))));
    }
  };

  // Animate scrollLeft to a target via rAF (native `behavior:"smooth"` is a no-op
  // in some embedded/headless browsers, so we tween it ourselves — works
  // everywhere and lands on a snap point). Reposition is suppressed during the
  // tween, then the position is normalized back into the middle copy.
  const animateTo = (target: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const startLeft = el.scrollLeft;
    const dist = target - startLeft;
    if (Math.abs(dist) < 1) return;
    adjusting.current = true;
    // Off-snap intermediate frames would be fought by mandatory snap; disable it
    // for the duration of the tween (restored when it lands on a snap point).
    el.style.scrollSnapType = "none";
    const dur = 300;
    const ease = (x: number) => 1 - Math.pow(1 - x, 3);
    let t0: number | null = null;
    // Safety net: if rAF never fires (e.g. a backgrounded tab suspends it), release
    // the reposition guard + snap anyway so the loop/pagination don't stay frozen.
    const release = setTimeout(() => {
      adjusting.current = false;
      el.style.scrollSnapType = "";
    }, dur + 250);
    const frame = (ts: number) => {
      if (!scrollRef.current) return;
      if (t0 === null) t0 = ts;
      const p = Math.min(1, (ts - t0) / dur);
      el.scrollLeft = startLeft + dist * ease(p);
      if (p < 1) {
        requestAnimationFrame(frame);
      } else {
        if (looping) {
          const step = stepOf();
          const copyW = n * step;
          if (el.scrollLeft < copyW * 0.5) el.scrollLeft += copyW;
          else if (el.scrollLeft > copyW * 1.5) el.scrollLeft -= copyW;
        }
        clearTimeout(release);
        el.style.scrollSnapType = "";
        adjusting.current = false;
        onScroll(); // sync the highlighted pill to the final position
      }
    };
    requestAnimationFrame(frame);
  };

  // Jump to a specific logical card (numbered-pill click).
  const scrollToLogical = (p: number) => {
    const step = stepOf();
    if (step <= 0) return;
    const base = looping ? n * step : 0;
    animateTo(base + p * step);
  };

  // Advance one card; loop-wrap is normalized at the end of the tween.
  const nudge = (dir: number) => {
    const el = scrollRef.current;
    if (!el) return;
    const step = stepOf();
    if (step <= 0) return;
    animateTo(el.scrollLeft + dir * step);
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return; // native touch scroll (keeps momentum)
    const el = scrollRef.current;
    if (!el) return;
    drag.current = { down: true, startX: e.clientX, startScroll: el.scrollLeft, moved: false, id: e.pointerId };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d.down) return;
    const el = scrollRef.current;
    if (!el) return;
    const dx = e.clientX - d.startX;
    if (!d.moved && Math.abs(dx) > 6) {
      d.moved = true;
      el.classList.add("is-dragging");
      try {
        el.setPointerCapture(d.id);
      } catch {}
    }
    if (d.moved) el.scrollLeft = d.startScroll - dx;
  };
  const endDrag = () => {
    const d = drag.current;
    if (!d.down) return;
    d.down = false;
    const el = scrollRef.current;
    if (el && d.moved) {
      el.classList.remove("is-dragging");
      try {
        el.releasePointerCapture(d.id);
      } catch {}
      // Swallow the click a drag would otherwise fire on a card button.
      const kill = (ev: Event) => {
        ev.stopPropagation();
        ev.preventDefault();
        el.removeEventListener("click", kill, true);
      };
      el.addEventListener("click", kill, true);
      setTimeout(() => el.removeEventListener("click", kill, true), 60);
    }
  };

  if (n === 0) return <>{empty}</>;

  const multi = n > 1;
  const copies = looping ? 3 : 1;
  const itemStyle = itemWidth
    ? undefined
    : { flex: `0 0 calc((100% - ${(perPage - 1) * gap}px) / ${perPage})` };

  return (
    <div className="relative">
      {multi && (
        <button
          className="swipe-nav left hidden sm:grid"
          onClick={() => nudge(-1)}
          aria-label={tf("prev", "Previous")}
          title={tf("prev", "Previous")}
        >
          <span className="msr text-[18px]">chevron_left</span>
        </button>
      )}
      {multi && (
        <button
          className="swipe-nav right hidden sm:grid"
          onClick={() => nudge(1)}
          aria-label={tf("next", "Next")}
          title={tf("next", "Next")}
        >
          <span className="msr text-[18px]">chevron_right</span>
        </button>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={endDrag}
        className="swipe-strip flex overflow-x-auto snap-x snap-mandatory pb-2 items-stretch [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        style={{ gap: `${gap}px` }}
      >
        {Array.from({ length: copies }).flatMap((_, c) =>
          items.map((it) => (
            <div
              key={`${c}:${keyOf(it)}`}
              className={`snap-start shrink-0 ${itemWidth ?? ""} ${cardClassName}`}
              style={itemStyle}
            >
              {render(it)}
            </div>
          ))
        )}
      </div>

      {multi && (
        <div className="flex items-center justify-center gap-1.5 mt-4 flex-wrap">
          <button
            className="swipe-nav-inline sm:hidden"
            onClick={() => nudge(-1)}
            aria-label={tf("prev", "Previous")}
          >
            <span className="msr text-[16px]">chevron_left</span>
          </button>
          {pageWindow(idx, n).map((p, i) =>
            p === null ? (
              <span key={`gap-${i}`} className="swipe-pg-gap">
                …
              </span>
            ) : (
              <button
                key={p}
                className={`swipe-pg ${p === idx ? "is-active" : ""}`}
                onClick={() => scrollToLogical(p)}
                aria-current={p === idx ? "page" : undefined}
              >
                {p + 1}
              </button>
            )
          )}
          <button
            className="swipe-nav-inline sm:hidden"
            onClick={() => nudge(1)}
            aria-label={tf("next", "Next")}
          >
            <span className="msr text-[16px]">chevron_right</span>
          </button>
        </div>
      )}
    </div>
  );
}
