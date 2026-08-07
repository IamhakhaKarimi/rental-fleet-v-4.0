"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { formatEur } from "@/lib/money";
import { useIsDesktop } from "@/lib/useMediaQuery";
import { Modal } from "./Modal";

interface TLRental {
  deal_id: string;
  vehicle_id: string;
  make_model: string;
  client_name: string;
  phone?: string;
  license_plate?: string;
  start_dt: string;
  end_dt: string;
  status: string;
  rental_days?: number;
  daily_rate?: number;
  total_amount?: number;
  deposit?: number;
}
interface TLVehicle {
  vehicle_id: string;
  make_model: string;
  license_plate: string;
  status: string;
}

type Zoom = "day" | "week" | "month" | "year";
const DAY = 86400000;
const HOUR = 3600000;
/** Sticky vehicle-label gutter. 150px is right on a desktop, but it is wider
 *  than the whole content column used to be on a 375px phone — the chart itself
 *  would be almost entirely off-screen before you scrolled. 104px still fits
 *  "HYUNDAI ACCENT" truncated over its plate. Fed to inline `style`, so it has
 *  to be a JS value; CSS cannot reach it. */
const LABEL_W_DESKTOP = 150;
const LABEL_W_NARROW = 104;
const ROW_H = 34;
const PX_PER_DAY: Record<Zoom, number> = { day: 240, week: 110, month: 42, year: 10 };
const parse = (d: string) => new Date(d.replace(" ", "T")).getTime();
const dayStart = (ms: number) => {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
const digits = (s?: string) => (s || "").replace(/\D/g, "");

/**
 * Aesthetic occupancy calendar. Continuous, free-scrolling strip with clear
 * month / day / hour legends and faded day-separator gridlines. Day·Week·Month·Year
 * change the zoom; pan with ‹ ›, Today recenters, a NOW pill marks the current time.
 * Bars are clickable -> a rental-details modal with a WhatsApp shortcut.
 */
export function Timeline() {
  const { t, lang } = useI18n();
  const isDesktop = useIsDesktop();
  const LABEL_W = isDesktop ? LABEL_W_DESKTOP : LABEL_W_NARROW;
  const [zoom, setZoom] = useState<Zoom>("month");
  const [showDone, setShowDone] = useState(false);
  const [search, setSearch] = useState("");
  const [vehicles, setVehicles] = useState<TLVehicle[]>([]);
  const [rentals, setRentals] = useState<TLRental[]>([]);
  const [selected, setSelected] = useState<TLRental | null>(null);
  const [rangeLbl, setRangeLbl] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));
  const fmt = (ms: number, o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(lang || "en", o).format(new Date(ms));

  useEffect(() => {
    apiGet<TLVehicle[]>("/api/vehicles").then(setVehicles).catch(() => {});
  }, []);
  useEffect(() => {
    apiGet<TLRental[]>(showDone ? "/api/rentals/all" : "/api/rentals/active")
      .then(setRentals)
      .catch(() => {});
  }, [showDone]);

  const pxPerDay = PX_PER_DAY[zoom];
  const now = Date.now();

  const { winStart, winEnd } = useMemo(() => {
    const starts = rentals.map((r) => parse(r.start_dt));
    const ends = rentals.map((r) => parse(r.end_dt));
    let min = Math.min(now, ...(starts.length ? starts : [now]));
    let max = Math.max(now, ...(ends.length ? ends : [now]));
    min = dayStart(min) - 14 * DAY;
    max = dayStart(max) + 30 * DAY;
    if (max - min < 70 * DAY) max = min + 70 * DAY;
    return { winStart: min, winEnd: max };
  }, [rentals, now]);

  const span = winEnd - winStart;
  const contentW = Math.round((span / DAY) * pxPerDay);
  const toPx = (ms: number) => ((ms - winStart) / span) * contentW;
  const nowX = toPx(now);

  const { monthTicks, dayTicks, hourTicks } = useMemo(() => {
    const months: { px: number; label: string }[] = [];
    const days: { px: number; label: string; weekday: string }[] = [];
    const hours: { px: number; label: string }[] = [];
    const px = (ms: number) => ((ms - winStart) / span) * contentW;
    const m = new Date(winStart);
    m.setDate(1);
    m.setHours(0, 0, 0, 0);
    while (m.getTime() < winEnd) {
      months.push({ px: px(m.getTime()), label: fmt(m.getTime(), { month: "long", year: "numeric" }) });
      m.setMonth(m.getMonth() + 1);
    }
    if (zoom !== "year") {
      for (let dd = dayStart(winStart); dd < winEnd; dd += DAY) {
        days.push({
          px: px(dd),
          label: String(new Date(dd).getDate()),
          weekday: fmt(dd, { weekday: "narrow" }),
        });
      }
    }
    if (zoom === "day") {
      for (let hh = dayStart(winStart); hh < winEnd; hh += 6 * HOUR) {
        const h = new Date(hh).getHours();
        if (h !== 0) hours.push({ px: px(hh), label: `${String(h).padStart(2, "0")}:00` });
      }
    }
    return { monthTicks: months, dayTicks: days, hourTicks: hours };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [winStart, winEnd, contentW, span, zoom, lang]);

  // Keep each bar's client name pinned to the chart's visible left edge as the
  // strip scrolls: translate the name rightwards by how far the bar has slid past
  // that edge (scrollLeft − bar.left), clamped so it never leaves the bar — the
  // name rides along the bar and only vanishes once the bar itself is fully gone.
  const pinLabels = () => {
    const el = scrollRef.current;
    if (!el) return;
    const sl = el.scrollLeft;
    el.querySelectorAll<HTMLElement>(".cal-bar-name").forEach((n) => {
      const l = parseFloat(n.dataset.l || "0");
      const w = parseFloat(n.dataset.w || "0");
      const nw = n.offsetWidth; // transforms don't dirty layout → reflow-free read
      const upper = Math.max(0, w - Math.max(nw, 24) - 10);
      const tx = Math.min(Math.max(sl - l, 0), upper);
      n.style.transform = tx > 0 ? `translateX(${tx}px)` : "";
    });
  };

  const updateRange = () => {
    const el = scrollRef.current;
    if (!el) return;
    const x0 = el.scrollLeft;
    const x1 = el.scrollLeft + el.clientWidth - LABEL_W;
    const s = winStart + (Math.max(0, x0) / contentW) * span;
    const e = winStart + (Math.min(contentW, x1) / contentW) * span;
    setRangeLbl(`${fmt(s, { day: "numeric", month: "short" })} – ${fmt(e, { day: "numeric", month: "short" })}`);
    pinLabels();
  };

  // Center on today whenever the strip resizes (data load / zoom change), then
  // pin the bar labels to their initial positions.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      el.scrollLeft = Math.max(0, nowX - el.clientWidth / 2);
      updateRange();
      requestAnimationFrame(pinLabels);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contentW]);

  const scrollToToday = () => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ left: Math.max(0, nowX - el.clientWidth / 2), behavior: "smooth" });
  };
  const pan = (dir: number) => {
    const el = scrollRef.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth * 0.6, behavior: "smooth" });
  };

  const monthName = (ms: number) => fmt(ms, { month: "long" });
  const q = search.trim().toLowerCase();
  const barStr = (r: TLRental) =>
    `${r.client_name} ${r.make_model} ${r.vehicle_id} ${r.license_plate || ""} ${monthName(parse(r.start_dt))} ${monthName(parse(r.end_dt))}`.toLowerCase();
  const barHi = (r: TLRental) => !!q && barStr(r).includes(q);
  const vehHi = (v: TLVehicle) => !!q && `${v.make_model} ${v.vehicle_id} ${v.license_plate || ""}`.toLowerCase().includes(q);

  const byVeh = useMemo(() => {
    const map = new Map<string, TLRental[]>();
    rentals.forEach((r) => {
      const a = map.get(r.vehicle_id) || [];
      a.push(r);
      map.set(r.vehicle_id, a);
    });
    return map;
  }, [rentals]);

  const rows = vehicles.filter((v) => v.status !== "DELETED");
  const bodyH = rows.length * ROW_H;

  // Rental tone -> bar colour. A late return (end < now) is an ALERT (red); one
  // due within 24h is a WARNING (amber); a normal active rental is neutral; a
  // closed/returned one is "done" (grey). The whole bar is tinted (see the
  // .cal-bar--* classes) so the state reads at a glance.
  function barTone(r: TLRental): "ok" | "warn" | "danger" | "done" {
    if (r.status !== "Active") return "done";
    const e = parse(r.end_dt);
    if (e < now) return "danger";
    if (e - now < DAY) return "warn";
    return "ok";
  }
  // For the bar fill we want the bright --cal-warn; for the modal status chip
  // (coloured text on a light tint) we want the darker --cal-warn-ink for contrast.
  const TONE_COLOR: Record<string, string> = {
    ok: "var(--info)",
    warn: "var(--cal-warn-ink)",
    danger: "var(--danger)",
    done: "var(--archived)",
  };

  const zooms: Zoom[] = ["day", "week", "month", "year"];
  const zoomLabel: Record<Zoom, string> = {
    day: tf("timeline_day", "Day"),
    week: tf("timeline_week", "Week"),
    month: tf("timeline_month", "Month"),
    year: tf("timeline_year", "Year"),
  };
  const axisH = zoom === "day" ? 46 : zoom === "year" ? 22 : 34;

  return (
    <div className="neo-panel">
      {/* Toolbar */}
      {/* 4 columns on a phone, 8 on a tablet, the original 12 from `lg` up.
          The `md:` spans below carry explicit `lg:` counterparts so desktop
          still resolves to the 6/4/2 split it has always used. */}
      <div className="grid grid-cols-4 md:grid-cols-8 lg:grid-cols-12 gap-2 items-center mb-2.5">
        <div className="col-span-4 md:col-span-8 lg:col-span-6 flex items-center gap-2 flex-wrap">
          <div className="inline-flex rounded-pill border border-line overflow-hidden">
            {zooms.map((z) => (
              <button
                key={z}
                onClick={() => setZoom(z)}
                className={`seg-btn ${zoom === z ? "active" : "hover:bg-[rgba(17,24,39,0.05)]"}`}
                title={`${zoomLabel[z]} view`}
              >
                {zoomLabel[z]}
              </button>
            ))}
          </div>
          <div className="flex items-center">
            <button className="btn !p-1.5 !rounded-r-none" onClick={() => pan(-1)} aria-label="Pan left" title={tf("pan_left", "Scroll back")}>
              <span className="msr text-[18px]">chevron_left</span>
            </button>
            <button className="btn !p-1.5 !rounded-l-none !border-l-0" onClick={() => pan(1)} aria-label="Pan right" title={tf("pan_right", "Scroll forward")}>
              <span className="msr text-[18px]">chevron_right</span>
            </button>
          </div>
          <span className="text-sm font-semibold ml-0.5">{rangeLbl}</span>
          <button className="btn !py-1.5 !px-3 text-xs" onClick={scrollToToday} title={tf("jump_today", "Jump to today")}>
            {tf("timeline_today", "Today")}
          </button>
        </div>
        <div className="col-span-4 md:col-span-4 lg:col-span-4 flex items-center">
          <label className="flex items-center gap-2 text-xs text-muted select-none cursor-pointer" title={tf("show_done_hint", "Include finished (closed) rentals")}>
            <input type="checkbox" className="w-auto" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} />
            {tf("show_done", "Show done")}
          </label>
        </div>
        <div className="col-span-4 md:col-span-4 lg:col-span-2">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={tf("timeline_search", "Highlight…")}
            className="!py-1.5 text-xs"
            title={tf("search_hint", "Highlight by client, car, plate or month")}
          />
        </div>
      </div>

      {/* Scrollable strip */}
      <div ref={scrollRef} className="overflow-x-auto" onScroll={updateRange}>
        <div style={{ width: LABEL_W + contentW }}>
          {/* Axis: month / day / hour legends */}
          <div className="flex">
            <div style={{ width: LABEL_W }} className="shrink-0 sticky left-0 z-20 bg-bg" />
            <div className="relative" style={{ width: contentW, height: axisH }}>
              {monthTicks.map((tk, i) => (
                <span key={"M" + i} className="absolute top-0 pl-1.5 text-[0.72rem] font-semibold text-ink whitespace-nowrap" style={{ left: tk.px }}>
                  {tk.label}
                </span>
              ))}
              {dayTicks.map((tk, i) => (
                <span key={"D" + i} className="absolute text-[0.6rem] text-muted whitespace-nowrap leading-none text-center" style={{ left: tk.px, top: 18, width: pxPerDay, transform: "translateX(-1px)" }}>
                  {zoom === "year" ? "" : tk.label}
                  {pxPerDay >= 60 && <span className="block text-[0.5rem] opacity-70">{tk.weekday}</span>}
                </span>
              ))}
              {hourTicks.map((tk, i) => (
                <span key={"H" + i} className="absolute text-[0.5rem] text-muted/70 whitespace-nowrap" style={{ left: tk.px, top: 33, transform: "translateX(-50%)" }}>
                  {tk.label}
                </span>
              ))}
              {nowX >= 0 && nowX <= contentW && <span className="cal-now-pill" style={{ left: nowX }}>NOW</span>}
            </div>
          </div>

          {rows.length === 0 && <div className="text-center text-muted py-6 text-sm">{t("timeline_empty")}</div>}

          {/* Body: gridline overlay (one layer) + vehicle rows */}
          {rows.length > 0 && (
            <div className="relative" style={{ height: bodyH }}>
              {/* gridlines + now-line span all rows */}
              <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: LABEL_W, width: contentW }}>
                {pxPerDay >= 28 &&
                  dayTicks.map((tk, i) => (tk.px > 0 ? <div key={"dg" + i} className="cal-gridline-faint" style={{ left: tk.px }} /> : null))}
                {monthTicks.map((tk, i) => (tk.px > 0 ? <div key={"mg" + i} className="cal-gridline" style={{ left: tk.px }} /> : null))}
                {nowX >= 0 && nowX <= contentW && <div className="cal-now" style={{ left: nowX }} />}
              </div>

              {rows.map((v) => {
                const rs = byVeh.get(v.vehicle_id) || [];
                const rowHi = vehHi(v) || rs.some(barHi);
                return (
                  <div key={v.vehicle_id} className="flex items-stretch" style={{ height: ROW_H }}>
                    <div
                      style={{ width: LABEL_W, borderBottom: "1.5px solid var(--cal-rowsep)" }}
                      className={`shrink-0 sticky left-0 z-10 bg-bg text-[0.72rem] leading-tight pr-2 flex flex-col justify-center ${q && !rowHi ? "opacity-40" : ""}`}
                    >
                      <div className="font-medium text-ink truncate">{v.make_model}</div>
                      <div className="text-muted truncate">{v.license_plate || "—"}</div>
                    </div>
                    <div className="cal-row relative" style={{ width: contentW, height: ROW_H }}>
                      {rs.map((r) => {
                        const left = toPx(parse(r.start_dt));
                        const right = toPx(parse(r.end_dt));
                        const isHi = barHi(r);
                        const dim = q && !isHi;
                        const tone = barTone(r);
                        // A currently-underway normal rental (start reached, not an
                        // amber/red alert) gets the faded sky-blue "started" wash.
                        const started = parse(r.start_dt) <= now;
                        return (
                          <div
                            key={r.deal_id}
                            className={`cal-bar cal-bar--${tone}${
                              tone === "ok" && started ? " cal-bar--started" : ""
                            }`}
                            style={{
                              left,
                              width: Math.max(10, right - left),
                              opacity: dim ? 0.3 : 1,
                              outline: isHi ? "2px solid var(--accent)" : undefined,
                              outlineOffset: isHi ? "1px" : undefined,
                            }}
                            onClick={() => setSelected(r)}
                            title={`${r.client_name} · ${r.make_model}`}
                          >
                            <span
                              className="truncate cal-bar-name"
                              data-l={left}
                              data-w={Math.max(10, right - left)}
                            >
                              {r.client_name}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Rental details modal (bar click) */}
      {selected && (
        <Modal title={selected.client_name} onClose={() => setSelected(null)}>
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2 text-ink">
              <span className="msr text-[18px] text-muted">directions_car</span>
              {selected.make_model}
              {selected.license_plate ? ` · ${selected.license_plate}` : ""}
              <span className="text-muted">· {selected.vehicle_id}</span>
            </div>
            <div className="flex items-center gap-2 text-ink">
              <span className="msr text-[18px] text-muted">event</span>
              {fmt(parse(selected.start_dt), { day: "numeric", month: "long", year: "numeric" })}
              {" → "}
              {fmt(parse(selected.end_dt), { day: "numeric", month: "long", year: "numeric" })}
            </div>
            <div className="flex items-center gap-2">
              <span
                className="badge"
                style={{ color: TONE_COLOR[barTone(selected)], background: "color-mix(in oklab, currentColor 12%, transparent)" }}
              >
                {selected.status === "Active" ? tf("status_active", "Active") : tf("status_closed", "Closed")}
              </span>
            </div>
            {/* Negotiated rate + what it adds up to — the figures staff are asked
                for most often when a client rings about a booking. */}
            {selected.daily_rate != null && (
              <div className="grid grid-cols-3 gap-2 pt-1">
                <div>
                  <div className="text-[11px] text-muted">{tf("negotiated_rate", "Negotiated Rate")}</div>
                  <div className="font-semibold text-ink">
                    {formatEur(selected.daily_rate)}
                    <span className="text-muted font-normal">/{tf("day", "day")}</span>
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">{tf("days", "Days")}</div>
                  <div className="font-semibold text-ink">{selected.rental_days ?? "—"}</div>
                </div>
                <div>
                  <div className="text-[11px] text-muted">{tf("live_total", "Total")}</div>
                  <div className="font-semibold text-ink">{formatEur(selected.total_amount)}</div>
                </div>
              </div>
            )}
            {selected.phone && (
              <div className="flex items-center gap-2 pt-1">
                <span className="msr text-[18px] text-muted">call</span>
                <span className="text-muted">{selected.phone}</span>
              </div>
            )}
            <div className="flex items-center gap-2 pt-2">
              {digits(selected.phone) && (
                <a
                  href={`https://wa.me/${digits(selected.phone)}`}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-primary flex-1"
                  title={tf("wa_hint", "Message the client on WhatsApp")}
                >
                  <span className="msr text-[18px]">chat</span>
                  {tf("whatsapp", "WhatsApp")}
                </a>
              )}
              {digits(selected.phone) && (
                <a href={`tel:${selected.phone}`} className="btn" title={tf("call_hint", "Call the client")}>
                  <span className="msr text-[18px]">call</span>
                </a>
              )}
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
