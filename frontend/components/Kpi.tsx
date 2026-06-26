export function Kpi({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string | number;
  icon: string;
  accent?: boolean;
}) {
  return (
    <div className="kpi flex flex-col justify-between gap-3">
      <div className="flex items-center justify-between">
        <span className="kpi-label">{label}</span>
        <span className={`kpi-chip ${accent ? "accent" : ""}`} aria-hidden>
          <span className="msr text-[18px]">{icon}</span>
        </span>
      </div>
      <div className={`kpi-value ${accent ? "!text-accent" : ""}`}>{value}</div>
    </div>
  );
}
