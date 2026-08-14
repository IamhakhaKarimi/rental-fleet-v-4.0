"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/** Panel widths. `wide` stays as the existing two-column size; `size` is the
 *  explicit form and wins when both are given — "full" is for dialogs that must
 *  fit on one screen without scrolling (the booking form).
 *
 *  Each keeps its original desktop value verbatim and adds `max-lg:max-w-none`:
 *  below 1024px the panel is a full-bleed bottom sheet, where any max-width just
 *  leaves dead margins down the sides. */
const SIZE_CLASS = {
  md: "max-w-md max-lg:max-w-none",
  lg: "max-w-2xl max-lg:max-w-none",
  xl: "max-w-4xl max-lg:max-w-none",
  // Sized to what the booking form's Review step actually needs (168px
  // sidebar + 200px checklist + 340px invoice preview + gaps/padding), not to
  // the viewport — 1180px left a wide dead strip beside the invoice preview.
  full: "max-w-[860px] max-lg:max-w-none",
  // The booking form's single-column steps (period / vehicle / client) don't
  // need the "full" width sized for Review's two-column layout — that just
  // left dead whitespace beside the sidebar.
  compact: "max-w-[560px] max-lg:max-w-none",
} as const;

export function Modal({
  title,
  onClose,
  children,
  wide,
  size,
  bodyClassName = "",
  fullHeight = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  size?: keyof typeof SIZE_CLASS;
  bodyClassName?: string;
  /** Panel is capped at most of the viewport height (scrolling internally
   *  past that), but otherwise sizes to its content instead of always filling
   *  the cap — a short step (e.g. Rental period) shouldn't stretch into a
   *  wall of empty space just because a later step is taller. */
  fullHeight?: boolean;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Lock background scroll so opening the modal doesn't scroll/shift the page
  // behind it; compensate for the scrollbar width to avoid a layout jump.
  useEffect(() => {
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPad = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    if (sbw > 0) document.body.style.paddingRight = `${sbw}px`;
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPad;
    };
  }, []);

  // Move focus into the dialog once the portal is in the DOM.
  useEffect(() => {
    if (mounted) panelRef.current?.focus();
  }, [mounted]);

  if (!mounted) return null;

  // Render into <body> via a portal so the overlay escapes the sidebar's sticky
  // stacking context. The bell modal lives inside the sticky <aside> (a stacking
  // context at z-index:auto); the timeline's sticky header / labels / bars carry
  // their own z-index inside the main column and would otherwise paint OVER the
  // modal, making it blend with the calendar. As a direct child of <body> the z-50
  // overlay sits above everything.
  // Below `lg` the dialog becomes a bottom sheet: docked toward the bottom
  // edge, inset by a small margin on every side rather than full-bleed, rounded
  // on all four corners. Full-bleed-with-square-corners originally read as the
  // dialog "taking over the screen" with no breathing room — this keeps the
  // bottom-sheet feel (anchored low, still close to full height for forms that
  // need the room) while leaving a visible gap to the glass edge.
  //
  // The inset lives on the OVERLAY (as padding around a bottom-aligned flex
  // item), not on the panel itself, so the panel's own `p-4`/`p-5` content
  // padding is undisturbed. Bottom padding folds in the safe-area inset so the
  // sheet clears a phone's home-indicator area instead of just the 12px gap.
  //
  // Written as `max-lg:` overrides layered on top of the ORIGINAL desktop
  // classes, rather than by moving those classes behind `lg:`. Two reasons:
  // every ≥1024px declaration stays a literal, unmodified string, and it avoids
  // the shorthand/longhand trap — `rounded-card` sets `border-radius` while
  // `rounded-t-2xl` sets the two top longhands, so with both live at `lg` the
  // winner would depend on Tailwind's internal emit order, not on our intent.
  // No prop changed, so all ~20 call sites are untouched.
  return createPortal(
    <div
      className={`fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/50 overflow-y-auto
                 max-lg:items-end max-lg:px-3 max-lg:pt-3
                 max-lg:pb-[calc(0.75rem+env(safe-area-inset-bottom))] ${
        fullHeight ? "lg:p-2" : ""
      }`}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`card bg-surface w-full ${
          SIZE_CLASS[size ?? (wide ? "lg" : "md")]
        } mt-10 mb-10 p-5 outline-none shadow-2xl
          max-lg:mt-0 max-lg:mb-0 max-lg:p-4
          max-lg:rounded-2xl
          max-lg:max-h-[85dvh] max-lg:overflow-y-auto ${
          fullHeight
            // Below `lg` this stays a max-height (shrink-to-content bottom
            // sheet, unchanged). At `lg`+ it's a fixed height — not a cap —
            // so the panel always claims the full desktop viewport (minus the
            // overlay padding + panel margin above) instead of shrinking to
            // whichever step has the least content.
            ? "flex flex-col overflow-hidden max-lg:max-h-[85dvh] lg:h-[calc(100dvh-40px)]"
            : ""
        } ${bodyClassName}`}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Grab handle — the affordance that says "this sheet drags/dismisses". */}
        <div className="lg:hidden mx-auto h-1 w-10 rounded-full bg-line mb-3 shrink-0" />
        <div className="flex items-center justify-between mb-4 shrink-0">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="btn !p-1.5 !border-0 !bg-transparent shrink-0"
            aria-label="Close"
          >
            <span className="msr text-[20px]">close</span>
          </button>
        </div>
        {fullHeight ? <div className="flex-1 min-h-0 overflow-y-auto">{children}</div> : children}
      </div>
    </div>,
    document.body
  );
}
