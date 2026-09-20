import { useState } from "react";
import { api, apiPost } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { useMoney } from "@/lib/currency";
import { Modal } from "./Modal";
// Editing is the booking dialog prefilled — see BookingDialog's `editRental`.
// The cycle back here is `import type` only, so it erases at compile time.
import { BookingDialog } from "./BookingDialog";
import { initialsOf } from "./SwipeCard";

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
  /** Updated by the API whenever the reservation itself changes. */
  updated_at?: string;
  /** Fallback for data created before updated_at was introduced. */
  created_at?: string;
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

const parseLocalDate = (value: string) => new Date((value || "").replace(" ", "T"));

export type ReservationUrgency = "upcoming" | "active" | "due" | "overdue" | "closed";

/** Human-friendly state and exact-time progress shared by every reservation card. */
export function getReservationUrgency(
  rental: Pick<ActiveRental, "status" | "start_dt" | "end_dt">,
  now = new Date()
): { kind: ReservationUrgency; days: number; progress: number } {
  const start = parseLocalDate(rental.start_dt);
  const end = parseLocalDate(rental.end_dt);
  const validRange = !isNaN(start.getTime()) && !isNaN(end.getTime()) && end > start;

  if (rental.status.toLowerCase() !== "active") {
    return { kind: "closed", days: 0, progress: 100 };
  }

  const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const startDays = daysBetweenISO(todayISO, rental.start_dt.slice(0, 10));
  const endDays = daysBetweenISO(todayISO, rental.end_dt.slice(0, 10));
  const progress = validRange
    ? Math.max(0, Math.min(100, ((now.getTime() - start.getTime()) / (end.getTime() - start.getTime())) * 100))
    : 0;

  if (validRange && now < start) return { kind: "upcoming", days: Math.max(0, startDays), progress: 0 };
  // A return remains "due today" for the whole calendar day; it becomes
  // overdue on the following day, which matches how operators bill day spans.
  if (endDays < 0) {
    return { kind: "overdue", days: Math.max(1, Math.abs(endDays)), progress: 100 };
  }
  if (endDays === 0) return { kind: "due", days: 0, progress };
  return { kind: "active", days: Math.max(0, endDays), progress };
}

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
    const d = parseLocalDate(s);
    if (isNaN(d.getTime())) return "—";
    const day = new Intl.DateTimeFormat(lang || "en", { day: "numeric", month: "long", year: "numeric" }).format(d);
    return `${day} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  };

  const fmtUpdated = (s?: string) => {
    if (!s) return "—";
    const d = parseLocalDate(s);
    if (isNaN(d.getTime())) return "—";
    return new Intl.DateTimeFormat(lang || "en", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
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

  const urgency = getReservationUrgency(r);
  const urgencyText: Record<ReservationUrgency, { label: string; detail: string }> = {
    upcoming: {
      label: tf("status_upcoming", "Upcoming"),
      detail:
        urgency.days === 0
          ? tf("starts_today", "Starts today")
          : `${tf("starts_in", "Starts in")} ${urgency.days} ${urgency.days === 1 ? tf("day", "day") : tf("days", "days")}`,
    },
    active: {
      label: tf("active", "Active"),
      detail: `${urgency.days} ${urgency.days === 1 ? tf("day_left", "day left") : tf("days_left", "days left")}`,
    },
    due: { label: tf("active", "Active"), detail: tf("due_today", "Due today") },
    overdue: {
      label: tf("overdue", "Overdue"),
      detail: `${urgency.days} ${urgency.days === 1 ? tf("day_overdue", "day overdue") : tf("days_overdue", "days overdue")}`,
    },
    closed: { label: tf("status_closed", "Closed"), detail: tf("rental_complete", "Rental complete") },
  };
  const currentUrgency = urgencyText[urgency.kind];
  const cardTitleId = `reservation-${r.deal_id.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <article className="reservation-card" aria-labelledby={cardTitleId} aria-busy={busy || undefined}>
      <header className="reservation-card__header">
        <div className="reservation-card__avatar" aria-hidden="true">{initialsOf(r.client_name)}</div>
        <div className="min-w-0 flex-1">
          <h3 id={cardTitleId} className="reservation-card__name">{r.client_name || "—"}</h3>
          <div className="reservation-card__reference">{fmtInvoiceNo(r.deal_id)}</div>
        </div>
        <div className={`reservation-status reservation-status--${urgency.kind}`} aria-label={`${currentUrgency.label}: ${currentUrgency.detail}`}>
          <span className="reservation-status__dot" aria-hidden="true" />
          <span>{currentUrgency.label}</span>
          <span className="reservation-status__separator" aria-hidden="true">·</span>
          <span className="reservation-status__detail">{currentUrgency.detail}</span>
        </div>
      </header>

      <div className="reservation-card__body">
        <div className="reservation-info-grid">
          <section className="reservation-info" aria-label={tf("contact", "Contact")}>
            <div className="reservation-detail-row">
              <span className="reservation-icon" aria-hidden="true"><span className="msr">call</span></span>
              <div className="reservation-detail-value reservation-detail-value--mono">{r.phone || "—"}</div>
            </div>
            <div className="reservation-detail-row">
              <span className="reservation-icon" aria-hidden="true"><span className="msr">badge</span></span>
              <div className="reservation-detail-value reservation-detail-value--mono">{r.id_passport || "—"}</div>
            </div>
          </section>

          <section className="reservation-info reservation-info--vehicle" aria-label={tf("invoice_vehicle", "Vehicle")}>
            <div className="reservation-detail-row">
              <span className="reservation-icon reservation-icon--vehicle" aria-hidden="true"><span className="msr">directions_car</span></span>
              <div className="reservation-vehicle-name">{r.make_model || "—"}{r.color ? ` · ${r.color}` : ""}</div>
            </div>
            <div className="reservation-detail-row">
              <span className="reservation-icon" aria-hidden="true"><span className="msr">pin</span></span>
              <span className="reservation-plate">{r.license_plate || "—"}</span>
            </div>
          </section>
        </div>

        <section className="reservation-period" aria-label={tf("period", "Rental period")}>
          <div className="reservation-period__topline">
            <div className="reservation-period__icon" aria-hidden="true"><span className="msr">calendar_month</span></div>
            <div className="reservation-period__dates">
              <div className="min-w-0">
                <div className="reservation-detail-label">{tf("pickup", "Pickup")}</div>
                <time dateTime={r.start_dt}>{fmtFull(r.start_dt)}</time>
              </div>
              <span className="reservation-period__arrow msr" aria-hidden="true">arrow_forward</span>
              <div className="min-w-0">
                <div className="reservation-detail-label">{tf("return", "Return")}</div>
                <time dateTime={r.end_dt}>{fmtFull(r.end_dt)}</time>
              </div>
            </div>
          </div>
          <div
            className="reservation-progress"
            role="progressbar"
            aria-label={tf("rental_progress", "Rental progress")}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(urgency.progress)}
          >
            <span style={{ width: `${urgency.progress}%` }} />
          </div>
          <div className="reservation-period__helper">
            <span>{r.rental_days} {r.rental_days === 1 ? tf("rental_day", "rental day") : tf("rental_days", "rental days")}</span>
            <span aria-hidden="true">·</span>
            <span>{currentUrgency.detail}</span>
          </div>

          <dl className="reservation-metrics">
            <div className="reservation-metric reservation-metric--rate">
              <dt className="sr-only">{tf("daily_rate", "Daily rate")}</dt>
              <dd><span className="msr" aria-hidden="true">euro</span>{fmt(r.daily_rate)}<span>/{tf("per_day", "day")}</span></dd>
            </div>
            <div className="reservation-metric reservation-metric--days">
              <dt className="sr-only">{tf("days", "Days")}</dt>
              <dd><span className="msr" aria-hidden="true">calendar_month</span><span className="reservation-metric__days">{r.rental_days} {tf("days_short", "Days")}</span></dd>
            </div>
            <div className="reservation-metric reservation-metric--total reservation-metric--amount">
              <dt className="sr-only">{tf("live_total", "Total")}</dt>
              <dd><span className="msr" aria-hidden="true">account_balance_wallet</span>{fmt(r.total_amount)}</dd>
            </div>
            <div className="reservation-metric reservation-metric--deposit reservation-metric--amount">
              <dt className="sr-only">{tf("deposit", "Deposit")}</dt>
              <dd><span className="msr" aria-hidden="true">verified_user</span>{fmt(r.deposit)}</dd>
            </div>
          </dl>
        </section>

        <div className="reservation-actions" aria-label={tf("col_actions", "Reservation actions")}>
          <button type="button" className="reservation-action" onClick={() => setEditOpen(true)} title={tf("edit_reservation_hint", "Change dates, rate or the assigned car")}>
            <span className="reservation-action__icon" aria-hidden="true"><span className="msr">edit_square</span></span>
            {t("edit_reservation") === "edit_reservation" ? "Edit Reservation" : t("edit_reservation")}
          </button>
          <button type="button" className="reservation-action" onClick={() => setManageOpen(true)} title={tf("manage_rental", "Manage / Return")}>
            <span className="reservation-action__icon" aria-hidden="true"><span className="msr">build</span></span>
            {tf("manage_rental", "Manage / Return")}
          </button>
          <button type="button" className="reservation-action" onClick={openLangPicker} title={tf("print_invoice_hint", "Open a printable invoice for this rental")}>
            <span className="reservation-action__icon reservation-action__icon--invoice" aria-hidden="true"><span className="msr">receipt_long</span></span>
            {tf("print_invoice", "Print Invoice")}
          </button>
          <button type="button" className="reservation-action reservation-action--danger" onClick={cancelReservation} disabled={busy} title={tf("cancel_hint", "Cancel this reservation and free the car")}>
            <span className="reservation-action__icon" aria-hidden="true"><span className="msr">cancel</span></span>
            {busy ? tf("loading", "Working…") : tf("cancel_reservation", "Cancel Reservation")}
          </button>
        </div>
      </div>

      <footer className="reservation-card__footer">
        <span className="msr" aria-hidden="true">schedule</span>
        <span>{tf("last_updated", "Last updated")}: {fmtUpdated(r.updated_at || r.created_at)}</span>
      </footer>

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
            tf("manage_rental", "Manage / Return")
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
    </article>
  );
}
