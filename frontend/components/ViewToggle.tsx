"use client";

export type ViewMode = "cards" | "table";

/**
 * Segmented cards/table view switch, shared by the Fleet, Reservations and
 * Customers pages. Purely presentational — the parent owns the `view` state
 * (and may persist it). The two icons mirror the classic grid/list metaphor.
 */
export function ViewToggle({
  value,
  onChange,
  cardsTitle = "Card view",
  tableTitle = "Table view",
}: {
  value: ViewMode;
  onChange: (v: ViewMode) => void;
  cardsTitle?: string;
  tableTitle?: string;
}) {
  return (
    <div className="inline-flex rounded-pill border border-line overflow-hidden shrink-0">
      <button
        type="button"
        onClick={() => onChange("cards")}
        className={`seg-btn ${value === "cards" ? "active" : "hover:bg-[rgba(17,24,39,0.05)]"}`}
        title={cardsTitle}
        aria-label={cardsTitle}
        aria-pressed={value === "cards"}
      >
        <span className="msr text-[18px]">grid_view</span>
      </button>
      <button
        type="button"
        onClick={() => onChange("table")}
        className={`seg-btn ${value === "table" ? "active" : "hover:bg-[rgba(17,24,39,0.05)]"}`}
        title={tableTitle}
        aria-label={tableTitle}
        aria-pressed={value === "table"}
      >
        <span className="msr text-[18px]">table_rows</span>
      </button>
    </div>
  );
}
