"use client";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
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
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center p-4 bg-black/50 overflow-y-auto"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        className={`card bg-surface w-full ${wide ? "max-w-2xl" : "max-w-md"} mt-10 mb-10 p-5 outline-none shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="btn !p-1.5 !border-0 !bg-transparent" aria-label="Close">
            <span className="msr text-[20px]">close</span>
          </button>
        </div>
        {children}
      </div>
    </div>,
    document.body
  );
}
