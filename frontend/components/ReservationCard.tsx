"use client";
import { useEffect, useState } from "react";
import { api, apiGet, apiPost, apiPut } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { formatEur } from "@/lib/money";
import { Modal } from "./Modal";

export interface ActiveRental {
  deal_id: string;
  vehicle_id: string;
  status: string;
  make_model: string;
  color: string;
  license_plate: string;
  client_name: string;
  phone: string;
  id_passport: string;
  start_dt: string;
  end_dt: string;
  rental_days: number;
  daily_rate: number;
  total_amount: number;
  deposit: number;
}

const fmtInvoiceNo = (id: string) =>
  id.replace(/^(RENT-)(\d{4})(\d{2})(-.+)$/, "$1$2-$3$4");

// Whole-day span between two local "YYYY-MM-DD" strings (no UTC parsing, so it
// can't drift across timezones). Used to show the live day count as the return
// date is edited.
const daysBetweenISO = (a: string, b: string) => {
  const [y1, m1, d1] = a.split("-").map(Number);
  const [y2, m2, d2] = b.split("-").map(Number);
  return Math.round((new Date(y2, m2 - 1, d2).getTime() - new Date(y1, m1 - 1, d1).getTime()) / 86400000);
};

function Stepper({ value, set, step = 5 }: { value: number; set: (n: number) => void; step?: number }) {
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min={0}
        value={value}
        onChange={(e) => set(Math.max(0, +e.target.value))}
        className="flex-1"
      />
      <button className="btn !p-2" onClick={() => set(Math.max(0, value - step))} aria-label="decrease">
        <span className="msr text-[16px]">remove</span>
      </button>
      <button className="btn !p-2" onClick={() => set(value + step)} aria-label="increase">
        <span className="msr text-[16px]">add</span>
      </button>
    </div>
  );
}

function Section({
  icon,
  title,
  danger,
  children,
}: {
  icon: string;
  title: string;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="card overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-4 py-2.5 text-sm font-medium hover:bg-[rgba(17,24,39,0.03)]"
      >
        <span className="msr text-[18px]">{open ? "expand_more" : "chevron_right"}</span>
        <span className={`msr text-[18px] ${danger ? "text-danger" : ""}`}>{icon}</span>
        {title}
      </button>
      {open && <div className="px-4 pb-4 pt-1 border-t border-line">{children}</div>}
    </div>
  );
}

export function ReservationCard({ rental, onChange }: { rental: ActiveRental; onChange: () => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));
  const r = rental;

  const fmtFull = (s: string) => {
    const d = new Date(s.replace(" ", "T"));
    const day = new Intl.DateTimeFormat(lang || "en", { day: "numeric", month: "long", year: "numeric" }).format(d);
    return `${day} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  // Edit Reservation
  const [rate, setRate] = useState(Math.round((r.daily_rate || 0) / 100));
  const [vehicleId, setVehicleId] = useState(r.vehicle_id);
  const [startDate, setStartDate] = useState(r.start_dt.slice(0, 10));
  const [returnDate, setReturnDate] = useState(r.end_dt.slice(0, 10));
  const [cars, setCars] = useState<{ vehicle_id: string; make_model: string; license_plate?: string }[]>([]);
  const editDays = Math.max(1, daysBetweenISO(startDate, returnDate));
  // Manage / Return
  const [penalty, setPenalty] = useState(0);
  const [damage, setDamage] = useState(0);
  const [notes, setNotes] = useState("");
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  // Print-invoice language picker — asks which language the client's invoice uses.
  const [langOpen, setLangOpen] = useState(false);
  const [invLangs, setInvLangs] = useState<Record<string, string>>({});
  const [invLang, setInvLang] = useState("");

  useEffect(() => {
    apiGet<{ vehicle_id: string; make_model: string; license_plate?: string }[]>("/api/vehicles/active")
      .then(setCars)
      .catch(() => {});
  }, []);

  // Ask which language the client's invoice should be in before printing. The
  // picker defaults to the rental's stored invoice language (invoice-meta) and
  // offers all six languages regardless of UI role gating (a customer document is
  // independent of the staff UI language).
  async function openLangPicker() {
    try {
      const meta = await api<{ languages: Record<string, string>; default_lang: string }>(
        `/api/rentals/${r.deal_id}/invoice-meta`
      );
      setInvLangs(meta.languages || {});
      setInvLang(meta.default_lang || "tr");
      setLangOpen(true);
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    }
  }

  async function printInvoice(chosenLang: string) {
    try {
      const html = await api<string>(
        `/api/rentals/${r.deal_id}/invoice.html?lang=${encodeURIComponent(chosenLang)}`
      );
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(html);
        w.document.close();
      }
      setLangOpen(false);
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    }
  }

  async function applyEdit() {
    setBusy(true);
    try {
      const startChanged = startDate && startDate !== r.start_dt.slice(0, 10);
      const endChanged = returnDate && returnDate !== r.end_dt.slice(0, 10);
      if (startChanged || endChanged) {
        await apiPut(`/api/rentals/${r.deal_id}/dates`, {
          start_date: startDate,
          return_date: returnDate,
        });
      }
      if (rate !== Math.round((r.daily_rate || 0) / 100)) {
        await apiPut(`/api/rentals/${r.deal_id}/rate`, { daily_rate_euros: rate });
      }
      if (vehicleId && vehicleId !== r.vehicle_id) {
        await apiPut(`/api/rentals/${r.deal_id}/vehicle`, { vehicle_id: vehicleId });
      }
      toast.success(tf("reservation_updated", "Reservation updated."));
      onChange();
    } catch (e: any) {
      const k = e?.key || "error";
      const fb =
        k === "date_conflict"
          ? "That return date overlaps another booking for this car."
          : k === "invalid_dates"
          ? "The return date must be after the start date."
          : "Could not save the changes.";
      toast.error(tf(k, fb));
    } finally {
      setBusy(false);
    }
  }

  async function processReturn() {
    setBusy(true);
    try {
      await apiPost(`/api/rentals/${r.deal_id}/close`, {
        late_euros: penalty,
        damage_euros: damage,
        return_notes: notes,
        contract_signed: signed,
      });
      toast.success(tf("return_processed", "Return processed — rental closed."));
      onChange();
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  async function cancelReservation() {
    if (!confirm(`${tf("cancel_reservation", "Cancel reservation")} — ${r.vehicle_id}?`)) return;
    setBusy(true);
    try {
      await apiPost(`/api/rentals/${r.deal_id}/cancel`);
      toast.success(tf("reservation_cancelled", "Reservation cancelled."));
      onChange();
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  const lbl = "text-xs text-muted block mb-1";

  // A rental that is already underway (its start has been reached) gets a faded
  // white -> sky-blue header wash so active pickups read differently from upcoming
  // reservations. Invalid/blank dates fall back to "not started".
  const started = new Date(r.start_dt.replace(" ", "T")).getTime() <= Date.now();

  return (
    <div className="card p-4 space-y-3">
      {/* Header */}
      <div className={`rounded-[10px] px-4 py-3 ${started ? "client-bar-started" : "bg-[rgba(17,24,39,0.05)]"}`}>
        <div className={`font-bold ${started ? "cb-name" : "text-ink"}`}>{r.client_name}</div>
        <div className={`text-xs ${started ? "cb-sub" : "text-muted"}`}>{fmtInvoiceNo(r.deal_id)}</div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-ink">
            <span className="msr text-[16px] text-muted">call</span>
            {r.phone || "—"}
          </div>
          <div className="flex items-center gap-1.5 text-ink">
            <span className="msr text-[16px] text-muted">badge</span>
            {r.id_passport || "—"}
          </div>
        </div>
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 font-medium text-ink">
            <span className="msr text-[16px] text-muted">directions_car</span>
            {r.make_model} · {r.color || "—"}
          </div>
          <div className="flex items-center gap-1.5 text-ink">
            <span className="msr text-[16px] text-muted">pin_drop</span>
            {r.license_plate || "—"}
          </div>
        </div>
        <div className="text-sm">
          <div className="text-ink">
            <span className="font-medium">{t("period") === "period" ? "Period" : t("period")}:</span>{" "}
            {fmtFull(r.start_dt)} → {fmtFull(r.end_dt)}
          </div>
          <div className="text-xs text-muted mt-1">
            {formatEur(r.daily_rate)}/day · {t("days")}: {r.rental_days} · {t("live_total")}:{" "}
            {formatEur(r.total_amount)} · {t("deposit")}: {formatEur(r.deposit)}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button className="btn flex-1" onClick={openLangPicker} title={tf("print_invoice_hint", "Open a printable invoice for this rental")}>
          <span className="msr text-[18px]">receipt_long</span>
          {tf("print_invoice", "Print Invoice")}
        </button>
        <button
          className="btn btn-danger"
          onClick={cancelReservation}
          disabled={busy}
          title={tf("cancel_hint", "Cancel this reservation and free the car")}
        >
          <span className="msr text-[18px]">cancel</span>
          {tf("cancel_reservation", "Cancel")}
        </button>
      </div>

      {/* Edit Reservation */}
      <Section icon="edit" title={t("edit_reservation") === "edit_reservation" ? "Edit Reservation" : t("edit_reservation")}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>{tf("start_date", "Start Date")}</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>
            <div>
              <label className={lbl}>{tf("return_date", "Return Date")}</label>
              <input
                type="date"
                min={startDate}
                value={returnDate}
                onChange={(e) => setReturnDate(e.target.value)}
              />
            </div>
          </div>
          <div className="text-xs text-muted -mt-1">
            {editDays} {t("days")}
          </div>
          <div>
            <label className={lbl}>{t("negotiated_rate")} (€)</label>
            <Stepper value={rate} set={setRate} />
          </div>
          <div>
            <label className={lbl}>{t("change_vehicle") === "change_vehicle" ? "Change Vehicle" : t("change_vehicle")}</label>
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              {cars.map((c) => (
                <option key={c.vehicle_id} value={c.vehicle_id}>
                  {c.vehicle_id} · {c.make_model}
                  {c.license_plate ? ` · ${c.license_plate}` : ""}
                  {c.vehicle_id === r.vehicle_id ? " · (keep)" : ""}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-primary" onClick={applyEdit} disabled={busy} title={tf("apply_hint", "Save the new rate / vehicle")}>
            <span className="msr text-[16px]">check</span>
            {tf("apply", "Apply")}
          </button>
        </div>
      </Section>

      {/* Manage / Return */}
      <Section icon="build" danger title={t("manage_return") === "manage_return" ? "Manage / Return" : t("manage_return")}>
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className={lbl}>{t("overdue_penalty") === "overdue_penalty" ? "Overdue Penalty (€)" : t("overdue_penalty")}</label>
              <Stepper value={penalty} set={setPenalty} />
            </div>
            <div>
              <label className={lbl}>{t("damage_charge") === "damage_charge" ? "Damage Charge (€)" : t("damage_charge")}</label>
              <Stepper value={damage} set={setDamage} step={10} />
            </div>
          </div>
          <div>
            <label className={lbl}>
              {t("return_notes") === "return_notes" ? "Return / Condition Notes" : t("return_notes")}
            </label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
          <label className="flex items-center gap-2 text-sm select-none">
            <input type="checkbox" className="w-auto" checked={signed} onChange={(e) => setSigned(e.target.checked)} />
            {t("contract_signed") === "contract_signed" ? "Contract Signed" : t("contract_signed")}
          </label>
          <button className="btn btn-primary w-full" onClick={processReturn} disabled={busy} title={tf("process_return_hint", "Close the rental, record charges, free the car")}>
            <span className="msr text-[18px]">assignment_turned_in</span>
            {tf("process_return", "Process Return & Close")}
          </button>
        </div>
      </Section>

      {/* Print-invoice language picker — choose the client's language, then open
          the printable invoice in that language. */}
      {langOpen && (
        <Modal
          title={tf("choose_client_language", "Choose the client's language")}
          onClose={() => setLangOpen(false)}
        >
          <div className="space-y-4">
            <div className="text-xs text-muted">{tf("invoice_language", "Invoice Language")}</div>
            <div className="space-y-1.5">
              {Object.entries(invLangs).map(([code, label]) => (
                <label
                  key={code}
                  className="flex items-center gap-2.5 text-sm cursor-pointer rounded-lg px-2 py-1.5 hover:bg-[rgba(17,24,39,0.04)]"
                >
                  <input
                    type="radio"
                    name={`inv-lang-${r.deal_id}`}
                    className="w-auto"
                    checked={invLang === code}
                    onChange={() => setInvLang(code)}
                  />
                  {label}
                </label>
              ))}
            </div>
            <button
              className="btn btn-primary w-full"
              onClick={() => printInvoice(invLang)}
              disabled={!invLang}
            >
              <span className="msr text-[18px]">receipt_long</span>
              {tf("print_invoice", "Print Invoice")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
