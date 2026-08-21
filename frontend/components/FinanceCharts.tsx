"use client";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from "recharts";
import { useMoney } from "@/lib/currency";

/**
 * recharts charts for the Finance page, isolated into a client-only module.
 *
 * recharts 3.x evaluates DOM-dependent code at import time; the Finance page is
 * server-rendered for its initial HTML, so importing recharts there crashed SSR
 * (surfacing as Next's "missing required error components" loop). This module is
 * loaded exclusively via `next/dynamic(..., { ssr: false })`, so recharts is
 * never evaluated on the server.
 */

// Hardcoded hex (the SVG canvas can't read CSS vars).
const INCOME_HEX = "#1A1C1E";
const COST_HEX = "#DC2626";
const PIE_PALETTE = [
  "#1A1C1E",
  "#3F3F46",
  "#52525B",
  "#71717A",
  "#9CA3AF",
  "#B45309",
  "#0E7490",
  "#4D7C0F",
  "#7C3AED",
  "#BE185D",
];

// Recharts values arrive in euros; render them as the app's money format. This
// is a hook rather than a plain function because the format depends on the
// business display currency. Tooltips only -- the axis ticks stay bare numbers,
// a dual-currency string would not fit them.
function useChartTooltipFmt() {
  const fmt = useMoney();
  return (value: any) => fmt(Math.round(Number(value) * 100));
}

const TOOLTIP_STYLE = { borderRadius: 10, border: "1px solid #EAE8E3", fontSize: 12 } as const;

export interface BarDatum {
  period: string;
  income: number;
  cost: number;
  net: number;
}

export function IncomeCostBarChart({
  data,
  incomeLabel,
  costLabel,
  incomeColor = INCOME_HEX,
  costColor = COST_HEX,
  /** Formats the x-axis category tick (defaults to the raw "period" string). */
  xTickFormatter,
  /**
   * Draws a dashed reference line + label at the most recent period, so a
   * "current period" stands out in the bar group (Finance -> Monthly dashboard).
   */
  currentLabel,
}: {
  data: BarDatum[];
  incomeLabel: string;
  costLabel: string;
  incomeColor?: string;
  costColor?: string;
  xTickFormatter?: (period: string) => string;
  currentLabel?: string;
}) {
  const lastPeriod = data.length ? data[data.length - 1].period : undefined;
  const chartTooltipFmt = useChartTooltipFmt();
  return (
    <ResponsiveContainer width="100%" height={300}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
        <XAxis
          dataKey="period"
          tick={{ fontSize: 12 }}
          stroke="#9CA3AF"
          tickFormatter={xTickFormatter}
        />
        <YAxis tick={{ fontSize: 12 }} stroke="#9CA3AF" width={48} />
        <Tooltip formatter={chartTooltipFmt} contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        {currentLabel && lastPeriod && (
          <ReferenceLine
            x={lastPeriod}
            stroke="#9CA3AF"
            strokeDasharray="4 4"
            label={{ value: currentLabel, position: "top", fontSize: 11, fill: "#6B7280" }}
          />
        )}
        <Bar dataKey="income" name={incomeLabel} fill={incomeColor} radius={[6, 6, 0, 0]} />
        <Bar dataKey="cost" name={costLabel} fill={costColor} radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export interface PieDatum {
  name: string;
  value: number;
}

export function IncomeSharePieChart({ pie }: { pie: PieDatum[] }) {
  const chartTooltipFmt = useChartTooltipFmt();
  return (
    <ResponsiveContainer width="100%" height={300}>
      <PieChart>
        <Pie data={pie} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={false}>
          {pie.map((_, i) => (
            <Cell key={i} fill={PIE_PALETTE[i % PIE_PALETTE.length]} />
          ))}
        </Pie>
        <Tooltip formatter={chartTooltipFmt} contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: 11 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
