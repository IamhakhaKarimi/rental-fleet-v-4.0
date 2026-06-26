"use client";
import { useCallback, useEffect, useState } from "react";
import { api, apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { can } from "@/lib/perms";
import { Modal } from "@/components/Modal";
import { Timeline } from "@/components/Timeline";
import { BookingDialog } from "@/components/BookingDialog";
import { ReservationCard, type ActiveRental } from "@/components/ReservationCard";

type TLRange = "week" | "month" | "two_month" | "all_months";

export default function ReservationsPage() {
  const { t, lang } = useI18n();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));
  const { user } = useAuth();
  const [rentals, setRentals] = useState<ActiveRental[]>([]);
  const [booking, setBooking] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [range, setRange] = useState<TLRange>("week");
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    apiGet<ActiveRental[]>("/api/rentals/active").then(setRentals).catch(() => {});
  }, []);
  useEffect(() => {
    load();
  }, [load]);

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
      alert(tf(e?.key || "error", "Could not download the timeline PDF."));
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
        <h2 className="text-sm font-semibold text-muted">
          {t("active_rentals") === "active_rentals" ? "Active rentals" : t("active_rentals")} ({rentals.length})
        </h2>
        <div className="space-y-3">
          {rentals.map((r) => (
            <ReservationCard key={r.deal_id} rental={r} onChange={load} />
          ))}
          {rentals.length === 0 && <div className="text-sm text-muted">{t("timeline_empty")}</div>}
        </div>
      </section>

      <section className="space-y-2.5">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-muted">
          <span className="msr text-[18px]">calendar_month</span>
          {t("timeline_title")}
        </h2>
        <Timeline />
      </section>

      {booking && (
        <Modal title={t("quick_register")} onClose={() => setBooking(false)} wide>
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
