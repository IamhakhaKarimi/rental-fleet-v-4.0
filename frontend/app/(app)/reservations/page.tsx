"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { usePolling } from "@/lib/usePolling";
import { can } from "@/lib/perms";
import { formatEur } from "@/lib/money";
import { Modal } from "@/components/Modal";
import { Timeline } from "@/components/Timeline";
import { BookingDialog } from "@/components/BookingDialog";
import {
  ReservationCard,
  EditReservationForm,
  ManageReturnForm,
  type ActiveRental,
} from "@/components/ReservationCard";
import { StatusBadge } from "@/components/StatusBadge";
import { RefreshIcon } from "@/components/RefreshIcon";
import { ViewToggle } from "@/components/ViewToggle";
import { useResponsiveView } from "@/lib/useResponsiveView";
import { SwipeDeck } from "@/components/SwipeCard";

type TLRange = "week" | "month" | "two_month" | "all_months";

export default function ReservationsPage() {
  const { t, lang } = useI18n();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));
  const { user } = useAuth();
  const toast = useToast();
  const [rentals, setRentals] = useState<ActiveRental[]>([]);
  const [booking, setBooking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [range, setRange] = useState<TLRange>("week");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  // Table view is desktop-only — below `lg` this always resolves to "cards".
  const [view, changeView] = useResponsiveView("reservations_view");
  // Table-view row actions open the same focused modals the cards use.
  const [manage, setManage] = useState<ActiveRental | null>(null);
  const [edit, setEdit] = useState<ActiveRental | null>(null);

  const load = useCallback(async () => {
    await apiGet<ActiveRental[]>("/api/rentals/active").then(setRentals).catch(() => {});
  }, []);

  const { isLoading, refetch } = usePolling(load, { interval: 15000 });

  const fmtDay = (s: string) => {
    const d = new Date((s || "").replace(" ", "T"));
    if (isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat(lang || "en", { day: "numeric", month: "short", year: "numeric" }).format(d);
  };

  // Client-side filter over the loaded active rentals — searches client name,
  // phone, ID/passport, vehicle, plate and invoice no. No backend/DB change.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rentals;
    return rentals.filter((r) =>
      [r.client_name, r.phone, r.id_passport, r.make_model, r.license_plate, r.deal_id]
        .some((f) => (f || "").toLowerCase().includes(q))
    );
  }, [rentals, query]);

  const canBook = can(user, "create_reservation");

  async function downloadTimeline() {
    setBusy(true);
    try {
      const res = await api(
        `/api/timeline/pdf?range=${range}&lang=${encodeURIComponent(lang || "tr")}`,
        { raw: true }
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `timeline_${range}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      setExporting(false);
    } catch (e: any) {
      toast.error(tf(e?.key || "error", "Could not download the timeline PDF."));
    } finally {
      setBusy(false);
    }
  }

  const rangeOpts: { key: TLRange; label: string; fb: string }[] = [
    { key: "week", label: "tl_range_week", fb: "This week" },
    { key: "month", label: "tl_range_month", fb: "This month" },
    { key: "two_month", label: "tl_range_two", fb: "Two-month range" },
    { key: "all_months", label: "tl_range_all", fb: "All months (separate pages)" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="msr text-[22px]">calendar_month</span>
          <h1 className="text-xl font-bold">{t("nav_reservations")}</h1>
        </div>
        <div className="flex items-center gap-2">
          <RefreshIcon onClick={refetch} isLoading={isLoading} />
          <ViewToggle
            value={view}
            onChange={changeView}
            cardsTitle={tf("view_cards", "Card view")}
            tableTitle={tf("view_table", "Table view")}
          />
          <button
            className="btn"
            onClick={() => setExporting(true)}
            title={tf("download_timeline", "Download Timeline (PDF)")}
          >
            <span className="msr text-[18px]">picture_as_pdf</span>
            {tf("download_timeline", "Download Timeline (PDF)")}
          </button>
          {canBook && (
            <button className="btn btn-primary" onClick={() => setBooking(true)}>
              <span className="msr text-[18px]">add</span>
              {t("quick_register")}
            </button>
          )}
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold text-muted">
            {t("active_rentals") === "active_rentals" ? "Active rentals" : t("active_rentals")} ({filtered.length}
            {query.trim() ? `/${rentals.length}` : ""})
          </h2>
          <div className="relative w-full sm:w-72">
            <span className="msr text-[18px] text-muted absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none">
              search
            </span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tf("search_clients", "Search name, phone, plate…")}
              className="!pl-9"
            />
          </div>
        </div>
        {view === "cards" ? (
          <SwipeDeck
            items={filtered}
            keyOf={(r) => r.deal_id}
            empty={
              <div className="text-sm text-muted">
                {rentals.length === 0 ? t("timeline_empty") : tf("no_results", "No matching clients.")}
              </div>
            }
            render={(r) => <ReservationCard rental={r} onChange={load} />}
          />
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-muted border-b border-line">
                  <th className="p-2.5 font-medium">{tf("client_name", "Client")}</th>
                  <th className="p-2.5 font-medium">{tf("client_phone", "Phone")}</th>
                  <th className="p-2.5 font-medium">{tf("invoice_vehicle", "Vehicle")}</th>
                  <th className="p-2.5 font-medium">{tf("period", "Period")}</th>
                  <th className="p-2.5 font-medium text-right">{tf("days", "Days")}</th>
                  <th className="p-2.5 font-medium text-right">{tf("live_total", "Total")}</th>
                  <th className="p-2.5 font-medium">{tf("col_status", "Status")}</th>
                  <th className="p-2.5 font-medium text-right">{tf("col_actions", "Actions")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r.deal_id} className="border-b border-line last:border-0">
                    <td className="p-2.5">
                      <span className="font-medium text-ink">{r.client_name}</span>
                      <div className="text-xs text-muted">{r.id_passport || "—"}</div>
                    </td>
                    <td className="p-2.5 text-muted">{r.phone || "—"}</td>
                    <td className="p-2.5">
                      <span className="text-ink">{r.make_model}</span>
                      <div className="text-xs text-muted">{r.license_plate || "—"}</div>
                    </td>
                    <td className="p-2.5 text-muted whitespace-nowrap">
                      {fmtDay(r.start_dt)} → {fmtDay(r.end_dt)}
                    </td>
                    <td className="p-2.5 text-right text-muted">{r.rental_days}</td>
                    <td className="p-2.5 text-right font-medium">{formatEur(r.total_amount)}</td>
                    <td className="p-2.5">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="p-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          className="btn !py-1.5 !px-3 text-xs"
                          onClick={() => setEdit(r)}
                          title={tf("edit_reservation", "Edit Reservation")}
                        >
                          <span className="msr text-[16px]">edit</span>
                          {tf("edit", "Edit")}
                        </button>
                        <button
                          className="btn !py-1.5 !px-3 text-xs"
                          onClick={() => setManage(r)}
                          title={tf("manage_return", "Manage / Return")}
                        >
                          <span className="msr text-[16px]">tune</span>
                          {tf("manage", "Manage")}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-4 text-sm text-muted text-center">
                      {rentals.length === 0
                        ? t("timeline_empty")
                        : tf("no_results", "No matching clients.")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="space-y-2.5">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-muted">
          <span className="msr text-[18px]">calendar_month</span>
          {t("timeline_title")}
        </h2>
        <Timeline />
      </section>

      {edit && (
        <Modal
          title={`${tf("edit_reservation", "Edit Reservation")} · ${edit.client_name}`}
          onClose={() => setEdit(null)}
          wide
        >
          <EditReservationForm rental={edit} onChange={load} onClose={() => setEdit(null)} />
        </Modal>
      )}

      {manage && (
        <Modal
          title={`${tf("manage_return", "Manage / Return")} · ${manage.client_name}`}
          onClose={() => setManage(null)}
          wide
        >
          <ManageReturnForm rental={manage} onChange={load} onClose={() => setManage(null)} />
        </Modal>
      )}

      {booking && (
        <Modal
          title={t("quick_register")}
          onClose={() => setBooking(false)}
          size="full"
          fullHeight
          bodyClassName="!mt-4 !mb-4 !p-4"
        >
          <BookingDialog onClose={() => setBooking(false)} onCreated={load} />
        </Modal>
      )}

      {exporting && (
        <Modal
          title={tf("download_timeline", "Download Timeline (PDF)")}
          onClose={() => setExporting(false)}
        >
          <div className="space-y-4">
            <div>
              <div className="text-xs font-semibold text-muted mb-2">
                {tf("tl_export_range", "Export range")}
              </div>
              <div className="space-y-1.5">
                {rangeOpts.map((o) => (
                  <label
                    key={o.key}
                    className="flex items-center gap-2.5 text-sm cursor-pointer rounded-lg px-2 py-1.5 hover:bg-[rgba(17,24,39,0.04)]"
                  >
                    <input
                      type="radio"
                      name="tl_range"
                      className="w-auto"
                      checked={range === o.key}
                      onChange={() => setRange(o.key)}
                    />
                    {tf(o.label, o.fb)}
                  </label>
                ))}
              </div>
            </div>
            <button
              className="btn btn-primary w-full"
              onClick={downloadTimeline}
              disabled={busy}
            >
              <span className="msr text-[18px]">picture_as_pdf</span>
              {busy ? tf("loading", "Working…") : tf("download_pdf", "Download PDF")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
