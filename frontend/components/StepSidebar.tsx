"use client";

export interface Step {
  id: string;
  label: string;
  icon: string;
  complete: boolean;
}

/**
 * Vertical step list for multi-step forms (currently just the booking
 * dialog). Purely presentational — the parent owns which step is active and
 * whether each step counts as "complete"; every row stays clickable so users
 * can jump around freely instead of being locked into a linear wizard.
 */
export function StepSidebar({
  steps,
  activeId,
  onSelect,
}: {
  steps: Step[];
  activeId: string;
  onSelect: (id: string) => void;
}) {
  return (
    // Below `lg` this is a horizontal, scrollable strip above the form instead
    // of a 168px side rail: inside a full-bleed bottom sheet on a 375px phone,
    // a `shrink-0` 168px column left roughly 160px for the entire booking form.
    // Desktop keeps the vertical rail verbatim.
    <div
      className="flex gap-1 w-[168px] shrink-0 flex-col
                 max-lg:w-full max-lg:flex-row max-lg:overflow-x-auto max-lg:pb-1.5 no-scrollbar"
    >
      {steps.map((s) => {
        const active = s.id === activeId;
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => onSelect(s.id)}
            aria-current={active ? "step" : undefined}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[12.5px] font-medium transition-colors
              max-lg:shrink-0 max-lg:min-h-[44px] ${
              active
                ? "bg-accent text-white"
                : "text-ink active:bg-[rgba(17,24,39,0.08)] lg:hover:bg-[rgba(17,24,39,0.05)]"
            }`}
          >
            <span
              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] ${
                s.complete
                  ? "border-transparent bg-[#16a34a] text-white"
                  : active
                  ? "border-white/70 text-white"
                  : "border-line text-muted"
              }`}
            >
              {s.complete ? (
                <span className="msr text-[13px]">check</span>
              ) : (
                <span className="msr text-[13px]">{s.icon}</span>
              )}
            </span>
            <span className="truncate">{s.label}</span>
          </button>
        );
      })}
    </div>
  );
}
