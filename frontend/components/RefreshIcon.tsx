"use client";

export function RefreshIcon({
  onClick,
  isLoading,
}: {
  onClick: () => void;
  isLoading: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={isLoading}
      className="p-1.5 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed transition-colors
                 max-lg:min-h-[44px] max-lg:min-w-[44px] max-lg:inline-flex max-lg:items-center max-lg:justify-center
                 active:bg-accent lg:hover:bg-accent"
      title="Refresh data"
      aria-label="Refresh data"
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className={isLoading ? "animate-spin" : ""}
      >
        <polyline points="23 4 23 10 17 10"></polyline>
        <polyline points="1 20 1 14 7 14"></polyline>
        <path d="M3.51 9a9 9 0 0 1 14.85-3.36M20.49 15a9 9 0 0 1-14.85 3.36"></path>
      </svg>
    </button>
  );
}
