"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/lib/i18n";
import {
  addMonths,
  buildMonth,
  clampISO,
  datePresets,
  formatDisplay,
  formatWeekday,
  isValidISO,
  isWithin,
  monthLabels,
  monthOf,
  todayISO,
  yearOptions,
  type ISODate,
} from "@/lib/dates";

/**
 * The app's one date input.
 *
 * Replaces every `<input type="date">`: those render as a different control in
 * each browser (and a full-screen OS sheet on mobile), ignore the app's theme
 * tokens entirely, and can't show a rental span. This one is a themed trigger
 * plus a portal-rendered calendar popover driven by lib/dates.ts, so Fleet,
 * Reservations, Finance and Settings all get the identical control.
 *
 * The popover is a preset rail beside one month: the rail jumps to the days that
 * get picked most (today, ±a week, ±a month) and the month header carries real
 * month/year `select`s, so a date a year out is two clicks rather than twelve
 * presses of the chevron.
 *
 * `rangeStart`/`rangeEnd` are display-only: pass the booking's start and return
 * days and both pickers tint the nights in between, so the pick-up and return
 * fields visibly describe one rental rather than two unrelated dates.
 *
 * `compact` shrinks the trigger to just an icon plus the date ("21 Sep 2025"),
 * sized to its content instead of filling the row. Dense forms — the booking
 * dialog packs four date/time controls onto one line — use it so the date
 * fields stop dictating how wide the dialog has to be.
 */
export function DateField({
  value,
  onChange,
  min,
  max,
  disabled,
  rangeStart,
  rangeEnd,
  placeholder,
  compact = false,
  className = "",
  ariaLabel,
  id,
}: {
  value: ISODate | "";
  onChange: (iso: ISODate) => void;
  min?: ISODate;
  max?: ISODate;
  disabled?: boolean;
  rangeStart?: ISODate | "";
  rangeEnd?: ISODate | "";
  placeholder?: string;
  compact?: boolean;
  className?: string;
  ariaLabel?: string;
  id?: string;
}) {
  const { t, lang } = useI18n();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState(() => monthOf(value || undefined));
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    width: number;
    /** Set when the panel had to be clamped below its natural 362px — switches
     *  the preset rail from a side column to a strip above the month. */
    narrow: boolean;
  } | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);

  const today = todayISO();

  useEffect(() => setMounted(true), []);

  // Re-open on the month the current value lives in (and follow it when the
  // value is changed from outside, e.g. days-stepper feedback into return date).
  useEffect(() => {
    if (isValidISO(value)) setView(monthOf(value));
  }, [value]);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const PANEL_H = 312;
    // The calendar is a fixed-size card, never stretched to the trigger: a
    // full-width field would otherwise open an absurdly wide month grid.
    // 248 for the month + 114 for the preset rail beside it.
    const PANEL_W = 362;
    // ...except when the viewport is narrower than the card plus its gutters.
    // The old clamp assumed it always fit: at 375px `innerWidth - 362 - 8`
    // is 5, which lost to the `Math.max(8, …)` floor and pinned the panel flush
    // to the left edge with nothing to spare on the right; under ~370px the
    // target went negative and pushed it off-screen entirely. Clamping the WIDTH
    // first makes the rest of the maths sound at any size, and `is-narrow`
    // restacks the rail above the month (globals.css) so the content fits too.
    const w = Math.min(PANEL_W, window.innerWidth - 16);
    const narrow = w < PANEL_W;
    // Flip above the trigger when there isn't room below (long forms, modals
    // near the bottom of the viewport).
    const below = window.innerHeight - r.bottom;
    const top = below < PANEL_H && r.top > PANEL_H ? r.top - PANEL_H - 6 : r.bottom + 6;
    const left = Math.min(Math.max(8, r.left), window.innerWidth - w - 8);
    setPos({ top, left, width: w, narrow });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
  }, [open, place]);

  // A fixed-position popover doesn't follow its trigger, so close on any scroll
  // or resize rather than letting it drift away from the field.
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation(); // don't also close the surrounding Modal
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => {
      const tgt = e.target as Node;
      if (popRef.current?.contains(tgt) || triggerRef.current?.contains(tgt)) return;
      setOpen(false);
    };
    // Close on resize — but only when the WIDTH actually changed. On mobile the
    // on-screen keyboard shrinks the visual viewport height and fires `resize`,
    // so the unconditional version dismissed the picker the instant it opened
    // next to a focused field. A height-only change is the keyboard, not a real
    // reflow, so just re-place the panel instead.
    let lastW = window.innerWidth;
    const onResize = () => {
      if (window.innerWidth !== lastW) {
        lastW = window.innerWidth;
        setOpen(false);
      } else {
        place();
      }
    };

    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", onResize);
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown, true);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", onResize);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown, true);
    };
  }, [open, place]);

  const grid = useMemo(
    () => buildMonth(view.year, view.month, lang, today),
    [view.year, view.month, lang, today]
  );

  const months = useMemo(() => monthLabels(lang), [lang]);
  const years = useMemo(() => yearOptions(view.year, min, max), [view.year, min, max]);
  const presets = useMemo(() => datePresets(today), [today]);

  const lo = rangeStart && rangeEnd && rangeStart <= rangeEnd ? rangeStart : "";
  const hi = rangeStart && rangeEnd && rangeStart <= rangeEnd ? rangeEnd : "";

  const pick = (iso: ISODate) => {
    onChange(clampISO(iso, min, max));
    setOpen(false);
    triggerRef.current?.focus();
  };

  const step = (n: number) => setView((v) => addMonths(v.year, v.month, n));

  // Arrow keys walk the grid without needing focus on individual day buttons.
  const onGridKey = (e: React.KeyboardEvent) => {
    const base = isValidISO(value) ? (value as ISODate) : today;
    const delta: Record<string, number> = {
      ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7,
    };
    if (e.key in delta) {
      e.preventDefault();
      const d = new Date(+base.slice(0, 4), +base.slice(5, 7) - 1, +base.slice(8, 10) + delta[e.key]);
      const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
        d.getDate()
      ).padStart(2, "0")}`;
      if (isWithin(iso, min, max)) onChange(iso);
    } else if (e.key === "PageUp") {
      e.preventDefault();
      step(-1);
    } else if (e.key === "PageDown") {
      e.preventDefault();
      step(1);
    }
  };

  const display = isValidISO(value) ? formatDisplay(value, lang) : "";
  const weekday = isValidISO(value) ? formatWeekday(value, lang) : "";

  return (
    <>
      <button
        id={id}
        ref={triggerRef}
        type="button"
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((v) => !v)}
        className={`df-trigger ${compact ? "is-compact" : ""} ${open ? "is-open" : ""} ${className}`}
        // The weekday is dropped from the compact face to keep it narrow, so
        // carry it in the tooltip rather than losing it.
        title={compact && display ? `${weekday} ${display}` : undefined}
      >
        <span className="msr df-trigger-icon">calendar_today</span>
        {display ? (
          <span className="df-trigger-text">
            {!compact && <span className="df-trigger-dow">{weekday}</span>}
            {display}
          </span>
        ) : (
          <span className="df-trigger-text text-muted">
            {placeholder || tf("pick_a_date", "Pick a date")}
          </span>
        )}
        {!compact && <span className="msr df-trigger-caret">expand_more</span>}
      </button>

      {mounted && open && pos &&
        createPortal(
          <div
            ref={popRef}
            role="dialog"
            aria-modal="false"
            aria-label={ariaLabel || tf("pick_a_date", "Pick a date")}
            className={`df-pop${pos.narrow ? " is-narrow" : ""}`}
            style={{ top: pos.top, left: pos.left, width: pos.width }}
            onKeyDown={onGridKey}
          >
            <div className="df-body">
              {/* Preset rail — one click to the days people actually pick,
                  instead of paging the grid to them. Each is disabled rather
                  than clamped when min/max rules it out, so the rail never
                  silently selects a different day than its label promises. */}
              <div className="df-rail">
                {presets.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    className={`df-preset ${p.iso === value ? "is-on" : ""}`}
                    disabled={!isWithin(p.iso, min, max)}
                    title={formatDisplay(p.iso, lang)}
                    onClick={() => pick(p.iso)}
                  >
                    {tf(p.key, p.fallback)}
                  </button>
                ))}
              </div>

              <div className="df-cal">
                {/* Month and year are selects, not just arrows: reaching next
                    year's return date one <chevron> at a time is twelve clicks. */}
                <div className="df-head">
                  <button type="button" className="df-nav" onClick={() => step(-1)} aria-label="←">
                    <span className="msr text-[18px]">chevron_left</span>
                  </button>
                  <div className="df-period">
                    <select
                      className="df-sel"
                      value={view.month}
                      aria-label={tf("month", "Month")}
                      onChange={(e) => setView((v) => ({ ...v, month: +e.target.value }))}
                    >
                      {months.map((m, i) => (
                        <option key={m} value={i + 1}>
                          {m}
                        </option>
                      ))}
                    </select>
                    <select
                      className="df-sel df-sel-year"
                      value={view.year}
                      aria-label={tf("year", "Year")}
                      onChange={(e) => setView((v) => ({ ...v, year: +e.target.value }))}
                    >
                      {years.map((y) => (
                        <option key={y} value={y}>
                          {y}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button type="button" className="df-nav" onClick={() => step(1)} aria-label="→">
                    <span className="msr text-[18px]">chevron_right</span>
                  </button>
                </div>

                <div className="df-dow">
                  {grid.weekdays.map((w, i) => (
                    <span key={i}>{w.slice(0, 2)}</span>
                  ))}
                </div>

                <div className="df-grid">
                  {grid.weeks.map((week, wi) =>
                    week.map((c) => {
                      const allowed = isWithin(c.iso, min, max);
                      const selected = c.iso === value;
                      const inRange = !!lo && c.iso > lo && c.iso < hi;
                      const edge = !!lo && (c.iso === lo || c.iso === hi);
                      return (
                        <button
                          key={`${wi}-${c.iso}`}
                          type="button"
                          disabled={!allowed}
                          onClick={() => pick(c.iso)}
                          aria-current={c.isToday ? "date" : undefined}
                          aria-pressed={selected}
                          className={[
                            "df-day",
                            c.inMonth ? "" : "df-day-out",
                            c.isToday ? "df-day-today" : "",
                            inRange ? "df-day-range" : "",
                            edge && !selected ? "df-day-edge" : "",
                            selected ? "df-day-on" : "",
                          ].join(" ")}
                        >
                          {c.day}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            <div className="df-foot">
              <span className="df-foot-note">{display || tf("pick_a_date", "Pick a date")}</span>
              <button type="button" className="df-quick" onClick={() => setOpen(false)}>
                {tf("close", "Close")}
              </button>
            </div>
          </div>,
          document.body
        )}
    </>
  );
}
