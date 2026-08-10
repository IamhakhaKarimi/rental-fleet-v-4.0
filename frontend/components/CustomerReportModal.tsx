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
  const [sortBy, setSortBy] = useState<SortBy>("name");
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

  // Ordered by the registry so the summary line matches the printed layout.
  const chosenCols = useMemo(
    () => columns.filter((c) => cols.has(c.key)).map((c) => c.key),
    [columns, cols]
  );

  // Checkbox layout: checked columns grouped first (filling top-to-bottom down
  // column 1, then column 2), unchecked ones trailing after — so a glance at the
  // grid shows what's in the report without hunting across three columns.
  const orderedColumns = useMemo(() => {
    const checked = columns.filter((c) => cols.has(c.key));
    const unchecked = columns.filter((c) => !cols.has(c.key));
    return [...checked, ...unchecked];
  }, [columns, cols]);
  const colRows = Math.ceil(orderedColumns.length / 3) || 1;
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
          {/* Columns */}
          <section className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className={sectionTitle}>{f(t, "report_columns", "Columns to include")}</div>
              <button
                className="btn !py-1 !px-2 text-xs shrink-0"
                onClick={() => setCols(allColsOn ? new Set() : new Set(columns.map((c) => c.key)))}
              >
                {allColsOn ? f(t, "select_none", "Select none") : f(t, "select_all", "Select all")}
              </button>
            </div>
            <div
              className="grid grid-cols-2 sm:grid-cols-3 gap-x-2 max-h-[24vh] overflow-y-auto pr-1"
              style={{ gridAutoFlow: "column", gridTemplateRows: `repeat(${colRows}, auto)` }}
            >
              {orderedColumns.map((c) => (
                <label key={c.key} className={checkRow}>
                  <input
                    type="checkbox"
                    className="w-auto"
                    checked={cols.has(c.key)}
                    onChange={() => toggleCol(c.key)}
                  />
                  <span className="truncate">{c.label}</span>
                </label>
              ))}
            </div>
            {tooWide && (
              <div className="text-xs text-danger">
                {f(
                  t,
                  "report_too_wide",
                  "That's a lot of columns for one A4 page — some cells will be shortened."
                )}
              </div>
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
