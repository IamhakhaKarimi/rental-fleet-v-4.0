"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiGet } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { Modal } from "./Modal";

const f = (t: (k: string) => string, key: string, fb: string) => (t(key) === key ? fb : t(key));

export interface ReportRentalLite {
  deal_id: string;
  client_name: string;
  phone: string | null;
  make_model: string;
  license_plate: string;
  start_dt: string;
  end_dt: string;
  status: string;
}

interface ReportColumn {
  key: string;
  label: string;
}

// Month key (YYYY-MM) → localized "August 2026".
export function useMonthLabel(lang: string, t: (k: string) => string) {
  return useCallback(
    (ym: string) => {
      if (!ym || ym === "—") return f(t, "no_date", "No date");
      const [y, mo] = ym.split("-").map(Number);
      return new Intl.DateTimeFormat(lang || "en", { month: "long", year: "numeric" }).format(
        new Date(y, mo - 1, 1)
      );
    },
    [lang, t]
  );
}

// What a fresh report prints: the columns a front-desk list is actually read for.
// Everything else (ID/passport, colour, times, car id, month) is opt-in.
const DEFAULT_COLUMNS = [
  "customer",
  "phone",
  "make_model",
  "plate",
  "start_date",
  "end_date",
  "days",
  "total",
];

type SortBy = "name" | "date" | "vehicle";

/**
 * Report builder for the Customers page, shared by the PDF and CSV downloads.
 *
 * Both formats pick the same two things — which COLUMNS to print and which
 * MONTHS of rentals to include (a rental belongs to the month it started in).
 * The PDF adds the options only a paginated document has: row order, a running
 * number column, and how many clients fit on an A4 page.
 */
export function CustomerReportModal({
  mode,
  onClose,
}: {
  mode: "pdf" | "csv";
  onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const toast = useToast();
  const monthLabel = useMonthLabel(lang, t);

  const [rentals, setRentals] = useState<ReportRentalLite[]>([]);
  const [columns, setColumns] = useState<ReportColumn[]>([]);
  const [months, setMonths] = useState<Set<string>>(new Set());
  const [cols, setCols] = useState<Set<string>>(new Set(DEFAULT_COLUMNS));
  // The print order, left-to-right. Drag (or the up/down buttons) rewrites it, and
  // the backend prints `columns` in exactly the order it receives them.
  const [order, setOrder] = useState<string[]>([]);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [colsOpen, setColsOpen] = useState(false);
  const [numbered, setNumbered] = useState(true);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const isPdf = mode === "pdf";

  useEffect(() => {
    Promise.all([
      apiGet<ReportRentalLite[]>("/api/reports/customers-rentals").catch(() => [] as ReportRentalLite[]),
      apiGet<ReportColumn[]>(`/api/reports/columns?lang=${encodeURIComponent(lang || "tr")}`).catch(
        () => [] as ReportColumn[]
      ),
    ])
      .then(([rows, colDefs]) => {
        setRentals(rows);
        setColumns(colDefs);
        // Opening layout: the default columns in their default order, then the
        // opt-in ones. After that the order is the user's — never re-grouped.
        const keys = colDefs.map((c) => c.key);
        setOrder([
          ...DEFAULT_COLUMNS.filter((k) => keys.includes(k)),
          ...keys.filter((k) => !DEFAULT_COLUMNS.includes(k)),
        ]);
        // Default: every month on, so the report is complete until narrowed.
        setMonths(new Set(rows.map((r) => (r.start_dt || "").slice(0, 7)).filter(Boolean)));
      })
      .finally(() => setLoading(false));
  }, [lang]);

  // Months present in the data, newest first, with how many rentals each holds.
  const monthGroups = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rentals) {
      const key = (r.start_dt || "").slice(0, 7);
      if (key) m.set(key, (m.get(key) || 0) + 1);
    }
    return Array.from(m.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [rentals]);

  const selectedCount = useMemo(
    () => rentals.filter((r) => months.has((r.start_dt || "").slice(0, 7))).length,
    [rentals, months]
  );

  const toggleIn = (set: Set<string>, apply: (s: Set<string>) => void) => (key: string) => {
    const n = new Set(set);
    if (n.has(key)) n.delete(key);
    else n.add(key);
    apply(n);
  };
  const toggleMonth = toggleIn(months, setMonths);
  const toggleCol = toggleIn(cols, setCols);

  const allMonthsOn = monthGroups.length > 0 && monthGroups.every(([ym]) => months.has(ym));
  const allColsOn = columns.length > 0 && columns.every((c) => cols.has(c.key));

  // The ticked columns in drag order — this is what gets printed, and what the
  // summary line counts.
  const chosenCols = useMemo(() => order.filter((k) => cols.has(k)), [order, cols]);

  const labelOf = useMemo(() => {
    const m = new Map(columns.map((c) => [c.key, c.label]));
    return (k: string) => m.get(k) || k;
  }, [columns]);

  // The list as rendered: every known column, in the user's order, ticked or not.
  const orderedColumns = useMemo(
    () => order.filter((k) => columns.some((c) => c.key === k)),
    [order, columns]
  );

  // Move `key` so it lands where `target` currently sits — a drop and a one-step
  // nudge are the same splice.
  const moveTo = useCallback((key: string, target: string) => {
    if (key === target) return;
    setOrder((prev) => {
      const from = prev.indexOf(key);
      const to = prev.indexOf(target);
      if (from < 0 || to < 0) return prev;
      const next = prev.slice();
      next.splice(from, 1);
      next.splice(to, 0, key);
      return next;
    });
  }, []);

  // Touch has no HTML5 drag-and-drop, and a keyboard user has no pointer at all,
  // so every reorder a drag can do is also reachable from these two buttons.
  const nudge = (key: string, delta: number) => {
    const i = orderedColumns.indexOf(key);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= orderedColumns.length) return;
    moveTo(key, orderedColumns[j]);
  };

  const resetOrder = () => {
    const keys = columns.map((c) => c.key);
    setOrder([
      ...DEFAULT_COLUMNS.filter((k) => keys.includes(k)),
      ...keys.filter((k) => !DEFAULT_COLUMNS.includes(k)),
    ]);
  };
  // Past ~10 columns an A4 portrait page starts ellipsising cells.
  const tooWide = isPdf && chosenCols.length + (numbered ? 1 : 0) > 10;

  async function download() {
    if (chosenCols.length === 0 || selectedCount === 0) return;
    setBusy(true);
    try {
      const res = (await api(isPdf ? "/api/reports/customers-table.pdf" : "/api/reports/customers.csv", {
        method: "POST",
        body: {
          months: Array.from(months),
          columns: chosenCols,
          sort_by: sortBy,
          numbered,
          page_size: pageSize,
          lang: lang || "tr",
        },
        raw: true,
      })) as Response;
      if (!res.ok) throw { key: "error" };
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = isPdf ? "customers-report.pdf" : "customers-report.csv";
      a.click();
      URL.revokeObjectURL(url);
      toast.success(f(t, "report_downloaded", "Report downloaded."));
      onClose();
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  const sortOpts: { key: SortBy; label: string }[] = [
    { key: "name", label: f(t, "sort_az", "Client name (A–Z)") },
    { key: "date", label: f(t, "sort_date", "Reservation date") },
    { key: "vehicle", label: f(t, "sort_vehicle", "Vehicle Make/Model") },
  ];

  const sectionTitle = "text-xs font-semibold text-muted";
  const checkRow =
    "flex items-center gap-2 text-sm cursor-pointer rounded-lg px-2 py-1 hover:bg-[rgba(17,24,39,0.04)]";

  return (
    <Modal
      title={isPdf ? f(t, "report_pdf", "Report (PDF)") : f(t, "report_csv", "Report (CSV)")}
      onClose={onClose}
      wide
    >
      {loading ? (
        <div className="text-sm text-muted">{f(t, "loading", "Loading…")}</div>
      ) : (
        <div className="space-y-5">
          {/* Columns — tick what to print, drag to set the left-to-right order.
              Collapsed by default: the checklist can run to a dozen rows, which
              dwarfs the months/layout sections below it on first open. */}
          <section className="space-y-2">
            <button
              type="button"
              className="flex items-center justify-between gap-2 w-full text-left"
              onClick={() => setColsOpen((v) => !v)}
              aria-expanded={colsOpen}
            >
              <div className={`${sectionTitle} flex items-center gap-1.5`}>
                <span
                  className="msr text-[16px] transition-transform"
                  style={{ transform: colsOpen ? "rotate(90deg)" : "none" }}
                  aria-hidden="true"
                >
                  chevron_right
                </span>
                {f(t, "report_columns", "Columns to include")}
              </div>
              <span className="text-xs text-muted shrink-0">
                {chosenCols.length}/{columns.length}
              </span>
            </button>
            {!colsOpen && chosenCols.length > 0 && (
              <div className="text-xs text-muted truncate pl-[22px]">
                {chosenCols.map((k) => labelOf(k)).join(" › ")}
              </div>
            )}
            {colsOpen && (
              <>
                <div className="flex items-center justify-end gap-2 shrink-0">
                  <button className="btn !py-1 !px-2 text-xs" onClick={resetOrder}>
                    {f(t, "reset_order", "Reset order")}
                  </button>
                  <button
                    className="btn !py-1 !px-2 text-xs"
                    onClick={() => setCols(allColsOn ? new Set() : new Set(columns.map((c) => c.key)))}
                  >
                    {allColsOn ? f(t, "select_none", "Select none") : f(t, "select_all", "Select all")}
                  </button>
                </div>
                <div className="text-xs text-muted">
                  {f(t, "report_drag_hint", "Drag a column to change where it prints — top of the list is the leftmost column.")}
                </div>
                <ul
                  className="space-y-1 max-h-[32vh] overflow-y-auto pr-1"
                  onDragOver={(e) => e.preventDefault()}
                >
                  {orderedColumns.map((key, i) => {
                const on = cols.has(key);
                const printedAt = chosenCols.indexOf(key);
                return (
                  <li
                    key={key}
                    draggable
                    onDragStart={(e) => {
                      setDragKey(key);
                      e.dataTransfer.effectAllowed = "move";
                      // Firefox refuses to start a drag without payload.
                      e.dataTransfer.setData("text/plain", key);
                    }}
                    onDragEnd={() => {
                      setDragKey(null);
                      setOverKey(null);
                    }}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                      if (dragKey && dragKey !== key) setOverKey(key);
                    }}
                    onDragLeave={() => setOverKey((k) => (k === key ? null : k))}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = dragKey || e.dataTransfer.getData("text/plain");
                      if (from) moveTo(from, key);
                      setDragKey(null);
                      setOverKey(null);
                    }}
                    className={`flex items-center gap-2 rounded-lg border px-2 py-1 text-sm bg-surface
                      ${overKey === key ? "border-accent" : "border-line"}
                      ${dragKey === key ? "opacity-50" : ""}`}
                  >
                    <span
                      className="msr text-[18px] text-muted cursor-grab active:cursor-grabbing select-none"
                      aria-hidden="true"
                    >
                      drag_indicator
                    </span>
                    <label className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer">
                      <input
                        type="checkbox"
                        className="w-auto"
                        checked={on}
                        onChange={() => toggleCol(key)}
                      />
                      <span className={`truncate ${on ? "" : "text-muted"}`}>{labelOf(key)}</span>
                    </label>
                    {printedAt >= 0 && (
                      <span className="text-xs text-muted shrink-0">{printedAt + 1}</span>
                    )}
                    <button
                      className="btn !py-0.5 !px-1.5 text-xs shrink-0"
                      onClick={() => nudge(key, -1)}
                      disabled={i === 0}
                      aria-label={f(t, "move_up", "Move up")}
                      title={f(t, "move_up", "Move up")}
                    >
                      <span className="msr text-[16px]">arrow_upward</span>
                    </button>
                    <button
                      className="btn !py-0.5 !px-1.5 text-xs shrink-0"
                      onClick={() => nudge(key, 1)}
                      disabled={i === orderedColumns.length - 1}
                      aria-label={f(t, "move_down", "Move down")}
                      title={f(t, "move_down", "Move down")}
                    >
                      <span className="msr text-[16px]">arrow_downward</span>
                    </button>
                  </li>
                    );
                  })}
                </ul>
                {chosenCols.length > 0 && (
                  <div className="text-xs text-muted truncate">
                    {f(t, "report_order", "Print order")}:{" "}
                    {chosenCols.map((k) => labelOf(k)).join(" › ")}
                  </div>
                )}
                {tooWide && (
                  <div className="text-xs text-danger">
                    {f(
                      t,
                      "report_too_wide",
                      "That's a lot of columns for one A4 page — some cells will be shortened."
                    )}
                  </div>
                )}
              </>
            )}
          </section>

          {/* Months */}
          <section className="space-y-2 border-t border-line pt-4">
            <div className="flex items-center justify-between gap-2">
              <div className={sectionTitle}>
                {f(t, "report_months", "Months to include (rental start)")}
              </div>
              <button
                className="btn !py-1 !px-2 text-xs shrink-0"
                onClick={() =>
                  setMonths(allMonthsOn ? new Set() : new Set(monthGroups.map(([ym]) => ym)))
                }
                disabled={monthGroups.length === 0}
              >
                {allMonthsOn ? f(t, "select_none", "Select none") : f(t, "select_all", "Select all")}
              </button>
            </div>
            {monthGroups.length === 0 ? (
              <div className="text-sm text-muted">{f(t, "no_rentals", "No rentals yet.")}</div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-2 max-h-[24vh] overflow-y-auto pr-1">
                {monthGroups.map(([ym, count]) => (
                  <label key={ym} className={checkRow}>
                    <input
                      type="checkbox"
                      className="w-auto"
                      checked={months.has(ym)}
                      onChange={() => toggleMonth(ym)}
                    />
                    <span className="truncate">
                      {monthLabel(ym)} <span className="text-muted">({count})</span>
                    </span>
                  </label>
                ))}
              </div>
            )}
          </section>

          {/* Layout — ordering, numbering, and (PDF only) rows per page */}
          <section className="space-y-2 border-t border-line pt-4">
            <div className={sectionTitle}>{f(t, "report_layout", "Order & layout")}</div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="text-xs text-muted">{f(t, "sorted_by", "Sorted by")}</div>
                {sortOpts.map((o) => (
                  <label key={o.key} className={checkRow}>
                    <input
                      type="radio"
                      name="report_sort"
                      className="w-auto"
                      checked={sortBy === o.key}
                      onChange={() => setSortBy(o.key)}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
              <div className="space-y-2">
                <label className={checkRow}>
                  <input
                    type="checkbox"
                    className="w-auto"
                    checked={numbered}
                    onChange={(e) => setNumbered(e.target.checked)}
                  />
                  {f(t, "report_numbered", "Number the rows (#)")}
                </label>
                {isPdf && (
                  <div>
                    <div className="text-xs text-muted mb-1">
                      {f(t, "rows_per_page", "Clients per page")}
                    </div>
                    <div className="flex items-center gap-2">
                      {[25, 30].map((n) => (
                        <button
                          key={n}
                          className={`btn !py-1 !px-3 text-xs ${pageSize === n ? "btn-primary" : ""}`}
                          onClick={() => setPageSize(n)}
                        >
                          {n}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>

          <div className="text-xs text-muted">
            {selectedCount} {f(t, "rentals", "rentals")} · {chosenCols.length}{" "}
            {f(t, "report_columns_short", "columns")}
            {isPdf && selectedCount > 0
              ? ` · ${Math.ceil(selectedCount / pageSize)} ${f(t, "pages", "pages")}`
              : ""}
          </div>

          <button
            className="btn btn-primary w-full"
            onClick={download}
            disabled={busy || chosenCols.length === 0 || selectedCount === 0}
          >
            <span className="msr text-[18px]">{isPdf ? "picture_as_pdf" : "download"}</span>
            {busy
              ? "…"
              : isPdf
              ? f(t, "download_pdf", "Download PDF")
              : f(t, "download_selected", "Download CSV")}
          </button>
        </div>
      )}
    </Modal>
  );
}
