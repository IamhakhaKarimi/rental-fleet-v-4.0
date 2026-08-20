/**
 * Shared calendar/date model — the single source of truth every date input in the
 * app builds on (components/DateField.tsx renders it).
 *
 * Everything speaks the app's storage convention: a **local** ISO day string
 * `YYYY-MM-DD`. Nothing here ever goes through `Date.parse()` / `toISOString()`
 * on a bare day string, because that reads it as UTC and silently shifts the day
 * by one either side of midnight for any non-UTC timezone — the exact drift the
 * old inline helpers in BookingDialog were written to avoid.
 */

export type ISODate = string; // "YYYY-MM-DD"

/** A single cell of a rendered month grid. */
export interface DayCell {
  iso: ISODate;
  day: number;          // 1..31
  inMonth: boolean;     // false for the leading/trailing spill-over days
  isToday: boolean;
  isWeekend: boolean;
}

/** A 6x7 month grid plus the labels needed to render its header. */
export interface CalendarMonth {
  year: number;
  month: number;        // 1..12
  label: string;        // localized "August 2026"
  weekdays: string[];   // localized, Monday-first
  weeks: DayCell[][];   // always 6 rows x 7 cells, so the popover never resizes
}

// ── Primitives ───────────────────────────────────────────────────────────────

export const todayISO = (): ISODate => toISO(new Date());

export function toISO(d: Date): ISODate {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/** Parse "YYYY-MM-DD" as a LOCAL midnight Date. Returns null when unparseable. */
export function fromISO(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return isNaN(d.getTime()) ? null : d;
}

export function isValidISO(iso: string | null | undefined): boolean {
  return fromISO(iso) !== null;
}

export function addDaysISO(iso: ISODate, n: number): ISODate {
  const d = fromISO(iso);
  if (!d) return iso;
  d.setDate(d.getDate() + n);
  return toISO(d);
}

export function addMonths(year: number, month: number, n: number): { year: number; month: number } {
  const total = year * 12 + (month - 1) + n;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
}

/**
 * Shift a day by whole months, clamping the day-of-month to the target month's
 * length: 31 Jan + 1 month is 28 Feb, not 3 Mar. `Date.setMonth` alone rolls
 * over, which would make the "next month" preset land in the month after next.
 */
export function addMonthsISO(iso: ISODate, n: number): ISODate {
  const d = fromISO(iso);
  if (!d) return iso;
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const lastOfMonth = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, lastOfMonth));
  return toISO(d);
}

/** Whole days from `a` to `b` (negative when b precedes a). */
export function daysBetweenISO(a: ISODate, b: ISODate): number {
  const da = fromISO(a);
  const db = fromISO(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

/**
 * Whole days to *bill* for a check-in/check-out span, given each side's
 * "HH:MM" time-of-day. Mirrors `services/scheduling_service.py#billed_days`:
 * any time past a full 24h multiple owes the next day (10:00 pickup returned
 * 15:00 the next day is 29h — 2 billed days, not the 1 a calendar-date diff
 * would give), rounded up, minimum 1. Falls back to 1 on unparseable input.
 */
export function billedDays(
  startIso: ISODate,
  startTime: string,
  endIso: ISODate,
  endTime: string
): number {
  const start = fromISO(startIso);
  const end = fromISO(endIso);
  if (!start || !end) return 1;
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  start.setHours(sh || 0, sm || 0, 0, 0);
  end.setHours(eh || 0, em || 0, 0, 0);
  const elapsedMs = end.getTime() - start.getTime();
  return Math.max(1, Math.ceil(elapsedMs / 86400000));
}

/** Lexicographic compare works on ISO day strings — no Date allocation needed. */
export const isBefore = (a: ISODate, b: ISODate) => a < b;
export const isAfter = (a: ISODate, b: ISODate) => a > b;

export function clampISO(iso: ISODate, min?: ISODate, max?: ISODate): ISODate {
  if (min && iso < min) return min;
  if (max && iso > max) return max;
  return iso;
}

export function isWithin(iso: ISODate, min?: ISODate, max?: ISODate): boolean {
  if (min && iso < min) return false;
  if (max && iso > max) return false;
  return true;
}

// ── Localized labels ─────────────────────────────────────────────────────────

/**
 * `Intl` rejects an unknown/empty tag by throwing, and the app's own codes are
 * plain 2-letter tags it happens to accept ("tr" / "en" / "sq"), so we only need
 * a guard against blank/garbage — never a mapping table.
 */
function safeLocale(locale?: string): string | undefined {
  const l = (locale || "").trim();
  if (!l) return undefined;
  try {
    new Intl.DateTimeFormat(l);
    return l;
  } catch {
    return undefined;
  }
}

/** Monday-first weekday initials, e.g. ["Mon","Tue",…] shortened by the caller. */
export function weekdayLabels(locale?: string, style: "short" | "narrow" = "short"): string[] {
  const fmt = new Intl.DateTimeFormat(safeLocale(locale), { weekday: style });
  // 2024-01-01 was a Monday — a fixed anchor so the order never depends on today.
  return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)));
}

/** Localized month names for the picker's month <select>, index 0 = January. */
export function monthLabels(locale?: string): string[] {
  const fmt = new Intl.DateTimeFormat(safeLocale(locale), { month: "long" });
  return Array.from({ length: 12 }, (_, i) => fmt.format(new Date(2024, i, 1)));
}

/**
 * The years offered by the picker's year <select>. Paging a month at a time to
 * reach next year's return date is the kind of thing that makes a picker feel
 * broken, so the list spans `span` years either side of today — widened to
 * always include whatever month is on screen, and narrowed by min/max so it
 * never offers a year in which every day is disabled.
 */
export function yearOptions(viewYear: number, min?: ISODate, max?: ISODate, span = 6): number[] {
  const nowY = new Date().getFullYear();
  let lo = nowY - span;
  let hi = nowY + span;
  if (min) lo = Math.max(lo, +min.slice(0, 4));
  if (max) hi = Math.min(hi, +max.slice(0, 4));
  lo = Math.min(lo, viewYear);
  hi = Math.max(hi, viewYear);
  const out: number[] = [];
  for (let y = lo; y <= hi; y++) out.push(y);
  return out;
}

/** A one-click jump offered in the picker's side rail. */
export interface DatePreset {
  key: string;      // i18n key
  fallback: string; // English label when the bundle has no such key
  iso: ISODate;
}

/**
 * The picker selects a single day, so each preset is a *day* relative to today
 * ("next week" = today + 7), not a range — the rail is a shortcut past a dozen
 * grid clicks, not a second way to express a rental span.
 */
export function datePresets(from: ISODate = todayISO()): DatePreset[] {
  return [
    { key: "preset_today", fallback: "Today", iso: from },
    { key: "preset_last_week", fallback: "Last week", iso: addDaysISO(from, -7) },
    { key: "preset_next_week", fallback: "Next week", iso: addDaysISO(from, 7) },
    { key: "preset_next_month", fallback: "Next month", iso: addMonthsISO(from, 1) },
    { key: "preset_last_month", fallback: "Last month", iso: addMonthsISO(from, -1) },
  ];
}

export function monthYearLabel(year: number, month: number, locale?: string): string {
  return new Intl.DateTimeFormat(safeLocale(locale), { month: "long", year: "numeric" })
    .format(new Date(year, month - 1, 1));
}

/** Human date for a trigger/summary line, e.g. "5 Aug 2026". */
export function formatDisplay(iso: string | null | undefined, locale?: string): string {
  const d = fromISO(iso);
  if (!d) return "";
  return new Intl.DateTimeFormat(safeLocale(locale), {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** Compact weekday prefix for the picker's summary line, e.g. "Wed". */
export function formatWeekday(iso: string | null | undefined, locale?: string): string {
  const d = fromISO(iso);
  if (!d) return "";
  return new Intl.DateTimeFormat(safeLocale(locale), { weekday: "short" }).format(d);
}

// ── The grid model ───────────────────────────────────────────────────────────

/**
 * Build the 6x7 grid for one month, Monday-first. Always six rows: a 4- or
 * 5-row month would otherwise make the popover jump height as you page through
 * the year.
 */
export function buildMonth(
  year: number,
  month: number,
  locale?: string,
  todayIso: ISODate = todayISO()
): CalendarMonth {
  const first = new Date(year, month - 1, 1);
  // getDay() is Sunday-first (0..6); shift so Monday === 0.
  const lead = (first.getDay() + 6) % 7;

  const cursor = new Date(year, month - 1, 1 - lead);
  const weeks: DayCell[][] = [];

  for (let w = 0; w < 6; w++) {
    const row: DayCell[] = [];
    for (let d = 0; d < 7; d++) {
      const iso = toISO(cursor);
      row.push({
        iso,
        day: cursor.getDate(),
        inMonth: cursor.getMonth() === month - 1 && cursor.getFullYear() === year,
        isToday: iso === todayIso,
        isWeekend: d >= 5,
      });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(row);
  }

  return {
    year,
    month,
    label: monthYearLabel(year, month, locale),
    weekdays: weekdayLabels(locale),
    weeks,
  };
}

/** The month a picker should open on for a given (possibly empty) value. */
export function monthOf(iso: string | null | undefined): { year: number; month: number } {
  const d = fromISO(iso) || new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
