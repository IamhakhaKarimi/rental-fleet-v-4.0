"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiDel, apiGet, apiPut } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { can, roleLevel } from "@/lib/perms";
import { formatEur } from "@/lib/money";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
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

  const canEdit = can(user, "service_vehicle");
  const canReassign = can(user, "edit_business_settings") || can(user, "manage_users");
  const canDelete = can(user, "edit_business_settings");
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

  // Reassign
  const [dealId, setDealId] = useState("");
  const [username, setUsername] = useState("");
  const [reassignBusy, setReassignBusy] = useState(false);

  const loadRentals = useCallback(() => {
    apiGet<CustomerRental[]>(`/api/customers/${customer.customer_id}/rentals`)
      .then((rows) => {
        setRentals(rows);
        if (rows.length) setDealId((cur) => (rows.some((r) => r.deal_id === cur) ? cur : rows[0].deal_id));
      })
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
      .then((rows) => {
        setStaff(rows);
        if (rows.length) setUsername((cur) => (rows.some((u) => u.username === cur) ? cur : rows[0].username));
      })
      .catch(() => {});
  }, [canReassign]);

  // Albanian (sq) is staff-only on the invoice flag row.
  const invoiceLangs = useMemo(
    () => Object.entries(langs).filter(([code]) => code !== "sq" || canAlbanian),
    [langs, canAlbanian]
  );

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
      onChange();
    } catch (e: any) {
      setErr(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  async function reassign() {
    if (!dealId || !username) return;
    setReassignBusy(true);
    try {
      await apiPut(`/api/rentals/${dealId}/reassign`, { username });
      loadRentals();
      onChange();
      setOk(f(t, "saved", "Saved"));
    } catch (e: any) {
      alert(t(e?.key || "error"));
    } finally {
      setReassignBusy(false);
    }
  }

  async function removeCustomer() {
    if (!confirm(`${t("delete_btn")}: ${customer.full_name}?`)) return;
    try {
      await apiDel(`/api/customers/${customer.customer_id}`, { confirm: true });
      onChange();
      onClose();
    } catch (e: any) {
      alert(t(e?.key || "error"));
    }
  }

  const lbl = "text-xs text-muted";

  return (
    <div className="space-y-5">
      {/* Edit form (employer+) */}
      {canEdit && (
        <section className="space-y-3">
          <h3 className="text-sm font-semibold">{f(t, "edit_customer", "Edit Customer")}</h3>
          <label className={lbl}>
            {t("client_name")}
            <input className="uppercase-input" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className={lbl}>
              {t("client_phone")}
              <input className="uppercase-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </label>
            <label className={lbl}>
              {t("client_id")}
              <input className="uppercase-input" value={idp} onChange={(e) => setIdp(e.target.value)} />
            </label>
          </div>
          {err && <div className="text-sm text-danger">{err}</div>}
          {ok && <div className="text-sm text-ok">{ok}</div>}
          <button className="btn btn-primary" onClick={saveEdit} disabled={busy}>
            <span className="msr text-[16px]">check</span>
            {busy ? "…" : f(t, "update_btn", "Save")}
          </button>
        </section>
      )}

      {/* Rental history */}
      <section className="space-y-2">
        <h3 className="text-sm font-semibold">
          {f(t, "rental_history", "Rental History")} ({rentals.length})
        </h3>
        <div className="space-y-2">
          {rentals.map((r) => (
            <div key={r.deal_id} className="card p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium text-ink truncate">
                    {r.make_model} · {r.license_plate || "—"}
                  </div>
                  <div className="text-xs text-muted">
                    {fmtDate(r.start_dt, lang)} → {fmtDate(r.end_dt, lang)} · {r.rental_days} {t("days")}
                  </div>
                  {r.created_by_name && (
                    <div className="text-xs text-muted flex items-center gap-1 mt-0.5">
                      <span className="msr text-[13px]">person</span>
                      {r.created_by_name}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0 space-y-1">
                  <div className="font-display font-bold text-accent">{formatEur(r.total_amount)}</div>
                  <StatusBadge status={r.status} />
                </div>
              </div>
              {/* Per-language invoice flag buttons → open invoice in a Modal */}
              <div className="flex items-center gap-1 flex-wrap pt-1 border-t border-line">
                <span className="text-xs text-muted mr-1 flex items-center gap-1">
                  <span className="msr text-[15px]">receipt_long</span>
                  {f(t, "print_invoice", "Invoice")}:
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
              </div>
            </div>
          ))}
          {rentals.length === 0 && (
            <div className="text-sm text-muted">{f(t, "no_rentals", "No rentals yet.")}</div>
          )}
        </div>
      </section>

      {/* Reassign registered-by (admin+) */}
      {canReassign && rentals.length > 0 && staff.length > 0 && (
        <section className="space-y-3 border-t border-line pt-4">
          <h3 className="text-sm font-semibold">{f(t, "reassign_registered_by", "Reassign Registered By")}</h3>
          <label className={lbl}>
            {f(t, "rental", "Rental")}
            <select value={dealId} onChange={(e) => setDealId(e.target.value)}>
              {rentals.map((r) => (
                <option key={r.deal_id} value={r.deal_id}>
                  {r.make_model} · {fmtDate(r.start_dt, lang)} ({r.created_by_name || "—"})
                </option>
              ))}
            </select>
          </label>
          <label className={lbl}>
            {f(t, "registered_by", "Registered By")}
            <select value={username} onChange={(e) => setUsername(e.target.value)}>
              {staff.map((u) => (
                <option key={u.username} value={u.username}>
                  {u.full_name || u.username} ({u.username})
                </option>
              ))}
            </select>
          </label>
          <button className="btn btn-primary" onClick={reassign} disabled={reassignBusy}>
            <span className="msr text-[16px]">swap_horiz</span>
            {reassignBusy ? "…" : f(t, "apply", "Apply")}
          </button>
        </section>
      )}

      {/* Delete (super-admin) */}
      {canDelete && (
        <section className="border-t border-line pt-4">
          <button className="btn btn-danger" onClick={removeCustomer}>
            <span className="msr text-[16px]">delete</span>
            {f(t, "delete_customer", "Delete Customer")}
          </button>
        </section>
      )}
    </div>
  );
}

// Invoice viewer: embeds the rental invoice HTML in an iframe with a language
// switch + a Download-PDF button. No window.open — renders inside a Modal.
function InvoiceViewer({ req }: { req: InvoiceRequest }) {
  const { t } = useI18n();
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
      alert(t(e?.key || "error"));
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
          <iframe
            srcDoc={html}
            title="invoice"
            className="w-full rounded-md bg-white"
            style={{ height: 760, border: 0 }}
          />
        </div>
      )}
    </div>
  );
}

export default function CustomersPage() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const [rows, setRows] = useState<CustomerRow[]>([]);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<CustomerRow | null>(null);
  const [invoice, setInvoice] = useState<InvoiceRequest | null>(null);

  // Quick-find dropdown (independent search box + selected customer id).
  const [pick, setPick] = useState("");
  const [pickId, setPickId] = useState<string>("");

  const canDeleteCustomer = roleLevel(user) >= 2; // admin + super-admin

  // Single source of truth — one fetch, reused by grid + dropdown + inactive list.
  const load = useCallback(() => {
    apiGet<CustomerRow[]>(`/api/customers?q=${encodeURIComponent(q)}`)
      .then(setRows)
      .catch(() => {});
  }, [q]);
  useEffect(() => {
    load();
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
      load();
    } catch (e: any) {
      alert(t(e?.key || "error"));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="msr text-[22px]">group</span>
        <h1 className="text-xl font-bold">{t("nav_customers")}</h1>
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

      {/* Quick-find: [search input] [customer dropdown] [Edit button] */}
      <div className="flex items-end gap-2 flex-wrap">
        <label className="text-xs text-muted">
          {f(t, "quick_find", "Quick Find")}
          <input
            placeholder={t("search")}
            value={pick}
            onChange={(e) => setPick(e.target.value)}
            className="max-w-[12rem]"
          />
        </label>
        <select value={pickId} onChange={(e) => setPickId(e.target.value)} className="max-w-xs">
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

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
        {rows.map((c) => (
          <div key={c.customer_id} className="card p-4 space-y-3">
            <div className="min-w-0">
              <div className="font-semibold text-ink truncate">{c.full_name}</div>
              <div className="text-xs text-muted flex items-center gap-1 mt-0.5">
                <span className="msr text-[14px]">call</span>
                {c.phone || "—"}
              </div>
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex items-center gap-1 text-muted truncate">
                <span className="msr text-[14px]">directions_car</span>
                {c.last_make_model || "—"} · {c.last_plate || "—"}
              </div>
              <div className="flex items-center gap-1 text-muted">
                <span className="msr text-[14px]">payments</span>
                {formatEur(c.last_daily_rate)}/{f(t, "day", "day")} · {c.rental_count}
              </div>
              <div className="flex items-center gap-1 text-muted">
                <span className="msr text-[14px]">event</span>
                {f(t, "last_rental", "Last Rental")}: {fmtDate(c.last_rental_date, lang)}
              </div>
              <div className="flex items-center gap-1 text-muted truncate">
                <span className="msr text-[14px]">person</span>
                {f(t, "registered_by", "Registered By")}: {c.registered_by || "—"}
              </div>
            </div>
            <button className="btn w-full !py-1.5 text-xs" onClick={() => setOpen(c)}>
              <span className="msr text-[16px]">open_in_new</span>
              {f(t, "open", "Open")}
            </button>
          </div>
        ))}
        {rows.length === 0 && (
          <div className="text-sm text-muted">{f(t, "no_customers", "No customers found.")}</div>
        )}
      </div>

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
    </div>
  );
}
