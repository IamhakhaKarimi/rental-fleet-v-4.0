"use client";
import { useEffect, useMemo, useState } from "react";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { can } from "@/lib/perms";
import { formatEur } from "@/lib/money";
import { usePolling } from "@/lib/usePolling";
import { Timeline } from "@/components/Timeline";
import { NightModeToggle } from "@/components/NightModeToggle";
import { RefreshIcon } from "@/components/RefreshIcon";
import { Modal } from "@/components/Modal";
import { DateField } from "@/components/DateField";
import { useLicenseMax } from "@/lib/license";
import { BookingDialog } from "@/components/BookingDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { RecordCard, RecordCardList } from "@/components/RecordCard";
import { SwipeDeck, SwipePanel } from "@/components/SwipeCard";
import { VehicleCard, AvailabilityChip } from "@/components/VehicleCard";
import { VehicleThumb } from "@/components/VehicleThumb";
import { VisitorHome } from "@/components/VisitorHome";
import type { FleetCounts, Vehicle } from "@/lib/types";

// Whole-day span between two local "YYYY-MM-DD" strings — parsed as local dates
// (not UTC) so the count can't drift across timezones. Sizes the availability
// window for the "check free cars" range picker below.
const daysBetweenISO = (a: string, b: string) => {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime()) / 86400000);
};

export default function DashboardPage() {
  const { user } = useAuth();
  const t = useT();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));
  const [counts, setCounts] = useState<FleetCounts | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [bookingCar, setBookingCar] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [freeIds, setFreeIds] = useState<Set<string> | null>(null);
  // Availability-window picker modal: edits happen on draft copies and only commit
  // to startDate/endDate on "OK", so Cancel/Esc discards without re-querying.
  const [dateOpen, setDateOpen] = useState(false);
  const [draftStart, setDraftStart] = useState("");
  const [draftEnd, setDraftEnd] = useState("");
  // Availability can only be asked about days the licence covers — the endpoint
  // refuses the rest, so the picker doesn't offer them.
  const licenseMax = useLicenseMax();

  const load = async () => {
    await Promise.all([
      apiGet<FleetCounts>("/api/vehicles/counts").then(setCounts).catch(() => {}),
      apiGet<Vehicle[]>("/api/vehicles").then(setVehicles).catch(() => {}),
    ]);
  };

  const { isLoading, refetch } = usePolling(load, { interval: 15000 });

  const available = vehicles.filter((v) => v.status === "Available");

  // Fleet-at-a-glance figures for the bento board below the timeline.
  const total = counts?.total ?? vehicles.length;
  const avail = counts?.available ?? available.length;
  const rented = counts?.rented ?? 0;
  const garage = counts?.garage ?? 0;
  const util = total ? Math.round((rented / total) * 100) : 0;
  const featured = available[0];

  // Availability-by-range: ask the scheduler which vehicle ids are free across the
  // chosen window (start 10:00 → end 10:00; a lone start date checks a single day),
  // then map those ids back onto the live fleet so the cards keep year/colour/rate.
  // No start date → today's live availability. Read-only query — nothing is written.
  useEffect(() => {
    if (!startDate) {
      setFreeIds(null);
      return;
    }
    const days = endDate ? Math.max(1, daysBetweenISO(startDate, endDate)) : 1;
    let active = true;
    apiPost<{ cars: { vehicle_id: string }[] }>("/api/rentals/available-cars", {
      start_date: startDate,
      start_time: "10:00",
      days,
      return_time: "10:00",
    })
      .then((d) => active && setFreeIds(new Set(d.cars.map((c) => c.vehicle_id))))
      .catch(() => active && setFreeIds(new Set()));
    return () => {
      active = false;
    };
  }, [startDate, endDate]);

  // Derived from the live fleet so a vehicles refresh doesn't re-hit the API.
  const dateCars = useMemo(
    () => (freeIds ? vehicles.filter((v) => freeIds.has(v.vehicle_id)) : null),
    [freeIds, vehicles]
  );
  const shownCars = dateCars ?? available;
  // Whole-day span of the committed window (0 when there's no real range) — shown next
  // to the dates in the heading and inside the picker so the length is explicit.
  const rangeDays =
    startDate && endDate && endDate !== startDate
      ? Math.max(1, daysBetweenISO(startDate, endDate))
      : 0;
  const roleLabel = user ? t(user.role_label_key) : "";
  const canBook = can(user, "create_reservation");

  // Availability cards use the shared SwipeDeck (drag + seamless loop) once a date
  // window is picked; see the `startDate` branch below.
  const carPlaceholder = (
    <div className="h-[150px] w-full rounded-[14px] bg-bg border border-line flex items-center justify-center text-muted">
      <span className="msr text-[34px]">directions_car</span>
    </div>
  );
  const renderCarCard = (v: Vehicle) => (
    <VehicleCard
      name={v.make_model}
      photo={
        <VehicleThumb
          vehicleId={v.vehicle_id}
          className="h-[150px] w-full object-cover rounded-[14px]"
          fallback={carPlaceholder}
        />
      }
      reference={
        <>
          {v.year || "—"} · {v.license_plate || "—"}
          {v.color ? ` · ${v.color}` : ""}
          {v.mileage != null ? ` · ${v.mileage.toLocaleString()} km` : ""}
        </>
      }
      status={<AvailabilityChip status={v.status} />}
      price={
        <SwipePanel>
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5">
              <span className="msr text-[16px] text-muted">sell</span>
              <span className="text-xs text-muted">{tf("from", "from")}</span>
              <span className="font-display font-bold text-base text-accent">
                {formatEur(v.base_daily_rate)}
              </span>
            </span>
            <span className="text-[0.6rem] uppercase text-muted tracking-wide">
              / {tf("day", "day")}
            </span>
          </div>
        </SwipePanel>
      }
      footer={
        canBook ? (
          <button className="btn-rent" onClick={() => setBookingCar(v.vehicle_id)}>
            <span className="msr text-[18px]">add</span>
            {tf("rent", "Rent")}
          </button>
        ) : undefined
      }
    />
  );
  const isStaff = can(user, "view_management");
  const ql = q.trim().toLowerCase();
  const fleetShown = ql
    ? vehicles.filter((v) =>
        [v.vehicle_id, v.make_model, v.year, v.license_plate, v.color, v.status].some((f) =>
          String(f ?? "").toLowerCase().includes(ql)
        )
      )
    : vehicles;

  // Visitors get a customer-facing bento browse — no timeline, fleet table or KPIs.
  if (user && !isStaff) return <VisitorHome />;

  return (
    <div className="space-y-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="msr text-[22px]">person</span>
            {user?.full_name} — {roleLabel}
          </h1>
          <p className="text-sm text-muted mt-1">{t("dashboard_help")}</p>
        </div>
        <div className="flex items-center gap-2">
          <RefreshIcon onClick={refetch} isLoading={isLoading} />
          <NightModeToggle />
        </div>
      </div>

      <section className="space-y-2.5">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-muted">
          <span className="msr text-[18px]">calendar_month</span>
          {t("timeline_title")}
        </h2>
        <Timeline />
      </section>

      {/* Fleet at a glance — bento board (sits below the timeline; the timeline
          section above is left untouched). Folds the four fleet KPIs into a richer
          board with a live utilization bar and a featured available car. */}
      <section className="space-y-2.5">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-muted">
          <span className="msr text-[18px]">dashboard</span>
          {tf("fleet_at_a_glance", "Fleet at a glance")}
        </h2>
        {/* 4 columns on a phone, 8 on a tablet, the original 4 from `lg` up.
            Every tile below carries an explicit `lg:` span, because Tailwind
            breakpoints are min-width — without one, the `md:` span written for
            the tablet tier would leak upward and change the desktop board. */}
        <div className="grid grid-cols-4 md:grid-cols-8 lg:grid-cols-4 gap-4 [grid-auto-rows:minmax(140px,auto)]">
          {/* Hero — availability + utilization */}
          <div
            className="bento-in card col-span-4 md:col-span-4 lg:col-span-2 row-span-2 p-5 lg:p-6 flex flex-col justify-between"
            style={{ background: "var(--accent)", color: "var(--bg)", border: "none" }}
          >
            <div className="flex items-center gap-2 text-sm" style={{ opacity: 0.75 }}>
              <span className="msr text-[18px]">directions_car</span>
              {tf("available_cars", "Available now")}
            </div>
            <div>
              <div className="flex items-end gap-2.5">
                <span
                  className="text-5xl lg:text-6xl font-bold leading-none"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {avail}
                </span>
                <span className="text-sm pb-1.5" style={{ opacity: 0.8 }}>
                  / {total} {tf("fleet_size", "in fleet")}
                </span>
              </div>
              <div
                className="mt-4 h-2 rounded-full overflow-hidden"
                style={{ background: "rgba(255,255,255,0.25)" }}
              >
                <div
                  className="h-full rounded-full transition-[width] duration-500"
                  style={{ width: `${util}%`, background: "var(--bg)" }}
                />
              </div>
              <div className="text-xs mt-1.5" style={{ opacity: 0.8 }}>
                {util}% {tf("utilization", "utilized")}
              </div>
            </div>
          </div>

          {/* Rented */}
          <div
            className="bento-in card col-span-2 md:col-span-2 lg:col-span-1 p-5 flex flex-col justify-center"
            style={{ animationDelay: "45ms" }}
          >
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span className="msr text-[16px]">vpn_key</span>
              {t("kpi_rented")}
            </div>
            <div className="text-4xl font-bold text-ink mt-1" style={{ fontVariantNumeric: "tabular-nums" }}>
              {rented}
            </div>
          </div>

          {/* Available (stat) */}
          <div
            className="bento-in card col-span-2 md:col-span-2 lg:col-span-1 p-5 flex flex-col justify-center"
            style={{ animationDelay: "90ms" }}
          >
            <div className="flex items-center gap-1.5 text-xs text-muted">
              <span className="msr text-[16px]">check_circle</span>
              {t("kpi_available")}
            </div>
            <div className="text-4xl font-bold text-accent mt-1" style={{ fontVariantNumeric: "tabular-nums" }}>
              {avail}
            </div>
          </div>

          {/* Garage / maintenance — wide */}
          <div
            className="bento-in card col-span-4 md:col-span-4 lg:col-span-2 p-5 flex items-center gap-4"
            style={{ animationDelay: "135ms" }}
          >
            <div className="w-11 h-11 rounded-full bg-bg border border-line flex items-center justify-center shrink-0">
              <span className="msr text-[22px] text-muted">build</span>
            </div>
            <div>
              <div className="text-3xl font-bold text-ink" style={{ fontVariantNumeric: "tabular-nums" }}>
                {garage}
              </div>
              <div className="text-xs text-muted">{t("kpi_garage")}</div>
            </div>
          </div>

          {/* Featured available car — full-width feature strip */}
          {featured ? (
            <div
              className="bento-in card col-span-4 md:col-span-8 lg:col-span-4 p-4 flex flex-row items-center gap-4"
              style={{ animationDelay: "180ms" }}
            >
              <div className="w-[72px] h-[64px] lg:w-[96px] lg:h-[80px] rounded-[10px] bg-bg border border-line flex items-center justify-center text-muted shrink-0">
                <span className="msr text-[30px] lg:text-[36px]">directions_car</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-wide text-muted">
                  {tf("featured_car", "Featured")}
                </div>
                <div className="font-semibold text-ink truncate">
                  {featured.make_model}
                  {featured.year ? ` · ${featured.year}` : ""}
                </div>
                <div className="font-bold text-accent mt-0.5">
                  {formatEur(featured.base_daily_rate)}{" "}
                  <span className="text-xs text-muted font-normal">/ day</span>
                </div>
              </div>
              {canBook && (
                <button
                  className="btn btn-primary shrink-0"
                  onClick={() => setBookingCar(featured.vehicle_id)}
                >
                  <span className="msr text-[18px]">add</span>
                  {tf("rent", "Rent")}
                </button>
              )}
            </div>
          ) : (
            <div
              className="bento-in card col-span-4 md:col-span-8 lg:col-span-4 p-5 flex items-center justify-center text-sm text-muted"
              style={{ animationDelay: "180ms" }}
            >
              {t("no_cars")}
            </div>
          )}
        </div>
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-muted">
            <span className="msr text-[18px]">directions_car</span>
            {t("available_cars")} ({shownCars.length})
            {startDate && (
              <span className="text-xs font-normal text-accent">
                · {startDate}
                {endDate && endDate !== startDate ? ` → ${endDate}` : ""}
                {rangeDays > 0 ? ` · ${rangeDays} ${tf("days_short", "days")}` : ""}
              </span>
            )}
          </h2>
          {canBook && (
            <div className="flex items-center gap-2 flex-wrap">
              <button
                className="btn !py-1.5 text-xs flex items-center gap-2"
                onClick={() => {
                  setDraftStart(startDate);
                  setDraftEnd(endDate);
                  setDateOpen(true);
                }}
                title={tf("check_date_hint", "Check which cars are free from this date")}
              >
                <span className="msr text-[16px]">calendar_month</span>
                {startDate ? (
                  <span className="tabular-nums">
                    {startDate}
                    {endDate && endDate !== startDate ? ` → ${endDate}` : ""}
                    {rangeDays > 0 ? ` · ${rangeDays} ${tf("days_short", "days")}` : ""}
                  </span>
                ) : (
                  tf("select_dates", "Select dates")
                )}
              </button>
              {(startDate || endDate) && (
                <button
                  className="btn !p-2"
                  onClick={() => {
                    setStartDate("");
                    setEndDate("");
                  }}
                  title={tf("clear", "Clear")}
                  aria-label={tf("clear", "Clear")}
                >
                  <span className="msr text-[16px]">close</span>
                </button>
              )}
            </div>
          )}
        </div>
        {shownCars.length === 0 ? (
          <div className="text-sm text-muted">{t("no_cars")}</div>
        ) : startDate ? (
          /* Dates picked → shared swipe deck (drag + seamless loop). */
          <SwipeDeck
            items={shownCars}
            keyOf={(v) => v.vehicle_id}
            render={(v) => renderCarCard(v)}
            // One full-bleed card per view on a phone. The literal 260px opted
            // this deck out of SwipeDeck's own responsive sizing, so a card was
            // wider than the viewport's content box. `sm:` up is unchanged.
            itemWidth="w-[calc(100vw-1.5rem)] sm:w-[280px]"
            gap={12}
            empty={<div className="text-sm text-muted">{t("no_cars")}</div>}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {shownCars.map((v) => (
              <div key={v.vehicle_id}>{renderCarCard(v)}</div>
            ))}
          </div>
        )}
      </section>

      {/* Whole fleet */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-muted">
            <span className="msr text-[18px]">directions_car</span>
            {tf("whole_fleet", "Fleet")} ({fleetShown.length})
          </h2>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search")}
            className="!py-1.5 text-xs w-full lg:max-w-[220px]"
          />
        </div>
        {/* Below `lg` the same rows render as stacked cards — six columns of
            table never fit a phone, and a horizontal scroller hides half the
            fleet behind a gesture. Same `fleetShown` array feeds both. */}
        <RecordCardList>
          {fleetShown.map((v) => (
            <RecordCard
              key={v.vehicle_id}
              title={v.make_model}
              subtitle={v.vehicle_id}
              badge={<StatusBadge status={v.status} />}
              fields={[
                { label: t("col_plate"), value: v.license_plate || "—" },
                { label: t("col_rate"), value: formatEur(v.base_daily_rate) },
                { label: t("col_year"), value: v.year || "—" },
                { label: t("col_color"), value: v.color || "—" },
              ]}
            />
          ))}
        </RecordCardList>

        <div className="card overflow-x-auto hidden lg:block">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-line">
                <th className="p-2.5 font-medium">{t("col_model")}</th>
                <th className="p-2.5 font-medium">{t("col_plate")}</th>
                <th className="p-2.5 font-medium">{t("col_year")}</th>
                <th className="p-2.5 font-medium">{t("col_color")}</th>
                <th className="p-2.5 font-medium">{t("col_status")}</th>
                <th className="p-2.5 font-medium text-right">{t("col_rate")}</th>
              </tr>
            </thead>
            <tbody>
              {fleetShown.map((v) => (
                <tr key={v.vehicle_id} className="border-b border-line last:border-0">
                  <td className="p-2.5">
                    <span className="font-medium text-ink">{v.make_model}</span>
                    <span className="text-muted"> · {v.vehicle_id}</span>
                  </td>
                  <td className="p-2.5 text-muted">{v.license_plate || "—"}</td>
                  <td className="p-2.5 text-muted">{v.year || "—"}</td>
                  <td className="p-2.5 text-muted">{v.color || "—"}</td>
                  <td className="p-2.5">
                    <StatusBadge status={v.status} />
                  </td>
                  <td className="p-2.5 text-right font-medium">{formatEur(v.base_daily_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {dateOpen && (
        <Modal title={tf("select_dates", "Select dates")} onClose={() => setDateOpen(false)}>
          <div className="space-y-4">
            <p className="text-xs text-muted">
              {tf("check_date_hint", "Check which cars are free from this date")}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted flex items-center gap-1">
                  <span className="msr text-[15px]">event</span>
                  {tf("date_from", "From")}
                </span>
                <DateField
                  value={draftStart}
                  max={draftEnd || licenseMax}
                  rangeStart={draftStart}
                  rangeEnd={draftEnd}
                  onChange={(v) => {
                    setDraftStart(v);
                    // Drop an end date that now precedes the new start.
                    if (draftEnd && v && draftEnd < v) setDraftEnd("");
                  }}
                  ariaLabel={tf("date_from", "From")}
                />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted flex items-center gap-1">
                  <span className="msr text-[15px]">event</span>
                  {tf("date_to", "To")}
                </span>
                <DateField
                  value={draftEnd}
                  min={draftStart || undefined}
                  max={licenseMax}
                  disabled={!draftStart}
                  rangeStart={draftStart}
                  rangeEnd={draftEnd}
                  onChange={setDraftEnd}
                  ariaLabel={tf("date_to", "To")}
                />
              </label>
            </div>
            {draftStart && draftEnd && draftEnd !== draftStart && (
              <div className="text-sm text-accent flex items-center gap-1.5">
                <span className="msr text-[16px]">event_available</span>
                <b>
                  {Math.max(1, daysBetweenISO(draftStart, draftEnd))} {tf("days_short", "days")}
                </b>
                <span className="text-muted text-xs">
                  · {draftStart} → {draftEnd}
                </span>
              </div>
            )}
            <div className="flex items-center justify-end gap-2 pt-3 border-t border-line">
              <button
                className="btn"
                onClick={() => setDateOpen(false)}
                aria-label={tf("cancel", "Cancel")}
              >
                <span className="msr text-[18px]">close</span>
                {tf("cancel", "Cancel")}
              </button>
              <button
                className="btn btn-primary"
                onClick={() => {
                  setStartDate(draftStart);
                  setEndDate(draftStart ? draftEnd : "");
                  setDateOpen(false);
                }}
                aria-label={tf("ok", "OK")}
              >
                <span className="msr text-[18px]">check</span>
                {tf("ok", "OK")}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {bookingCar && canBook && (
        <Modal
          title={t("quick_register")}
          onClose={() => setBookingCar(null)}
          size="full"
          fullHeight
          bodyClassName="!mt-4 !mb-4 !p-4"
        >
          <BookingDialog
            preselectVehicleId={bookingCar}
            onClose={() => setBookingCar(null)}
            onCreated={() => {
              setBookingCar(null);
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
