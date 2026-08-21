"use client";
import { useEffect, useState } from "react";
import { api, apiPost } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { useMoney } from "@/lib/currency";
import { Modal } from "./Modal";
// Editing is the booking dialog prefilled — see BookingDialog's `editRental`.
// The cycle back here is `import type` only, so it erases at compile time.
import { BookingDialog } from "./BookingDialog";
import { StatusBadge } from "./StatusBadge";
import { SwipeCard, SwipeField, SwipePanel } from "./SwipeCard";

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

const lbl = "text-xs text-muted block mb-1";
/**
 * Manage / Return — closing charges, condition notes and the return itself.
 * Modal-hosted for the same reason as the edit form: closing a rental is a
 * committing action and deserves an undivided screen.
 */
export function ManageReturnForm({
  rental: r,
  onChange,
  onClose,
}: {
  rental: ActiveRental;
  onChange: () => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const toast = useToast();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));

  const [penalty, setPenalty] = useState(0);
  const [damage, setDamage] = useState(0);
  const [notes, setNotes] = useState("");
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);

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
      onClose();
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className={lbl}>
            {t("overdue_penalty") === "overdue_penalty" ? "Overdue Penalty (€)" : t("overdue_penalty")}
          </label>
          <Stepper value={penalty} set={setPenalty} />
        </div>
        <div>
          <label className={lbl}>
            {t("damage_charge") === "damage_charge" ? "Damage Charge (€)" : t("damage_charge")}
          </label>
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
      <button
        className="btn btn-primary w-full"
        onClick={processReturn}
        disabled={busy}
        title={tf("process_return_hint", "Close the rental, record charges, free the car")}
      >
        <span className="msr text-[18px]">assignment_turned_in</span>
        {busy ? "…" : tf("process_return", "Process Return & Close")}
      </button>
    </div>
  );
}

export function ReservationCard({ rental, onChange }: { rental: ActiveRental; onChange: () => void }) {
  const fmt = useMoney();
  const { t, lang } = useI18n();
  const toast = useToast();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));
  const r = rental;

  const fmtFull = (s: string) => {
    const d = new Date(s.replace(" ", "T"));
    const day = new Intl.DateTimeFormat(lang || "en", { day: "numeric", month: "long", year: "numeric" }).format(d);
    return `${day} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const [editOpen, setEditOpen] = useState(false);
  // The edit dialog is the booking dialog, so its modal is sized per-step too.
  const [editStep, setEditStep] = useState<string>("period");
  const closeEdit = () => {
    setEditOpen(false);
    setEditStep("period");
  };
  const [manageOpen, setManageOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  // Print-invoice language picker — asks which language the client's invoice uses.
  const [langOpen, setLangOpen] = useState(false);
  const [invLangs, setInvLangs] = useState<Record<string, string>>({});
  const [invLang, setInvLang] = useState("");

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

  // Days left until the return date (date-only, timezone-safe). Drives the header
  // chip: "Nd" upcoming, "today" on the due day, "overdue" past it.
  const now = new Date();
  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const daysLeft = daysBetweenISO(todayISO, r.end_dt.slice(0, 10));
  const daysChip =
    daysLeft > 0
      ? `${daysLeft}${tf("days_left_short", "d")}`
      : daysLeft === 0
      ? tf("due_today_short", "today")
      : tf("overdue_short", "overdue");

  return (
    <SwipeCard
      name={r.client_name}
      reference={fmtInvoiceNo(r.deal_id)}
      chip={daysChip}
      chipTitle={tf("days_left", "Days left")}
    >
      {/* Info grid — labelled two-column body */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3">
        <SwipeField label={tf("contact", "Contact")}>
          <div className="swipe-val-mono">{r.phone || "—"}</div>
          <div className="swipe-val-mono mt-1">{r.id_passport || "—"}</div>
        </SwipeField>
        <SwipeField label={tf("invoice_vehicle", "Vehicle")}>
          <div className="swipe-val truncate">
            {r.make_model} · {r.color || "—"}
          </div>
          <div className="swipe-val-mono mt-1">{r.license_plate || "—"}</div>
        </SwipeField>
      </div>

      <div className="mt-3">
        <SwipePanel>
          <div className="flex items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-ink">
              {fmtFull(r.start_dt)} → {fmtFull(r.end_dt)}
            </div>
            <StatusBadge status={r.status} />
          </div>
          <div className="text-[11px] text-muted mt-1.5">
            {fmt(r.daily_rate)}/{tf("day", "day")} · {t("days")}: {r.rental_days} ·{" "}
            {t("live_total")}: {fmt(r.total_amount)} · {t("deposit")}: {fmt(r.deposit)}
          </div>
        </SwipePanel>
      </div>

      {/* Working actions — each opens a focused modal. */}
      <div className="flex items-center gap-2 mt-3">
        <button
          className="btn flex-1"
          onClick={() => setEditOpen(true)}
          title={tf("edit_reservation_hint", "Change dates, rate or the assigned car")}
        >
          <span className="msr text-[18px]">edit</span>
          {t("edit_reservation") === "edit_reservation" ? "Edit Reservation" : t("edit_reservation")}
        </button>
        <button
          className="btn flex-1"
          onClick={() => setManageOpen(true)}
          title={tf("manage_return_hint", "Record charges and close the rental")}
        >
          <span className="msr text-[18px]">build</span>
          {t("manage_return") === "manage_return" ? "Manage / Return" : t("manage_return")}
        </button>
      </div>

      {/* Closing actions — the last things done with a departing client, so they
          sit at the foot of the card behind a rule. */}
      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line">
        <button
          className="btn flex-1"
          onClick={openLangPicker}
          title={tf("print_invoice_hint", "Open a printable invoice for this rental")}
        >
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
          {tf("cancel_reservation", "Cancel Reservation")}
        </button>
      </div>

      {/* Same dialog as "New Reservation", prefilled — one shape of a rental to
          learn, whether you are creating or changing one. */}
      {editOpen && (
        <Modal
          title={`${
            t("edit_reservation") === "edit_reservation" ? "Edit Reservation" : t("edit_reservation")
          } · ${r.client_name}`}
          onClose={closeEdit}
          size={editStep === "review" ? "full" : "compact"}
          fullHeight
          bodyClassName="!mt-[10px] !mb-[10px] !px-[50px] !py-[10px]"
        >
          <BookingDialog
            editRental={r}
            onClose={closeEdit}
            onCreated={() => {
              onChange();
              closeEdit();
            }}
            onStepChange={setEditStep}
          />
        </Modal>
      )}

      {manageOpen && (
        <Modal
          title={`${
            t("manage_return") === "manage_return" ? "Manage / Return" : t("manage_return")
          } · ${r.client_name}`}
          onClose={() => setManageOpen(false)}
          wide
        >
          <ManageReturnForm rental={r} onChange={onChange} onClose={() => setManageOpen(false)} />
        </Modal>
      )}

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
    </SwipeCard>
  );
}
