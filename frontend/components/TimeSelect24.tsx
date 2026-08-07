"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";

/** Minutes between offered times. 15 keeps the list scannable (96 rows) while
 *  still covering the quarter-hours a pick-up is actually agreed on. */
const STEP_MIN = 15;

const GRID: string[] = [];
for (let m = 0; m < 24 * 60; m += STEP_MIN) {
  GRID.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
}

const PANEL_W = 132;
const PANEL_H = 268;

function normalize(v: string): string {
  const m = /^(\d{1,2}):(\d{1,2})/.exec(v || "");
  if (!m) return "00:00";
  const hh = Math.min(23, Math.max(0, +m[1]));
  const mm = Math.min(59, Math.max(0, +m[2]));
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}

/**
 * Always-24h "HH:MM" picker.
 *
 * Wears DateField's trigger (`.df-trigger`) on purpose: a time sits next to a
 * date in every form that has one, and two controls describing one moment
 * should not look like two unrelated widgets. Clicking it opens a portal-
 * rendered list of quarter-hours — the previous version was an always-open pair
 * of scroll wheels, which cost 96px of vertical space in every row it appeared
 * in whether or not anyone was setting a time.
 *
 * `compact` mirrors DateField's: no caret, content-sized, for dense rows.
 */
export function TimeSelect24({
  value,
  onChange,
  disabled,
  compact = false,
  className = "",
  ariaLabel,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  compact?: boolean;
  className?: string;
  ariaLabel?: string;
  id?: string;
}) {
  const { t } = useI18n();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const current = normalize(value);

  // A value saved off the quarter-hour grid (imported data, an older booking)
  // is spliced into the list in order rather than being rounded away.
  const options = useMemo(() => {
    if (GRID.includes(current)) return GRID;
    const out = [...GRID, current];
    out.sort();
    return out;
  }, [current]);

  useEffect(() => setMounted(true), []);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    const top = below < PANEL_H && r.top > PANEL_H ? r.top - PANEL_H - 6 : r.bottom + 6;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - PANEL_W - 8);
    setPos({ top, left });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // Open centred on the selected time rather than at midnight — otherwise every
  // pick starts with a scroll past the small hours. Depends on `pos` because the
  // list isn't in the DOM until placement has run, and measures the row rather
  // than assuming a height, so restyling .tf-opt can't silently break this.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!open || !list) return;
    const row = list.children[options.indexOf(current)] as HTMLElement | undefined;
    if (!row) return;
    list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2);
  }, [open, pos, options, current]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation(); // don't also close the surrounding Modal
      setOpen(false);
      triggerRef.current?.focus();
    };
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (popRef.current?.contains(tgt) || triggerRef.current?.contains(tgt)) return;
      setOpen(false);
    };
    // Fixed-position popover: it can't follow the trigger, so close instead of
    // letting it drift. Capture phase, and skip scrolls inside the list itself.
    const onScroll = (e: Event) => {
      if (listRef.current?.contains(e.target as Node)) return;
      close();
    };
    // Close on resize — but only when the WIDTH actually changed. The mobile
    // on-screen keyboard shrinks the visual viewport height and fires `resize`,
    // which under the old unconditional handler dismissed the picker the moment
    // it opened beside a focused field. Height-only means keyboard: re-place.
    let lastW = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth !== lastW) {
        lastW = window.innerWidth;
        setOpen(false);
      } else {
        place();
      }
    };

    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [open, place]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const nudge = (dir: 1 | -1) => {
    const i = options.indexOf(current);
    const next = Math.min(options.length - 1, Math.max(0, i + dir));
    onChange(options[next]);
  };

  return (
    <>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel || tf("time", "Time")}
        onClick={() => !disabled && setOpen((v) => !v)}
        onKeyDown={(e) => {
          // Bump a quarter-hour without opening the list at all.
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            nudge(e.key === "ArrowDown" ? 1 : -1);
          }
        }}
        className={`df-trigger ${compact ? "is-compact" : ""} ${open ? "is-open" : ""} ${className}`}
      >
        <span className="msr df-trigger-icon">schedule</span>
        <span className="df-trigger-text">{current}</span>
        {!compact && <span className="msr df-trigger-caret">expand_more</span>}
      </button>

      {mounted && open && pos &&
        createPortal(
          <div
            ref={popRef}
            role="listbox"
            aria-label={ariaLabel || tf("time", "Time")}
            className="tf-pop"
            style={{ top: pos.top, left: pos.left, width: PANEL_W }}
          >
            <div ref={listRef} className="tf-list">
              {options.map((v) => (
                <button
                  key={v}
                  type="button"
                  role="option"
                  aria-selected={v === current}
                  onClick={() => pick(v)}
                  className={`tf-opt ${v === current ? "is-on" : ""} ${
                    GRID.includes(v) ? "" : "is-odd"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
