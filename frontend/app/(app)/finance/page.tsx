"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { api, apiDel, apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { can, roleLevel } from "@/lib/perms";
import { formatEur } from "@/lib/money";

/* ── Response shapes (from backend/services/finance_service.py) ──────────────
   All money fields are INTEGER CENTS. */
interface Summary {
  income: number;
  cost: number;
  net: number;
  margin: number;
}
interface RevenueSummary {
  rental: number;
  penalty: number; // NB: backend key is `penalty`, not `overdue_penalty`
  damage: number;
  total: number;
}
interface CostByType {
  type: string;
  amount: number;
}
interface PnlRow {
  period: string; // "YYYY-MM" (monthly) or "YYYY" (yearly)
  income: number;
  cost: number;
  net: number;
}
interface VehicleProfit {
  vehicle_id: string;
  make_model: string;
  income: number;
  cost: number;
  net: number;
}
interface CustomerRevenue {
  customer_id: number;
  full_name: string;
  phone: string;
  revenue: number;
  damage: number;
  penalty: number;
  rentals: number;
}
interface CostRow {
  cost_id: number;
  vehicle_id: string;
  make_model: string | null;
  license_plate?: string | null;
  year?: number | null;
  type: string;
  amount: number;
  period_date: string;
  note: string | null;
}
interface ActiveVehicle {
  vehicle_id: string;
  make_model: string;
}

const COST_TYPES = [
  "insurance",
  "maintenance",
  "depreciation",
  "fuel",
  "financing",
  "registration",
  "other",
] as const;

// Charts are recharts (3.x), which crashes SSR — load them client-only so the
// server never evaluates recharts. See components/FinanceCharts.tsx.
const ChartSkeleton = () => (
  <div className="h-[300px] grid place-items-center text-sm text-muted">…</div>
);
const IncomeCostBarChart = dynamic(
  () => import("@/components/FinanceCharts").then((m) => m.IncomeCostBarChart),
  { ssr: false, loading: ChartSkeleton }
);
const IncomeSharePieChart = dynamic(
  () => import("@/components/FinanceCharts").then((m) => m.IncomeSharePieChart),
  { ssr: false, loading: ChartSkeleton }
);

const cents = (euros: number) => euros / 100;

type TabKey = "overview" | "monthly" | "yearly" | "vehicle" | "customer" | "costs";

export default function FinancePage() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const toast = useToast();
  // t() returns the key itself when missing — keep the Fleet-page fallback idiom.
  const tx = useCallback((k: string, fallback: string) => (t(k) === k ? fallback : t(k)), [t]);

  const allowed = can(user, "view_finance");

  const [tab, setTab] = useState<TabKey>("overview");
  const [summary, setSummary] = useState<Summary | null>(null);
  const [revenue, setRevenue] = useState<RevenueSummary | null>(null);
  const [costByType, setCostByType] = useState<CostByType[]>([]);
  const [monthly, setMonthly] = useState<PnlRow[]>([]);
  const [yearly, setYearly] = useState<PnlRow[]>([]);
  const [byVehicle, setByVehicle] = useState<VehicleProfit[]>([]);
  const [byCustomer, setByCustomer] = useState<CustomerRevenue[]>([]);
  const [costs, setCosts] = useState<CostRow[]>([]);
  const [activeVehicles, setActiveVehicles] = useState<ActiveVehicle[]>([]);

  const loadAll = useCallback(() => {
    if (!allowed) return;
    apiGet<Summary>("/api/finance/summary").then(setSummary).catch(() => {});
    apiGet<RevenueSummary>("/api/finance/revenue-summary").then(setRevenue).catch(() => {});
    apiGet<CostByType[]>("/api/finance/cost-by-type").then(setCostByType).catch(() => {});
    apiGet<PnlRow[]>("/api/finance/pnl/monthly").then(setMonthly).catch(() => {});
    apiGet<PnlRow[]>("/api/finance/pnl/yearly").then(setYearly).catch(() => {});
    apiGet<VehicleProfit[]>("/api/finance/profit-by-vehicle").then(setByVehicle).catch(() => {});
    apiGet<CustomerRevenue[]>("/api/finance/revenue-by-customer").then(setByCustomer).catch(() => {});
    apiGet<CostRow[]>("/api/finance/costs?limit=100").then(setCosts).catch(() => {});
    apiGet<ActiveVehicle[]>("/api/vehicles/active").then(setActiveVehicles).catch(() => {});
  }, [allowed]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  if (!allowed) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <span className="msr text-[22px]">payments</span>
          <h1 className="text-xl font-bold">{tx("nav_finance", "Finance")}</h1>
        </div>
        <div className="card p-6 text-sm text-muted">{tx("access_denied", "Access denied.")}</div>
      </div>
    );
  }

  async function downloadReport(slug: string, ext: "csv" | "pdf") {
    try {
      const res = await api(`/api/finance/report/${slug}.${ext}`, { raw: true });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${slug}.${ext}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(tx(e?.key || "error", "Could not download report."));
    }
  }

  function ReportButtons({ slug, danger }: { slug: string; danger?: boolean }) {
    return (
      <div className="flex items-center gap-2">
        <button
          className={`btn !py-1.5 !px-3 text-xs ${danger ? "text-danger" : ""}`}
          onClick={() => downloadReport(slug, "csv")}
          title={tx("download_csv", "Download CSV")}
        >
          <span className="msr text-[16px]">download</span> CSV
        </button>
        <button
          className={`btn !py-1.5 !px-3 text-xs ${danger ? "text-danger" : ""}`}
          onClick={() => downloadReport(slug, "pdf")}
          title={tx("download_pdf", "Download PDF")}
        >
          <span className="msr text-[16px]">picture_as_pdf</span> PDF
        </button>
      </div>
    );
  }

  const costLabel = (type: string) => tx(`cost_${type}`, type.charAt(0).toUpperCase() + type.slice(1));

  const tabs: { key: TabKey; label: string; icon: string }[] = [
    { key: "overview", label: tx("fin_tab_overview", "Overview"), icon: "donut_small" },
    { key: "monthly", label: tx("fin_tab_monthly", "Monthly"), icon: "calendar_month" },
    { key: "yearly", label: tx("fin_tab_yearly", "Yearly"), icon: "calendar_today" },
    { key: "vehicle", label: tx("fin_tab_vehicle", "By Vehicle"), icon: "directions_car" },
    { key: "customer", label: tx("fin_tab_customer", "By Customer"), icon: "group" },
    { key: "costs", label: tx("fin_tab_costs", "Costs"), icon: "payments" },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="msr text-[22px]">payments</span>
        <h1 className="text-xl font-bold">{tx("nav_finance", "Finance")}</h1>
      </div>

      {/* Headline finance figures — bento board (mirrors the dashboard's
          "Fleet at a glance" board so the two pages share one visual language). */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 [grid-auto-rows:minmax(116px,auto)]">
        {/* Hero — net profit + margin bar */}
        <div
          className="bento-in card col-span-2 row-span-2 p-6 flex flex-col justify-between"
          style={{ background: "var(--accent)", color: "var(--bg)", border: "none" }}
        >
          <div className="flex items-center gap-2 text-sm" style={{ opacity: 0.75 }}>
            <span className="msr text-[18px]">account_balance</span>
            {tx("net_profit", "Net Profit")}
          </div>
          <div>
            <div className="text-4xl font-bold leading-none" style={{ fontVariantNumeric: "tabular-nums" }}>
              {formatEur(summary?.net ?? 0)}
            </div>
            <div
              className="mt-4 h-2 rounded-full overflow-hidden"
              style={{ background: "rgba(255,255,255,0.25)" }}
            >
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{
                  width: `${Math.max(0, Math.min(100, summary?.margin ?? 0))}%`,
                  background: "var(--bg)",
                }}
              />
            </div>
            <div className="text-xs mt-1.5" style={{ opacity: 0.8 }}>
              {summary?.margin ?? 0}% {tx("profit_margin", "margin")}
            </div>
          </div>
        </div>

        {/* Revenue */}
        <div className="bento-in card p-5 flex flex-col justify-center" style={{ animationDelay: "45ms" }}>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <span className="msr text-[16px]">trending_up</span>
            {tx("total_revenue", "Total Revenue")}
          </div>
          <div className="text-2xl font-bold text-accent mt-1" style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatEur(summary?.income ?? 0)}
          </div>
        </div>

        {/* Cost */}
        <div className="bento-in card p-5 flex flex-col justify-center" style={{ animationDelay: "90ms" }}>
          <div className="flex items-center gap-1.5 text-xs text-muted">
            <span className="msr text-[16px]">trending_down</span>
            {tx("col_cost", "Total Cost")}
          </div>
          <div className="text-2xl font-bold text-ink mt-1" style={{ fontVariantNumeric: "tabular-nums" }}>
            {formatEur(summary?.cost ?? 0)}
          </div>
        </div>

        {/* Revenue mix — wide strip (rental / penalty / damage) */}
        <div
          className="bento-in card col-span-2 p-5 flex items-center justify-between gap-2"
          style={{ animationDelay: "135ms" }}
        >
          {[
            { k: "rental_revenue", fb: "Rental", v: revenue?.rental ?? 0, icon: "vpn_key" },
            { k: "penalty_revenue", fb: "Penalty", v: revenue?.penalty ?? 0, icon: "gavel" },
            { k: "damage_revenue", fb: "Damage", v: revenue?.damage ?? 0, icon: "report" },
          ].map((it) => (
            <div key={it.k} className="min-w-0 flex-1">
              <div className="flex items-center gap-1 text-[11px] text-muted truncate">
                <span className="msr text-[14px]">{it.icon}</span>
                {tx(it.k, it.fb)}
              </div>
              <div
                className="text-base font-bold text-ink truncate"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatEur(it.v)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tab menu — bento pill bar */}
      <div
        className="bento-in card p-1.5 flex items-center gap-1 flex-wrap"
        style={{ animationDelay: "180ms" }}
      >
        {tabs.map((tb) => (
          <button
            key={tb.key}
            onClick={() => setTab(tb.key)}
            className={`seg-btn rounded-lg flex items-center gap-1.5 ${tab === tb.key ? "active" : ""}`}
          >
            <span className="msr text-[16px]">{tb.icon}</span>
            {tb.label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <OverviewTab
          revenue={revenue}
          costByType={costByType}
          costLabel={costLabel}
          tx={tx}
          reportButtons={<ReportButtons slug="overview" />}
        />
      )}
      {tab === "monthly" && (
        <MonthlyDashboard
          rows={monthly}
          tx={tx}
          lang={lang}
          userName={user?.full_name || ""}
          reportButtons={<ReportButtons slug="monthly" />}
        />
      )}
      {tab === "yearly" && (
        <PnlTab rows={yearly} tx={tx} reportButtons={<ReportButtons slug="yearly" />} />
      )}
      {tab === "vehicle" && (
        <VehicleTab rows={byVehicle} tx={tx} reportButtons={<ReportButtons slug="by_vehicle" />} />
      )}
      {tab === "customer" && (
        <CustomerTab rows={byCustomer} tx={tx} reportButtons={<ReportButtons slug="by_customer" />} />
      )}
      {tab === "costs" && (
        <CostsTab
          rows={costs}
          vehicles={activeVehicles}
          costLabel={costLabel}
          tx={tx}
          onChanged={loadAll}
          reportButtons={<ReportButtons slug="expenses" danger />}
        />
      )}

      {/* Reset finance (super-admin) */}
      {roleLevel(user) >= 3 && <ResetFinance tx={tx} onDone={loadAll} />}
    </div>
  );
}

/* ── Shared UI bits ─────────────────────────────────────────────────────────── */
function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th
      className={`text-xs font-semibold uppercase tracking-wide text-muted py-2 px-3 ${
        right ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}
function Td({ children, right, bold }: { children: React.ReactNode; right?: boolean; bold?: boolean }) {
  return (
    <td className={`py-2 px-3 text-sm ${right ? "text-right" : ""} ${bold ? "font-semibold" : ""}`}>
      {children}
    </td>
  );
}
function EmptyRow({ cols, label }: { cols: number; label: string }) {
  return (
    <tr>
      <td colSpan={cols} className="py-6 px-3 text-center text-sm text-muted">
        {label}
      </td>
    </tr>
  );
}
/* ── Overview ───────────────────────────────────────────────────────────────── */
function OverviewTab({
  revenue,
  costByType,
  costLabel,
  tx,
  reportButtons,
}: {
  revenue: RevenueSummary | null;
  costByType: CostByType[];
  costLabel: (t: string) => string;
  tx: (k: string, f: string) => string;
  reportButtons: React.ReactNode;
}) {
  const totalCost = costByType.reduce((s, r) => s + (r.amount || 0), 0);
  return (
    <div className="space-y-4">
    <div className="flex justify-end">{reportButtons}</div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Revenue breakdown */}
      <div className="card p-5 space-y-3">
        <h2 className="text-base font-semibold">{tx("finance_title", "Revenue")}</h2>
        <table className="w-full">
          <tbody>
            <tr className="border-b border-line">
              <Td>{tx("rental_revenue", "Rental")}</Td>
              <Td right bold>
                {formatEur(revenue?.rental ?? 0)}
              </Td>
            </tr>
            <tr className="border-b border-line">
              <Td>{tx("penalty_revenue", "Overdue Penalty")}</Td>
              <Td right bold>
                {formatEur(revenue?.penalty ?? 0)}
              </Td>
            </tr>
            <tr className="border-b border-line">
              <Td>{tx("damage_revenue", "Damage")}</Td>
              <Td right bold>
                {formatEur(revenue?.damage ?? 0)}
              </Td>
            </tr>
            <tr>
              <Td bold>{tx("fin_totals", "Total")}</Td>
              <Td right bold>
                {formatEur(revenue?.total ?? 0)}
              </Td>
            </tr>
          </tbody>
        </table>
      </div>

      {/* Cost by type */}
      <div className="card p-5 space-y-3">
        <h2 className="text-base font-semibold">{tx("cost_breakdown", "Cost by Type")}</h2>
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <Th>{tx("col_type", "Type")}</Th>
              <Th right>{tx("col_cost", "Cost")}</Th>
            </tr>
          </thead>
          <tbody>
            {costByType.length === 0 && <EmptyRow cols={2} label={tx("no_data", "No data yet.")} />}
            {costByType.map((r) => (
              <tr key={r.type} className="border-b border-line last:border-0">
                <Td>{costLabel(r.type)}</Td>
                <Td right>{formatEur(r.amount)}</Td>
              </tr>
            ))}
            {costByType.length > 0 && (
              <tr>
                <Td bold>{tx("fin_totals", "Total")}</Td>
                <Td right bold>
                  {formatEur(totalCost)}
                </Td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  );
}

/* ── Shared P&L totals + table (Monthly dashboard and the Yearly tab both use
   this table below their respective chart) ─────────────────────────────────── */
function pnlTotals(rows: PnlRow[]) {
  return rows.reduce(
    (a, r) => ({ income: a.income + r.income, cost: a.cost + r.cost, net: a.net + r.net }),
    { income: 0, cost: 0, net: 0 }
  );
}

function PnlTable({
  rows,
  tx,
  periodLabel,
}: {
  rows: PnlRow[];
  tx: (k: string, f: string) => string;
  periodLabel: string;
}) {
  const totals = useMemo(() => pnlTotals(rows), [rows]);
  return (
    <div className="card p-5 overflow-x-auto">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line">
            <Th>{periodLabel}</Th>
            <Th right>{tx("col_income", "Income")}</Th>
            <Th right>{tx("col_cost", "Cost")}</Th>
            <Th right>{tx("col_net", "Net")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow cols={4} label={tx("no_data", "No data yet.")} />}
          {rows.map((r) => (
            <tr key={r.period} className="border-b border-line last:border-0">
              <Td>{r.period}</Td>
              <Td right>{formatEur(r.income)}</Td>
              <Td right>{formatEur(r.cost)}</Td>
              <Td right bold>
                <span className={r.net >= 0 ? "text-accent" : "text-danger"}>{formatEur(r.net)}</span>
              </Td>
            </tr>
          ))}
          {rows.length > 0 && (
            <tr className="border-t-2 border-line">
              <Td bold>{tx("fin_totals", "Total")}</Td>
              <Td right bold>
                {formatEur(totals.income)}
              </Td>
              <Td right bold>
                {formatEur(totals.cost)}
              </Td>
              <Td right bold>
                <span className={totals.net >= 0 ? "text-accent" : "text-danger"}>
                  {formatEur(totals.net)}
                </span>
              </Td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/* ── Yearly P&L ──────────────────────────────────────────────────────────────── */
function PnlTab({
  rows,
  tx,
  reportButtons,
}: {
  rows: PnlRow[];
  tx: (k: string, f: string) => string;
  reportButtons: React.ReactNode;
}) {
  const data = useMemo(
    () =>
      rows.map((r) => ({
        period: r.period,
        income: cents(r.income),
        cost: cents(r.cost),
        net: r.net,
      })),
    [rows]
  );

  return (
    <div className="space-y-4">
      <div className="card p-5">
        <div className="flex items-center justify-between gap-2 mb-4">
          <h2 className="text-base font-semibold">
            {tx("fin_tab_yearly", "Yearly")} · {tx("col_income", "Income")} / {tx("col_cost", "Cost")}
          </h2>
          {reportButtons}
        </div>
        {data.length === 0 ? (
          <div className="text-sm text-muted py-6 text-center">{tx("no_data", "No data yet.")}</div>
        ) : (
          <IncomeCostBarChart
            data={data}
            incomeLabel={tx("col_income", "Income")}
            costLabel={tx("col_cost", "Cost")}
          />
        )}
      </div>

      <PnlTable rows={rows} tx={tx} periodLabel={tx("col_year", "Year")} />
    </div>
  );
}

/* ── Monthly dashboard (fintech-style: greeting, pastel KPI cards with trend
   badges, "Report Statistic" chart card) ────────────────────────────────────── */
function trendOf(rows: PnlRow[], key: "income" | "cost" | "net"): { pct: number; up: boolean } | null {
  if (rows.length < 2) return null;
  const cur = rows[rows.length - 1][key];
  const prev = rows[rows.length - 2][key];
  if (!prev) return null;
  const pct = Math.round(((cur - prev) / Math.abs(prev)) * 100);
  return { pct, up: pct >= 0 };
}

function TrendBadge({
  trend,
  goodDirectionUp,
}: {
  trend: { pct: number; up: boolean } | null;
  /** Whether an increase is the desirable direction (income/net: yes; cost: no). */
  goodDirectionUp: boolean;
}) {
  if (!trend) return null;
  const good = goodDirectionUp ? trend.up : !trend.up;
  return (
    <span className={`fin-trend ${good ? "fin-trend-up" : "fin-trend-down"}`}>
      <span className="msr text-[13px]">{trend.up ? "trending_up" : "trending_down"}</span>
      {Math.abs(trend.pct)}%
    </span>
  );
}

// Tone -> CSS-var colours, applied inline (see the note on .fin-stat in
// globals.css for why these aren't plain `fin-stat-purple`-style classes).
const STAT_TONE = {
  purple: { bg: "var(--fin-purple-bg)", ink: "var(--fin-purple-ink)" },
  pink: { bg: "var(--fin-pink-bg)", ink: "var(--fin-pink-ink)" },
  blue: { bg: "var(--fin-blue-bg)", ink: "var(--fin-blue-ink)" },
} as const;

function StatCard({
  tone,
  icon,
  label,
  value,
  trend,
  goodDirectionUp,
}: {
  tone: keyof typeof STAT_TONE;
  icon: string;
  label: string;
  value: string;
  trend: { pct: number; up: boolean } | null;
  goodDirectionUp: boolean;
}) {
  const { bg, ink } = STAT_TONE[tone];
  return (
    <div className="fin-stat" style={{ background: bg }}>
      <div className="fin-stat-top">
        <span className="fin-stat-icon" style={{ color: ink }}>
          <span className="msr text-[20px]">{icon}</span>
        </span>
        <TrendBadge trend={trend} goodDirectionUp={goodDirectionUp} />
      </div>
      <div>
        <div className="fin-stat-label">{label}</div>
        <div className="fin-stat-value">{value}</div>
      </div>
    </div>
  );
}

function MonthlyDashboard({
  rows,
  tx,
  lang,
  userName,
  reportButtons,
}: {
  rows: PnlRow[];
  tx: (k: string, f: string) => string;
  lang: string;
  userName: string;
  reportButtons: React.ReactNode;
}) {
  const data = useMemo(
    () =>
      rows.map((r) => ({
        period: r.period,
        income: cents(r.income),
        cost: cents(r.cost),
        net: r.net,
      })),
    [rows]
  );
  const totals = useMemo(() => pnlTotals(rows), [rows]);

  // "YYYY-MM" -> a short localized month label ("Jul") for the bar chart's x-axis —
  // the reference design used weekday labels, but the app only has monthly
  // granularity, so short month names are the honest equivalent at this zoom level.
  const monthShort = useCallback(
    (period: string) => {
      const [y, m] = period.split("-").map(Number);
      if (!y || !m) return period;
      return new Intl.DateTimeFormat(lang || "en", { month: "short" }).format(new Date(y, m - 1, 1));
    },
    [lang]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="fin-greeting">
          <span className="msr text-[20px]">waving_hand</span>
          {tx("fin_greeting", "Hello")}
          {userName ? `, ${userName}` : ""}
        </div>
        {reportButtons}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          tone="purple"
          icon="account_balance_wallet"
          label={tx("col_income", "Income")}
          value={formatEur(totals.income)}
          trend={trendOf(rows, "income")}
          goodDirectionUp
        />
        <StatCard
          tone="pink"
          icon="credit_card"
          label={tx("col_cost", "Cost")}
          value={formatEur(totals.cost)}
          trend={trendOf(rows, "cost")}
          goodDirectionUp={false}
        />
        <StatCard
          tone="blue"
          icon="account_balance"
          label={tx("col_net", "Net")}
          value={formatEur(totals.net)}
          trend={trendOf(rows, "net")}
          goodDirectionUp
        />
      </div>

      <div className="card p-5">
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <h2 className="text-base font-semibold">{tx("fin_report_statistic", "Report Statistic")}</h2>
          <div className="flex items-center gap-4 flex-wrap">
            <div className="flex items-center gap-3 text-xs text-muted">
              <span className="flex items-center gap-1.5">
                <span className="fin-legend-dot" style={{ background: "var(--fin-chart-income)" }} />
                {tx("col_income", "Income")}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="fin-legend-dot" style={{ background: "var(--fin-chart-cost)" }} />
                {tx("col_cost", "Cost")}
              </span>
            </div>
            <span className="fin-period-pill">
              <span className="msr text-[15px]">calendar_month</span>
              {tx("fin_tab_monthly", "Monthly")}
            </span>
          </div>
        </div>
        {data.length === 0 ? (
          <div className="text-sm text-muted py-6 text-center">{tx("no_data", "No data yet.")}</div>
        ) : (
          <IncomeCostBarChart
            data={data}
            incomeLabel={tx("col_income", "Income")}
            costLabel={tx("col_cost", "Cost")}
            incomeColor="var(--fin-chart-income)"
            costColor="var(--fin-chart-cost)"
            xTickFormatter={monthShort}
            currentLabel={tx("fin_current_period", "Current")}
          />
        )}
      </div>

      <PnlTable rows={rows} tx={tx} periodLabel={tx("col_period", "Period")} />
    </div>
  );
}

/* ── By vehicle (pie of income share + table) ───────────────────────────────── */
function VehicleTab({
  rows,
  tx,
  reportButtons,
}: {
  rows: VehicleProfit[];
  tx: (k: string, f: string) => string;
  reportButtons: React.ReactNode;
}) {
  const pie = useMemo(
    () =>
      rows
        .filter((r) => (r.income || 0) > 0)
        .map((r) => ({ name: r.make_model || r.vehicle_id, value: cents(r.income) })),
    [rows]
  );
  return (
    <div className="space-y-4">
    <div className="flex justify-end">{reportButtons}</div>
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div className="card p-5">
        <h2 className="text-base font-semibold mb-2">{tx("by_vehicle_profit", "Income Share by Vehicle")}</h2>
        {pie.length === 0 ? (
          <div className="text-sm text-muted py-6 text-center">{tx("no_data", "No data yet.")}</div>
        ) : (
          <IncomeSharePieChart pie={pie} />
        )}
      </div>

      <div className="card p-5 overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <Th>{tx("col_car", "Vehicle")}</Th>
              <Th right>{tx("col_income", "Income")}</Th>
              <Th right>{tx("col_cost", "Cost")}</Th>
              <Th right>{tx("col_net", "Net")}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow cols={4} label={tx("no_data", "No data yet.")} />}
            {rows.map((r) => (
              <tr key={r.vehicle_id} className="border-b border-line last:border-0">
                <Td>
                  <span className="font-medium">{r.make_model || "—"}</span>
                  <span className="text-xs text-muted ml-1">{r.vehicle_id}</span>
                </Td>
                <Td right>{formatEur(r.income)}</Td>
                <Td right>{formatEur(r.cost)}</Td>
                <Td right bold>
                  <span className={r.net >= 0 ? "text-accent" : "text-danger"}>{formatEur(r.net)}</span>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    </div>
  );
}

/* ── By customer (table) ────────────────────────────────────────────────────── */
function CustomerTab({
  rows,
  tx,
  reportButtons,
}: {
  rows: CustomerRevenue[];
  tx: (k: string, f: string) => string;
  reportButtons: React.ReactNode;
}) {
  return (
    <div className="card p-5 overflow-x-auto">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="text-base font-semibold">{tx("by_customer_revenue", "Revenue by Customer")}</h2>
        {reportButtons}
      </div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-line">
            <Th>{tx("col_customer", "Customer")}</Th>
            <Th>{tx("col_phone", "Phone")}</Th>
            <Th right>{tx("col_rentals", "Rentals")}</Th>
            <Th right>{tx("damage_revenue", "Damage")}</Th>
            <Th right>{tx("penalty_revenue", "Penalty")}</Th>
            <Th right>{tx("total_revenue", "Revenue")}</Th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && <EmptyRow cols={6} label={tx("no_data", "No data yet.")} />}
          {rows.map((r) => (
            <tr key={r.customer_id} className="border-b border-line last:border-0">
              <Td bold>{r.full_name}</Td>
              <Td>{r.phone || "—"}</Td>
              <Td right>{r.rentals}</Td>
              <Td right>{formatEur(r.damage)}</Td>
              <Td right>{formatEur(r.penalty)}</Td>
              <Td right bold>
                {formatEur(r.revenue)}
              </Td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ── Costs (add form + recent costs with delete) ────────────────────────────── */
function CostsTab({
  rows,
  vehicles,
  costLabel,
  tx,
  onChanged,
  reportButtons,
}: {
  rows: CostRow[];
  vehicles: ActiveVehicle[];
  costLabel: (t: string) => string;
  tx: (k: string, f: string) => string;
  onChanged: () => void;
  reportButtons: React.ReactNode;
}) {
  const toast = useToast();
  const today = new Date().toISOString().slice(0, 10);
  const [vehicleId, setVehicleId] = useState("");
  const [costType, setCostType] = useState<string>("maintenance");
  const [amount, setAmount] = useState<number>(0);
  const [date, setDate] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  // Default the vehicle select once the active list arrives.
  useEffect(() => {
    if (!vehicleId && vehicles.length) setVehicleId(vehicles[0].vehicle_id);
  }, [vehicles, vehicleId]);

  async function submit() {
    if (!vehicleId || !(amount > 0)) {
      setErr(tx("fields_required", "All fields are required."));
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await apiPost("/api/finance/costs", {
        vehicle_id: vehicleId,
        cost_type: costType,
        amount_euros: amount,
        period_date: date,
        note,
      });
      setAmount(0);
      setNote("");
      onChanged();
    } catch (e: any) {
      setErr(tx(e?.key || "error", "Could not save cost."));
    } finally {
      setBusy(false);
    }
  }

  async function del(c: CostRow) {
    if (!confirm(`${tx("delete_btn", "Delete")}? ${costLabel(c.type)} · ${formatEur(c.amount)}`)) return;
    try {
      await apiDel(`/api/finance/costs/${c.cost_id}`);
      onChanged();
    } catch (e: any) {
      toast.error(tx(e?.key || "error", "Could not delete."));
    }
  }

  return (
    <div className="space-y-4">
      {/* Add cost form */}
      <div className="card p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold">{tx("add_cost_section", "Add Vehicle Cost")}</h2>
          {reportButtons}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="text-xs text-muted">
            {tx("col_car", "Vehicle")}
            <select value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
              {vehicles.length === 0 && <option value="">—</option>}
              {vehicles.map((v) => (
                <option key={v.vehicle_id} value={v.vehicle_id}>
                  {v.make_model} ({v.vehicle_id})
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            {tx("cost_type", "Cost Type")}
            <select value={costType} onChange={(e) => setCostType(e.target.value)}>
              {COST_TYPES.map((ct) => (
                <option key={ct} value={ct}>
                  {costLabel(ct)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            {tx("cost_amount", "Amount")} (€)
            <input
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(+e.target.value)}
            />
          </label>
          <label className="text-xs text-muted">
            {tx("cost_date", "Date")}
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="text-xs text-muted sm:col-span-2">
            {tx("cost_note", "Note")}
            <input value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        {err && <div className="text-sm text-danger">{err}</div>}
        <button className="btn btn-primary" onClick={submit} disabled={busy}>
          <span className="msr text-[18px]">add</span>
          {busy ? "…" : tx("add_cost_btn", "Add Cost")}
        </button>
      </div>

      {/* Recent costs */}
      <div className="card p-5 overflow-x-auto">
        <h2 className="text-base font-semibold mb-3">{tx("finance_records_section", "Recent Costs")}</h2>
        <table className="w-full">
          <thead>
            <tr className="border-b border-line">
              <Th>{tx("cost_date", "Date")}</Th>
              <Th>{tx("col_car", "Vehicle")}</Th>
              <Th>{tx("col_type", "Type")}</Th>
              <Th>{tx("cost_note", "Note")}</Th>
              <Th right>{tx("cost_amount", "Amount")}</Th>
              <Th right>{tx("col_actions", "Actions")}</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow cols={6} label={tx("no_data", "No data yet.")} />}
            {rows.map((c) => (
              <tr key={c.cost_id} className="border-b border-line last:border-0">
                <Td>{c.period_date}</Td>
                <Td>
                  <span className="font-medium">{c.make_model || "—"}</span>
                  <span className="text-xs text-muted ml-1">{c.vehicle_id}</span>
                </Td>
                <Td>{costLabel(c.type)}</Td>
                <Td>{c.note || "—"}</Td>
                <Td right bold>
                  {formatEur(c.amount)}
                </Td>
                <Td right>
                  <button className="btn btn-danger !py-1.5 !px-2.5 text-xs" onClick={() => del(c)}>
                    <span className="msr text-[16px]">delete</span>
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ── Reset finance (super-admin) ────────────────────────────────────────────── */
function ResetFinance({ tx, onDone }: { tx: (k: string, f: string) => string; onDone: () => void }) {
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");

  async function reset() {
    if (confirm.trim().toUpperCase() !== "RESET") return;
    setBusy(true);
    setMsg("");
    try {
      await apiPost("/api/finance/reset", { confirm: "RESET" });
      setConfirm("");
      setMsg(tx("reset_done", "Data has been reset."));
      onDone();
    } catch (e: any) {
      setMsg(tx(e?.key || "error", "Reset failed."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5 border-danger/40 space-y-3">
      <div className="flex items-center gap-2">
        <span className="msr text-[20px] text-danger">warning</span>
        <h2 className="text-base font-semibold text-danger">{tx("reset_finance_btn", "Reset Finance Data")}</h2>
      </div>
      <p className="text-xs text-muted max-w-prose">
        {tx(
          "reset_finance_help",
          "Deletes all income (charges) and cost records. Vehicles and rentals are kept."
        )}
      </p>
      <div className="flex items-end gap-2 flex-wrap">
        <label className="text-xs text-muted">
          {tx("reset_confirm_label", "Type RESET to confirm")}
          <input value={confirm} onChange={(e) => setConfirm(e.target.value)} className="max-w-xs" />
        </label>
        <button
          className="btn btn-danger"
          onClick={reset}
          disabled={busy || confirm.trim().toUpperCase() !== "RESET"}
        >
          <span className="msr text-[18px]">delete_forever</span>
          {busy ? "…" : tx("reset_finance_btn", "Reset Finance Data")}
        </button>
      </div>
      {msg && <div className="text-sm text-muted">{msg}</div>}
    </div>
  );
}
