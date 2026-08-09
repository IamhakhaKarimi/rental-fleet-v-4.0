"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, apiDel, apiGet, apiPut } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { usePolling } from "@/lib/usePolling";
import { useResponsiveView } from "@/lib/useResponsiveView";
import { can, roleLevel } from "@/lib/perms";
import { formatEur } from "@/lib/money";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
import { RefreshIcon } from "@/components/RefreshIcon";
import { ViewToggle } from "@/components/ViewToggle";
import { SwipeCard, SwipeField, SwipePanel, SwipeDeck } from "@/components/SwipeCard";
import { CustomerReportModal, useMonthLabel } from "@/components/CustomerReportModal";
import { usePagedTable } from "@/lib/usePagedTable";
import { Pagination } from "@/components/Pagination";
import type { LanguagesInfo } from "@/lib/types";

// English fallback when a key isn't in the dictionary.
const f = (t: (k: string) => string, key: string, fb: string) =>
  t(key) === key ? fb : t(key);

interface CustomerRow {
  customer_id: number;
  full_name: string;
  phone: string;
  id_passport: string;
  rental_count: number;
  active_count: number;
  last_rental_date: string | null;
  registered_by: string | null;
  last_daily_rate: number | null;
  last_make_model: string | null;
  last_plate: string | null;
}

interface CustomerRental {
  deal_id: string;
  vehicle_id: string;
  make_model: string;
  license_plate: string;
  start_dt: string;
  end_dt: string;
  rental_days: number;
  daily_rate: number;
  total_amount: number;
  status: string;
  created_by: string;
  created_by_name: string;
}

interface StaffUser {
  username: string;
  full_name: string;
  role: string;
}

// One-shot invoice request stashed by a flag button → opens a top-level Modal.
interface InvoiceRequest {
  deal_id: string;
  lang: string;
}

function fmtDate(s: string | null | undefined, lang: string): string {
  if (!s) return "—";
  const d = new Date(String(s).replace(" ", "T"));
  if (isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(lang || "en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

// ── Small presentational primitives for the customer dialog ────────────────
// Shared so every block in the modal gets the same header rhythm, the same
// label casing and the same nesting contrast (bg-bg panels on the modal's
// bg-surface shell, one step lighter, so cards actually read as cards).

function SectionHead({
  icon,
  title,
  count,
  action,
}: {
  icon: string;
  title: string;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 mb-2.5">
      <h3 className="flex items-center gap-1.5 text-[0.68rem] font-semibold uppercase tracking-[0.09em] text-muted">
        <span className="msr text-[15px]">{icon}</span>
        {title}
        {count !== undefined && <span className="text-ink">({count})</span>}
      </h3>
      <div className="h-px flex-1 bg-line" />
      {action}
    </div>
  );
}

function StatTile({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="rounded-xl border border-line bg-bg px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[0.63rem] font-semibold uppercase tracking-[0.07em] text-muted">
        <span className="msr text-[14px]">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="font-display font-bold text-ink text-[1.05rem] tabular-nums mt-1 truncate">
        {value}
      </div>
    </div>
  );
}

// One labelled fact inside a rental card's data grid.
function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="text-[0.62rem] font-semibold uppercase tracking-[0.07em] text-muted truncate">{label}</div>
      <div className="text-xs text-ink mt-0.5 truncate">{children}</div>
    </div>
  );
}

function CustomerDialog({
  customer,
  onClose,
  onChange,
  onInvoice,
}: {
  customer: CustomerRow;
  onClose: () => void;
  onChange: () => void;
  onInvoice: (req: InvoiceRequest) => void;
}) {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const toast = useToast();

  const canEdit = can(user, "service_vehicle");
  const canReassign = can(user, "edit_business_settings") || can(user, "manage_users");
  const canDelete = can(user, "edit_business_settings");
  // Admin + super-admin may retune a booked deal (rate / registered-by) or drop
  // a duplicate row from the history — both move money in the Finance ledger.
  const canEditRental = roleLevel(user) >= 2;
  const canAlbanian = can(user, "create_reservation");

  const [rentals, setRentals] = useState<CustomerRental[]>([]);
  const [langs, setLangs] = useState<Record<string, string>>({});
  const [staff, setStaff] = useState<StaffUser[]>([]);

  // Edit form
  const [name, setName] = useState(customer.full_name || "");
  const [phone, setPhone] = useState(customer.phone || "");
  const [idp, setIdp] = useState(customer.id_passport || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [ok, setOk] = useState("");

  // Per-rental inline editor: which deal is open, and its draft values. Replaces
  // the old page-level "Reassign Registered By" block — the rental being edited
  // is now the card you clicked, so there's no second dropdown to keep in sync.
  const [editing, setEditing] = useState<string | null>(null);
  const [editRate, setEditRate] = useState(0);
  const [editUser, setEditUser] = useState("");
  const [editBusy, setEditBusy] = useState(false);

  const loadRentals = useCallback(() => {
    apiGet<CustomerRental[]>(`/api/customers/${customer.customer_id}/rentals`)
      .then(setRentals)
      .catch(() => {});
  }, [customer.customer_id]);

  useEffect(() => {
    loadRentals();
  }, [loadRentals]);

  useEffect(() => {
    apiGet<LanguagesInfo>("/api/i18n/languages")
      .then((d) => setLangs(d.languages || {}))
      .catch(() => {});
  }, []);

  // Staff list is admin-gated; ignore failures for non-admins.
  useEffect(() => {
    if (!canReassign) return;
    apiGet<StaffUser[]>("/api/users")
      .then(setStaff)
      .catch(() => {});
  }, [canReassign]);

  // Albanian (sq) is staff-only on the invoice flag row.
  const invoiceLangs = useMemo(
    () => Object.entries(langs).filter(([code]) => code !== "sq" || canAlbanian),
    [langs, canAlbanian]
  );

  // Header summary — derived from the history so it always matches the rows below.
  const stats = useMemo(() => {
    const billed = rentals.reduce((s, r) => s + (r.total_amount || 0), 0);
    return {
      count: rentals.length,
      active: rentals.filter((r) => r.status === "Active").length,
      billed,
      last: rentals.length ? rentals[0].start_dt : null, // API sorts start_dt DESC
    };
  }, [rentals]);

  // Only enable Save once something actually changed.
  const dirty =
    name !== (customer.full_name || "") ||
    phone !== (customer.phone || "") ||
    idp !== (customer.id_passport || "");

  // Typing invalidates the last save/error banner.
  const onField = (set: (v: string) => void) => (e: React.ChangeEvent<HTMLInputElement>) => {
    set(e.target.value);
    setOk("");
    setErr("");
  };

  async function saveEdit() {
    if (!name.trim()) {
      setErr(t("fields_required"));
      return;
    }
    setBusy(true);
    setErr("");
    setOk("");
    try {
      await apiPut(`/api/customers/${customer.customer_id}`, {
        full_name: name,
        phone,
        id_passport: idp,
      });
      setOk(f(t, "saved", "Saved"));
      toast.success(f(t, "customer_updated", "Customer updated."));
      onChange();
    } catch (e: any) {
      setErr(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  // Open the inline editor on one rental, seeded with its current values.
  // Rates are stored in cents but negotiated in whole euros, matching the
  // booking dialog's stepper.
  function openEditor(r: CustomerRental) {
    setEditing(r.deal_id);
    setEditRate(Math.max(0, Math.round((r.daily_rate || 0) / 100)));
    setEditUser(r.created_by || "");
  }

  // Persist the drafted rate / registered-by. Each field is only PUT when it
  // actually changed, so an untouched field never writes an audit entry.
  async function saveRental(r: CustomerRental) {
    setEditBusy(true);
    try {
      const rate = Math.max(0, Math.round(editRate));
      if (rate !== Math.round((r.daily_rate || 0) / 100)) {
        await apiPut(`/api/rentals/${r.deal_id}/rate`, { daily_rate_euros: rate });
      }
      if (canReassign && editUser && editUser !== (r.created_by || "")) {
        await apiPut(`/api/rentals/${r.deal_id}/reassign`, { username: editUser });
      }
      toast.success(f(t, "rental_updated", "Rental updated."));
      setEditing(null);
      loadRentals();
      onChange();
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    } finally {
      setEditBusy(false);
    }
  }

  async function removeRentalFromHistory(dealId: string) {
    if (!confirm(f(t, "remove_from_history_confirm", "Remove this rental from history? This cannot be undone and will affect finance totals.")))
      return;
    try {
      await apiDel(`/api/rentals/${dealId}`, { confirm: true });
      toast.success(f(t, "rental_removed", "Rental removed from history."));
      loadRentals();
      onChange();
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    }
  }

  async function removeCustomer() {
    if (!confirm(`${t("delete_btn")}: ${customer.full_name}?`)) return;
    try {
      await apiDel(`/api/customers/${customer.customer_id}`, { confirm: true });
      toast.success(f(t, "customer_deleted", "Customer deleted."));
      onChange();
      onClose();
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    }
  }

  const lbl = "text-xs text-muted";

  return (
    <div className="space-y-6">
      {/* ── At-a-glance summary ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatTile icon="receipt_long" label={f(t, "rentals", "Rentals")} value={String(stats.count)} />
        <StatTile icon="vpn_key" label={f(t, "active", "Active")} value={String(stats.active)} />
        <StatTile icon="payments" label={f(t, "total_billed", "Total billed")} value={formatEur(stats.billed)} />
        <StatTile icon="event" label={f(t, "last_rental", "Last Rental")} value={fmtDate(stats.last, lang)} />
      </div>

      {/* ── Contact details (employer+) ─────────────────────────────────── */}
      {canEdit && (
        <section>
          <SectionHead icon="badge" title={f(t, "edit_customer", "Customer Details")} />
          <div className="rounded-xl border border-line bg-bg p-4 space-y-3">
            <label className={lbl}>
              {t("client_name")}
              <input className="uppercase-input" value={name} onChange={onField(setName)} />
            </label>
            <div className="grid sm:grid-cols-2 gap-3">
              <label className={lbl}>
                {t("client_phone")}
                <input className="uppercase-input" value={phone} onChange={onField(setPhone)} />
              </label>
              <label className={lbl}>
                {t("client_id")}
                <input className="uppercase-input" value={idp} onChange={onField(setIdp)} />
              </label>
            </div>
            {err && (
              <div className="text-xs text-danger flex items-center gap-1.5">
                <span className="msr text-[15px]">error</span>
                {err}
              </div>
            )}
            <div className="flex items-center gap-3 pt-0.5">
              <button
                className="btn btn-primary !py-1.5 text-xs"
                onClick={saveEdit}
                disabled={busy || !dirty}
              >
                <span className="msr text-[16px]">check</span>
                {busy ? "…" : f(t, "update_btn", "Save changes")}
              </button>
              {ok && (
                <span className="text-xs text-ok flex items-center gap-1">
                  <span className="msr text-[15px]">check_circle</span>
                  {ok}
                </span>
              )}
            </div>
          </div>
        </section>
      )}

      {/* ── Rental history ──────────────────────────────────────────────── */}
      <section>
        <SectionHead icon="history" title={f(t, "rental_history", "Rental History")} count={rentals.length} />
        <div className="space-y-2.5">
          {rentals.map((r) => {
            const open = editing === r.deal_id;
            return (
              <div key={r.deal_id} className="rounded-xl border border-line bg-bg overflow-hidden">
                {/* Identity + billed total */}
                <div className="flex items-start justify-between gap-3 px-3.5 pt-3">
                  <div className="min-w-0">
                    <div className="font-medium text-ink truncate leading-tight">{r.make_model}</div>
                    <div className="text-[0.72rem] text-muted mt-0.5 truncate">
                      {r.license_plate || "—"} · {r.deal_id}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="font-display font-bold text-accent text-lg tabular-nums leading-none">
                      {formatEur(r.total_amount)}
                    </div>
                    <div className="mt-1.5">
                      <StatusBadge status={r.status} />
                    </div>
                  </div>
                </div>

                {/* Deal facts */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-3 gap-y-2 px-3.5 py-3">
                  <Fact label={t("start_date")}>{fmtDate(r.start_dt, lang)}</Fact>
                  <Fact label={t("return_date")}>{fmtDate(r.end_dt, lang)}</Fact>
                  <Fact label={t("days")}>{r.rental_days}</Fact>
                  <Fact label={f(t, "rate", "Rate")}>
                    {formatEur(r.daily_rate)}
                    <span className="text-muted">/{f(t, "day", "day")}</span>
                  </Fact>
                </div>

                {r.created_by_name && (
                  <div className="flex items-center gap-1.5 px-3.5 pb-3 text-[0.72rem] text-muted truncate">
                    <span className="msr text-[14px]">person</span>
                    {f(t, "registered_by", "Registered By")}:
                    <span className="text-ink">{r.created_by_name}</span>
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-wrap px-3.5 py-2.5 border-t border-line">
                  <span className="text-[0.7rem] text-muted flex items-center gap-1">
                    <span className="msr text-[15px]">receipt_long</span>
                    {f(t, "print_invoice", "Invoice")}
                  </span>
                  {invoiceLangs.map(([code, label]) => (
                    <button
                      key={code}
                      className="btn !py-1 !px-2 text-xs"
                      title={label}
                      onClick={() => onInvoice({ deal_id: r.deal_id, lang: code })}
                    >
                      {label.split(" ")[0] || code.toUpperCase()}
                    </button>
                  ))}
                  {canEditRental && (
                    <div className="ml-auto flex items-center gap-1.5">
                      <button
                        className={`btn !py-1 !px-2 text-xs ${open ? "btn-primary" : ""}`}
                        title={f(t, "edit_rental_hint", "Edit negotiated rate / registered by")}
                        onClick={() => (open ? setEditing(null) : openEditor(r))}
                      >
                        <span className="msr text-[16px]">tune</span>
                        {f(t, "edit", "Edit")}
                      </button>
                      <button
                        className="btn btn-danger !py-1 !px-2 text-xs"
                        title={f(t, "remove_from_history", "Remove from history")}
                        onClick={() => removeRentalFromHistory(r.deal_id)}
                      >
                        <span className="msr text-[16px]">delete</span>
                        {f(t, "remove_from_history", "Remove from history")}
                      </button>
                    </div>
                  )}
                </div>

                {/* Inline editor (admin+) — negotiated rate + registered by */}
                {open && (
                  <div className="px-3.5 py-3.5 border-t border-line bg-surface space-y-3">
                    <div className="grid sm:grid-cols-2 gap-3">
                      <div className={lbl}>
                        {t("negotiated_rate")} (€)
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="btn !p-2"
                            title="−5"
                            aria-label={f(t, "decrease", "Decrease")}
                            onClick={() => setEditRate((v) => Math.max(0, v - 5))}
                          >
                            <span className="msr text-[16px]">remove</span>
                          </button>
                          <input
                            type="number"
                            min={0}
                            value={editRate}
                            className="flex-1 text-center"
                            onChange={(e) => setEditRate(Math.max(0, +e.target.value))}
                          />
                          <button
                            type="button"
                            className="btn !p-2"
                            title="+5"
                            aria-label={f(t, "increase", "Increase")}
                            onClick={() => setEditRate((v) => v + 5)}
                          >
                            <span className="msr text-[16px]">add</span>
                          </button>
                        </div>
                      </div>
                      {canReassign && staff.length > 0 && (
                        <label className={lbl}>
                          {f(t, "registered_by", "Registered By")}
                          <select value={editUser} onChange={(e) => setEditUser(e.target.value)}>
                            {staff.map((u) => (
                              <option key={u.username} value={u.username}>
                                {u.full_name || u.username} ({u.username})
                              </option>
                            ))}
                          </select>
                        </label>
                      )}
                    </div>

                    {/* Live recomputed total — mirrors the booking dialog */}
                    <div className="flex items-center justify-between gap-3 rounded-lg border border-line bg-bg px-3 py-2">
                      <span className="text-xs text-muted">
                        {f(t, "new_total", "New total")} · €{editRate} × {r.rental_days}
                      </span>
                      <span className="font-display font-bold text-accent tabular-nums">
                        {formatEur(editRate * r.rental_days * 100)}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        className="btn btn-primary !py-1.5 text-xs"
                        onClick={() => saveRental(r)}
                        disabled={editBusy}
                      >
                        <span className="msr text-[16px]">check</span>
                        {editBusy ? "…" : f(t, "update_btn", "Save changes")}
                      </button>
                      <button
                        className="btn !py-1.5 text-xs"
                        onClick={() => setEditing(null)}
                        disabled={editBusy}
                      >
                        {f(t, "cancel", "Cancel")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {rentals.length === 0 && (
            <div className="rounded-xl border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
              {f(t, "no_rentals", "No rentals yet.")}
            </div>
          )}
        </div>
      </section>

      {/* ── Danger zone (super-admin) ───────────────────────────────────── */}
      {canDelete && (
        <section>
          <SectionHead icon="warning" title={f(t, "danger_zone", "Danger Zone")} />
          <div className="rounded-xl border border-line bg-bg p-4 flex items-center justify-between gap-4 flex-wrap">
            <p className="text-xs text-muted max-w-sm">
              {f(
                t,
                "delete_customer_hint",
                "Permanently deletes this customer together with every rental and charge listed above."
              )}
            </p>
            <button className="btn btn-danger !py-1.5 text-xs shrink-0" onClick={removeCustomer}>
              <span className="msr text-[16px]">delete_forever</span>
              {f(t, "delete_customer", "Delete Customer")}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

// Invoice viewer: embeds the rental invoice HTML in an iframe with a language
// switch + a Download-PDF button. No window.open — renders inside a Modal.
function InvoiceViewer({ req }: { req: InvoiceRequest }) {
  const { t } = useI18n();
  const toast = useToast();
  const [langs, setLangs] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string>(req.lang);
  const [html, setHtml] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string>("");
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    apiGet<LanguagesInfo>("/api/i18n/languages")
      .then((d) => setLangs(d.languages || {}))
      .catch(() => {});
  }, []);

  // (Re)fetch the embedded HTML preview whenever the selected language changes.
  useEffect(() => {
    if (!sel) return;
    let active = true;
    setLoading(true);
    setErr("");
    api<string>(
      `/api/rentals/${encodeURIComponent(req.deal_id)}/invoice.html?lang=${encodeURIComponent(sel)}`
    )
      .then((doc) => active && setHtml(doc))
      .catch((e: any) => active && setErr(t(e?.key || "error")))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [req.deal_id, sel, t]);

  const download = useCallback(async () => {
    setDownloading(true);
    try {
      const res = await api(
        `/api/rentals/${encodeURIComponent(req.deal_id)}/invoice.pdf?lang=${encodeURIComponent(sel)}`,
        { raw: true }
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice_${req.deal_id}_${sel}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    } finally {
      setDownloading(false);
    }
  }, [req.deal_id, sel, t]);

  return (
    <div className="space-y-3">
      {/* Language switch + download */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-muted">{f(t, "invoice_language", "Invoice Language")}:</span>
        {Object.entries(langs).map(([code, label]) => (
          <button
            key={code}
            className={`btn !py-1 !px-2 text-xs ${sel === code ? "btn-primary" : ""}`}
            title={label}
            onClick={() => setSel(code)}
          >
            {label.split(" ")[0] || code.toUpperCase()}
          </button>
        ))}
        <button className="btn btn-primary !py-1 !px-3 text-xs ml-auto" onClick={download} disabled={downloading}>
          <span className="msr text-[16px]">download</span>
          {downloading ? "…" : f(t, "download_pdf", "Download PDF")}
        </button>
      </div>

      {err ? (
        <div className="card p-6 text-sm text-danger">{err}</div>
      ) : (
        <div className="card p-2 relative">
          {loading && (
            <div className="absolute inset-0 grid place-items-center bg-bg/60 z-10 text-sm text-muted">
              {f(t, "loading", "Loading…")}
            </div>
          )}
          {/* A hard 760px is taller than a phone viewport, so the preview took
              over the screen with no way to see the controls around it. Below
              `lg` it becomes a scrollable 60dvh window onto the same document;
              desktop keeps the full 760px. */}
          <iframe
            srcDoc={html}
            title="invoice"
            className="w-full rounded-md bg-white h-[60dvh] lg:h-[760px]"
            style={{ border: 0 }}
          />
        </div>
      )}
    </div>
  );
}

interface ActiveRentalLite {
  deal_id: string;
  client_name: string;
  make_model: string;
  license_plate: string;
  start_dt: string;
  end_dt: string;
}

// Batch office-invoice print: lists active rentals grouped by month with a checkbox
// each (all on by default), then opens ONE printable document holding a single office
// copy per selected rental (the backend splices them, one A4 page each).
function InvoicePrintModal({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const [rentals, setRentals] = useState<ActiveRentalLite[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [printing, setPrinting] = useState(false);
  const monthLabel = useMonthLabel(lang, t);

  useEffect(() => {
    apiGet<ActiveRentalLite[]>("/api/rentals/active")
      .then((rows) => {
        setRentals(rows);
        setSelected(new Set(rows.map((r) => r.deal_id))); // default: all selected
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Group by the start date's month (YYYY-MM), newest month first.
  const groups = useMemo(() => {
    const m = new Map<string, ActiveRentalLite[]>();
    for (const r of rentals) {
      const key = (r.start_dt || "").slice(0, 7) || "—";
      const arr = m.get(key);
      if (arr) arr.push(r);
      else m.set(key, [r]);
    }
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [rentals]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const allOn = rentals.length > 0 && selected.size === rentals.length;
  const toggleAll = () =>
    setSelected(allOn ? new Set() : new Set(rentals.map((r) => r.deal_id)));

  async function print() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    setPrinting(true);
    try {
      const html = await api<string>("/api/rentals/invoices-batch.html", {
        method: "POST",
        body: { deal_ids: ids, lang: lang || "tr" },
      });
      const w = window.open("", "_blank");
      if (w) {
        w.document.write(html);
        w.document.close();
        onClose();
      } else {
        toast.error(f(t, "popup_blocked", "Please allow pop-ups to print."));
      }
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    } finally {
      setPrinting(false);
    }
  }

  return (
    <Modal title={f(t, "print_active_invoices", "Print Active Invoices")} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted">
            {f(t, "print_invoices_help", "One office copy per selected rental, grouped by month.")}
          </div>
          <button
            className="btn !py-1 !px-2 text-xs shrink-0"
            onClick={toggleAll}
            disabled={rentals.length === 0}
          >
            {allOn ? f(t, "select_none", "Select none") : f(t, "select_all", "Select all")}
          </button>
        </div>

        {loading ? (
          <div className="text-sm text-muted">{f(t, "loading", "Loading…")}</div>
        ) : rentals.length === 0 ? (
          <div className="text-sm text-muted">{f(t, "no_active_rentals", "No active rentals.")}</div>
        ) : (
          <div className="space-y-3 max-h-[50vh] overflow-y-auto pr-1">
            {groups.map(([ym, list]) => (
              <div key={ym} className="space-y-1">
                <div className="text-xs font-semibold text-muted pt-1">
                  {monthLabel(ym)} ({list.length})
                </div>
                {list.map((r) => (
                  <label
                    key={r.deal_id}
                    className="flex items-center gap-2.5 text-sm cursor-pointer rounded-lg px-2 py-1.5 hover:bg-[rgba(17,24,39,0.04)]"
                  >
                    <input
                      type="checkbox"
                      className="w-auto"
                      checked={selected.has(r.deal_id)}
                      onChange={() => toggle(r.deal_id)}
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium text-ink">{r.client_name}</span>
                      <span className="text-muted">
                        {" "}
                        · {r.make_model} · {r.license_plate || "—"}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}

        <button
          className="btn btn-primary w-full"
          onClick={print}
          disabled={printing || selected.size === 0}
        >
          <span className="msr text-[18px]">print</span>
          {printing ? "…" : `${f(t, "print_selected", "Print selected")} (${selected.size})`}
        </button>
      </div>
    </Modal>
  );
}

export default function CustomersPage() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<CustomerRow | null>(null);
  const [invoice, setInvoice] = useState<InvoiceRequest | null>(null);
  const [invoicePrint, setInvoicePrint] = useState(false);
  const [csvReport, setCsvReport] = useState(false);
  const [pdfReport, setPdfReport] = useState(false);
  const [view, changeView] = useResponsiveView("customers_view");
  // Server-paginated table (M5) — separate from `rows` above, which stays the
  // full filtered list the card view, quick-find dropdown and inactive list
  // need. Only fetches while the table is actually visible.
  const [tableRefresh, setTableRefresh] = useState(0);
  const paged = usePagedTable<CustomerRow>(
    `/api/customers?q=${encodeURIComponent(q)}`, 25, view === "table", tableRefresh
  );

  // Quick-find dropdown (independent search box + selected customer id).
  const [pick, setPick] = useState("");
  const [pickId, setPickId] = useState<string>("");

  const canDeleteCustomer = roleLevel(user) >= 2; // admin + super-admin

  // Single source of truth — one fetch, reused by grid + dropdown + inactive list.
  const load = useCallback(async () => {
    await apiGet<CustomerRow[]>(`/api/customers?q=${encodeURIComponent(q)}`)
      .then(setRows)
      .catch(() => {});
    setTableRefresh((n) => n + 1);
  }, [q]);

  const { isLoading, refetch } = usePolling(load, { interval: 15000 });

  // Re-query as the search box is typed, debounced so a keystroke doesn't hit the
  // API. The first run is skipped — usePolling already did the initial fetch.
  const firstSearch = useRef(true);
  useEffect(() => {
    if (firstSearch.current) {
      firstSearch.current = false;
      return;
    }
    const id = setTimeout(() => {
      load();
    }, 300);
    return () => clearTimeout(id);
  }, [load]);

  // When a flag button asks for an invoice, close the customer modal first so
  // only one modal is "primary"; the invoice modal then opens at the top level.
  const openInvoice = useCallback((req: InvoiceRequest) => {
    setOpen(null);
    setInvoice(req);
  }, []);

  const inactive = useMemo(() => rows.filter((c) => (c.active_count ?? 0) === 0), [rows]);

  // Quick-find dropdown options, filtered live by the pick search box.
  const pickOptions = useMemo(() => {
    const needle = pick.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((c) =>
      `${c.full_name} ${c.phone || ""}`.toLowerCase().includes(needle)
    );
  }, [rows, pick]);

  // Keep the selected id valid against the filtered option list.
  useEffect(() => {
    if (pickId && pickOptions.some((c) => String(c.customer_id) === pickId)) return;
    setPickId(pickOptions.length ? String(pickOptions[0].customer_id) : "");
  }, [pickOptions, pickId]);

  function editPicked() {
    const c = rows.find((r) => String(r.customer_id) === pickId);
    if (c) setOpen(c);
  }

  async function deleteCustomer(c: CustomerRow) {
    if (!confirm(`${t("delete_btn")}: ${c.full_name}?`)) return;
    try {
      await apiDel(`/api/customers/${c.customer_id}`, { confirm: true });
      toast.success(f(t, "customer_deleted", "Customer deleted."));
      load();
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="msr text-[22px]">group</span>
          <h1 className="text-xl font-bold">{t("nav_customers")}</h1>
        </div>
        {/* Four report/print actions. On a phone they become a full-width 2-up
            grid instead of wrapping into four ragged rows of pill buttons. */}
        <div className="flex items-center gap-2 flex-wrap max-sm:grid max-sm:grid-cols-2 max-sm:w-full">
          <RefreshIcon onClick={refetch} isLoading={isLoading} />
          <ViewToggle
            value={view}
            onChange={changeView}
            cardsTitle={f(t, "view_cards", "Card view")}
            tableTitle={f(t, "view_table", "Table view")}
          />
          <button
            className="btn !py-1.5 text-xs"
            onClick={() => setPdfReport(true)}
            title={f(t, "report_pdf_hint", "Paginated client list (PDF)")}
          >
            <span className="msr text-[16px]">picture_as_pdf</span>
            {f(t, "report_pdf", "Report (PDF)")}
          </button>
          <button
            className="btn !py-1.5 text-xs"
            onClick={() => setCsvReport(true)}
            title={f(t, "report_csv_hint", "Customers + car metadata (CSV)")}
          >
            <span className="msr text-[16px]">table_view</span>
            {f(t, "report_csv", "Report (CSV)")}
          </button>
          <button
            className="btn btn-primary !py-1.5 text-xs"
            onClick={() => setInvoicePrint(true)}
            title={f(t, "print_active_invoices_hint", "Batch-print office invoices for active rentals")}
          >
            <span className="msr text-[16px]">print</span>
            {f(t, "print_active_invoices", "Print Active Invoices")}
          </button>
        </div>
      </div>

      {/* Quick-find: [search input] [customer dropdown] [Edit button] */}
      <div className="flex items-end gap-2 flex-wrap">
        <label className="text-xs text-muted max-sm:w-full">
          {f(t, "quick_find", "Quick Find")}
          <input
            placeholder={t("search")}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="w-full lg:max-w-[12rem]"
          />
        </label>
        <select
          value={pickId}
          onChange={(e) => setPickId(e.target.value)}
          className="w-full lg:max-w-xs"
        >
          {pickOptions.length === 0 && <option value="">—</option>}
          {pickOptions.map((c) => (
            <option key={c.customer_id} value={c.customer_id}>
              {c.full_name} — {c.phone || "—"}
            </option>
          ))}
        </select>
        <button className="btn btn-primary !py-1.5 text-xs" onClick={editPicked} disabled={!pickId}>
          <span className="msr text-[16px]">edit</span>
          {f(t, "edit", "Edit")}
        </button>
      </div>

      <input
        placeholder={t("search")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="max-w-sm"
      />
      <p className="text-xs text-muted">
        {rows.length} {f(t, "customers_count", "customers")}
      </p>

      {view === "cards" ? (
        <SwipeDeck
          items={rows}
          keyOf={(c) => c.customer_id}
          empty={
            <div className="text-sm text-muted">{f(t, "no_customers", "No customers found.")}</div>
          }
          render={(c) => (
            <SwipeCard
              name={c.full_name}
              reference={c.phone || "—"}
              chip={
                (c.active_count ?? 0) > 0
                  ? `${c.active_count} ${f(t, "active", "active")}`
                  : `${c.rental_count} ${f(t, "rentals", "rentals")}`
              }
              chipTitle={f(t, "rentals", "Rentals")}
            >
              <div className="grid grid-cols-2 gap-x-4 gap-y-3">
                <SwipeField label={f(t, "last_vehicle", "Last vehicle")}>
                  <div className="swipe-val truncate">{c.last_make_model || "—"}</div>
                  <div className="swipe-val-mono mt-0.5">{c.last_plate || "—"}</div>
                </SwipeField>
                <SwipeField label={f(t, "last_rate", "Last rate")}>
                  <div className="swipe-val">
                    {formatEur(c.last_daily_rate)}
                    <span className="text-muted font-normal">/{f(t, "day", "day")}</span>
                  </div>
                </SwipeField>
              </div>

              <div className="mt-3">
                <SwipePanel>
                  <div className="flex items-center gap-1.5 text-[12px] text-ink">
                    <span className="msr text-[15px] text-muted">event</span>
                    {f(t, "last_rental", "Last Rental")}: {fmtDate(c.last_rental_date, lang)}
                  </div>
                  <div className="flex items-center gap-1.5 text-[11px] text-muted mt-1 truncate">
                    <span className="msr text-[14px]">person</span>
                    {f(t, "registered_by", "Registered By")}: {c.registered_by || "—"}
                  </div>
                </SwipePanel>
              </div>

              <button className="btn w-full !py-1.5 text-xs mt-3" onClick={() => setOpen(c)}>
                <span className="msr text-[16px]">open_in_new</span>
                {f(t, "open", "Open")}
              </button>
            </SwipeCard>
          )}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-line">
                <th className="p-2.5 font-medium">{t("client_name")}</th>
                <th className="p-2.5 font-medium">{t("client_phone")}</th>
                <th className="p-2.5 font-medium">{f(t, "last_vehicle", "Last vehicle")}</th>
                <th className="p-2.5 font-medium text-right">{f(t, "rentals", "Rentals")}</th>
                <th className="p-2.5 font-medium">{f(t, "last_rental", "Last Rental")}</th>
                <th className="p-2.5 font-medium">{f(t, "registered_by", "Registered By")}</th>
                <th className="p-2.5 font-medium text-right">{f(t, "col_actions", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((c) => (
                <tr key={c.customer_id} className="border-b border-line last:border-0">
                  <td className="p-2.5">
                    <span className="font-medium text-ink">{c.full_name}</span>
                    {(c.active_count ?? 0) > 0 && (
                      <span className="badge badge-info ml-2">{c.active_count}</span>
                    )}
                  </td>
                  <td className="p-2.5 text-muted">{c.phone || "—"}</td>
                  <td className="p-2.5 text-muted">
                    {c.last_make_model || "—"} · {c.last_plate || "—"}
                  </td>
                  <td className="p-2.5 text-right text-muted">{c.rental_count}</td>
                  <td className="p-2.5 text-muted whitespace-nowrap">{fmtDate(c.last_rental_date, lang)}</td>
                  <td className="p-2.5 text-muted">{c.registered_by || "—"}</td>
                  <td className="p-2.5">
                    <div className="flex items-center justify-end gap-1.5">
                      <button
                        className="btn !py-1.5 !px-3 text-xs"
                        onClick={() => setOpen(c)}
                        title={f(t, "open", "Open")}
                      >
                        <span className="msr text-[16px]">open_in_new</span>
                        {f(t, "open", "Open")}
                      </button>
                      {canDeleteCustomer && (
                        <button
                          className="btn btn-danger !py-1.5 !px-2 text-xs"
                          onClick={() => deleteCustomer(c)}
                          title={f(t, "delete_customer", "Delete Customer")}
                        >
                          <span className="msr text-[16px]">delete</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {paged.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="p-4 text-sm text-muted text-center">
                    {f(t, "no_customers", "No customers found.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pagination
            page={paged.page}
            pageCount={paged.pageCount}
            total={paged.total}
            onChange={paged.setPage}
            label={f(t, "customers", "customers")}
          />
        </div>
      )}

      {/* Inactive customers (no current active rental) */}
      <section className="space-y-2 border-t border-line pt-4">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <span className="msr text-[18px]">person_off</span>
          {f(t, "inactive_customers", "Inactive customers")} ({inactive.length})
        </h2>
        {inactive.length === 0 ? (
          <div className="text-sm text-muted">{f(t, "no_customers", "No customers found.")}</div>
        ) : (
          <div className="card divide-y divide-line">
            {inactive.map((c) => (
              <div key={c.customer_id} className="flex items-center gap-3 p-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium text-ink truncate">{c.full_name}</div>
                  <div className="text-xs text-muted flex items-center gap-2 flex-wrap">
                    <span className="flex items-center gap-1">
                      <span className="msr text-[13px]">call</span>
                      {c.phone || "—"}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="msr text-[13px]">event</span>
                      {fmtDate(c.last_rental_date, lang)}
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="msr text-[13px]">receipt_long</span>
                      {c.rental_count} {f(t, "rentals", "rentals")}
                    </span>
                  </div>
                </div>
                {canDeleteCustomer && (
                  <button
                    className="btn btn-danger !py-1 !px-2 text-xs shrink-0"
                    title={f(t, "delete_customer", "Delete Customer")}
                    onClick={() => deleteCustomer(c)}
                  >
                    <span className="msr text-[16px]">delete</span>
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>

      {open && (
        <Modal title={open.full_name} onClose={() => setOpen(null)} wide>
          <CustomerDialog
            customer={open}
            onClose={() => setOpen(null)}
            onChange={load}
            onInvoice={openInvoice}
          />
        </Modal>
      )}

      {invoice && (
        <Modal
          title={`${f(t, "print_invoice", "Invoice")} · ${invoice.deal_id}`}
          onClose={() => setInvoice(null)}
          wide
        >
          <InvoiceViewer req={invoice} />
        </Modal>
      )}

      {invoicePrint && <InvoicePrintModal onClose={() => setInvoicePrint(false)} />}

      {pdfReport && <CustomerReportModal mode="pdf" onClose={() => setPdfReport(false)} />}

      {csvReport && <CustomerReportModal mode="csv" onClose={() => setCsvReport(false)} />}
    </div>
  );
}
