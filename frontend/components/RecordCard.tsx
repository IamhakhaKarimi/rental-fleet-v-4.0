"use client";

export interface RecordField {
  label: string;
  value: React.ReactNode;
  /** Let a long value (notes, addresses) take the full row instead of a half. */
  wide?: boolean;
}

/**
 * The phone/tablet stand-in for one table row.
 *
 * Tables below `lg` are replaced by a stack of these, driven by the *same* React
 * state the `<table>` uses — the table keeps its markup behind `hidden lg:block`
 * and this list sits behind `lg:hidden`, so there is exactly one data path and
 * desktop is untouched.
 *
 * Deliberately built on the existing `.card` class (globals.css) rather than new
 * styling, so it inherits the theme tokens, night mode and any super-admin
 * recolour for free.
 *
 * Pages that already ship a card view (Fleet, Reservations, Customers via
 * SwipeDeck / ReservationCard / VehicleCard) should force *that* view below `lg`
 * instead of using this — no need for a second card design.
 */
export function RecordCard({
  title,
  subtitle,
  badge,
  fields,
  actions,
  onClick,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  /** Status pill or similar, pinned to the top-right of the header. */
  badge?: React.ReactNode;
  fields: RecordField[];
  /** Rendered in a wrapping row under a divider. Buttons should be `.btn`. */
  actions?: React.ReactNode;
  onClick?: () => void;
}) {
  const shown = fields.filter((f) => f.value !== null && f.value !== undefined && f.value !== "");

  return (
    <div
      className={`card p-4 ${onClick ? "cursor-pointer active:bg-bg" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => (e.key === "Enter" || e.key === " ") && onClick() : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold text-ink text-[0.95rem] leading-snug break-words">{title}</div>
          {subtitle ? <div className="text-sm text-muted mt-0.5 break-words">{subtitle}</div> : null}
        </div>
        {badge ? <div className="shrink-0">{badge}</div> : null}
      </div>

      {shown.length > 0 && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 mt-3.5">
          {shown.map((f, i) => (
            <div key={i} className={`min-w-0 ${f.wide ? "col-span-2" : ""}`}>
              <dt className="text-[0.72rem] uppercase tracking-wide text-muted">{f.label}</dt>
              <dd className="text-sm text-ink mt-0.5 break-words">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {actions ? (
        <div className="flex items-center gap-2 flex-wrap mt-3.5 pt-3 border-t border-line">{actions}</div>
      ) : null}
    </div>
  );
}

/** Wrapper for a stack of RecordCards — the `lg:hidden` sibling of a `<table>`. */
export function RecordCardList({ children }: { children: React.ReactNode }) {
  return <div className="space-y-3 lg:hidden">{children}</div>;
}
