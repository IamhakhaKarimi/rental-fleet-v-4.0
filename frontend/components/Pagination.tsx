"use client";

/**
 * Prev/next + page indicator for a server-paginated table (M5). Purely
 * presentational, mirrors the icon-button style of ViewToggle/RefreshIcon.
 * Renders nothing when there's only one page, so a small dataset looks
 * exactly as it did before pagination existed.
 */
export function Pagination({
  page,
  pageCount,
  total,
  onChange,
  label,
}: {
  page: number;
  pageCount: number;
  total: number;
  onChange: (page: number) => void;
  /** e.g. "results" / "vehicles" — falls back to a bare count. */
  label?: string;
}) {
  if (pageCount <= 1) return null;

  return (
    <div className="flex items-center justify-between gap-3 pt-2 text-xs text-muted">
      <span>
        {total} {label || ""}
      </span>
      <div className="inline-flex items-center gap-1">
        <button
          type="button"
          className="btn !py-1 !px-2"
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          aria-label="Previous page"
        >
          <span className="msr text-[18px]">chevron_left</span>
        </button>
        <span className="px-2 tabular-nums">
          {page} / {pageCount}
        </span>
        <button
          type="button"
          className="btn !py-1 !px-2"
          disabled={page >= pageCount}
          onClick={() => onChange(page + 1)}
          aria-label="Next page"
        >
          <span className="msr text-[18px]">chevron_right</span>
        </button>
      </div>
    </div>
  );
}
