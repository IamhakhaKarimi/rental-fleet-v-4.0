"use client";
import { useEffect, useRef } from "react";
import Link from "next/link";
import { createPortal } from "react-dom";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { can } from "@/lib/perms";
import { isNavActive, routeFor } from "@/lib/nav";
import { Bell } from "./Bell";
import type { BusinessInfo, NavItem } from "@/lib/types";

const row =
  "w-full flex items-center gap-3 rounded-xl px-3 min-h-[52px] text-[0.95rem] font-medium active:bg-bg transition-colors";

/**
 * The phone burger sheet — everything the bottom bar has no room for: the
 * overflow nav entries (Fleet), Reminders, Settings and Logout.
 *
 * Conditionally rendered rather than CSS-hidden: it carries a portal, a scroll
 * lock and an Escape handler, none of which should exist on tablet or desktop
 * where the sidebar already shows these entries.
 *
 * z-index ladder: BottomNav 40 < this 50 = Modal 50 < date/time popovers 60.
 * The Reminders row opens a Modal that shares this z-index; it wins by DOM order
 * because its portal is appended to <body> after this one. See the note at the
 * Bell row for why the sheet stays open underneath rather than closing first.
 */
export function NavDrawer({
  open,
  onClose,
  overflow,
  biz,
}: {
  open: boolean;
  onClose: () => void;
  /** Nav entries that did not fit the bar, already permission-filtered by the API. */
  overflow: NavItem[];
  biz: BusinessInfo | null;
}) {
  const t = useT();
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const panelRef = useRef<HTMLDivElement>(null);

  // Close on navigation — the sheet's own links change the route, and without
  // this it would stay open over the page the user just asked for.
  useEffect(() => {
    if (open) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Same body-scroll-lock recipe as Modal.tsx — including the scrollbar-width
  // compensation, so opening the sheet never shifts the page behind it.
  useEffect(() => {
    if (!open) return;
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    const prevOverflow = document.body.style.overflow;
    const prevPad = document.body.style.paddingRight;
    document.body.style.overflow = "hidden";
    if (sbw > 0) document.body.style.paddingRight = `${sbw}px`;
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPad;
    };
  }, [open]);

  useEffect(() => {
    if (open) panelRef.current?.focus();
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  async function doLogout() {
    onClose();
    await logout();
    router.replace("/login");
  }

  // Same inset treatment as Modal.tsx's bottom sheet (see its comment): a small
  // margin on every side instead of full-bleed, rounded on all four corners
  // rather than just the top, so this doesn't read as swallowing the whole
  // screen. The gap lives on the SCRIM (padding around a bottom-aligned flex
  // item) so the panel's own internal `px-3 pt-3` content padding is untouched;
  // the scrim's bottom padding folds in the safe-area inset, so the panel's own
  // bottom padding no longer needs to (was `pb-[1rem+safe-area]`, now a plain
  // `pb-3` to match the top).
  return createPortal(
    <div
      className="fixed inset-0 z-50 bg-black/50 flex items-end md:hidden
                 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={t("nav_settings")}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        className="w-full bg-surface rounded-2xl shadow-2xl outline-none
                   max-h-[80dvh] overflow-y-auto px-3 pt-3 pb-3"
      >
        <div className="mx-auto h-1 w-10 rounded-full bg-line mb-3" />

        <div className="flex items-center gap-2.5 px-2 pb-3 mb-2 border-b border-line">
          <div className="w-9 h-9 rounded-[10px] bg-accent text-bg flex items-center justify-center font-bold shrink-0">
            {biz?.initial || "B"}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-ink truncate">{biz?.business_name || "Balkan"}</div>
            <div className="text-[0.6rem] tracking-[0.14em] uppercase text-muted">{biz?.tagline || "Fleet"}</div>
          </div>
        </div>

        <div className="space-y-0.5">
          {overflow.map((item) => {
            const active = isNavActive(item.key, pathname);
            return (
              <Link
                key={item.key}
                href={routeFor(item.key)}
                onClick={onClose}
                className={`${row} ${active ? "bg-bg text-ink font-semibold" : "text-ink"}`}
                aria-current={active ? "page" : undefined}
              >
                <span className="msr text-[22px] shrink-0">{item.icon}</span>
                <span className="truncate">{t(item.label_key)}</span>
              </Link>
            );
          })}

          {/* Reminders deliberately does NOT close the sheet. `Bell` owns its own
              Modal, so unmounting it here would destroy the dialog in the same
              tick it was asked to open. The Modal portals to <body> after this
              one, so at equal z-index it paints on top; dismissing it returns
              you to the sheet, the way a stacked action sheet behaves. */}
          {can(user, "create_reservation") && <Bell variant="drawer" />}

          <Link
            href="/settings"
            onClick={onClose}
            className={`${row} ${
              isNavActive("settings", pathname) ? "bg-bg text-ink font-semibold" : "text-ink"
            }`}
            aria-current={isNavActive("settings", pathname) ? "page" : undefined}
          >
            <span className="msr text-[22px] shrink-0">settings</span>
            <span className="truncate">{t("nav_settings")}</span>
          </Link>
        </div>

        <div className="border-t border-line mt-2 pt-2">
          <div className="flex items-center gap-3 px-3 py-2">
            <span className="msr text-[22px] text-muted shrink-0">account_circle</span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink truncate">{user?.full_name}</div>
              <div className="text-xs text-muted">{user ? t(user.role_label_key) : ""}</div>
            </div>
          </div>
          <button onClick={doLogout} className={`${row} text-danger active:bg-[rgba(220,38,38,0.12)]`}>
            <span className="msr text-[22px] shrink-0">logout</span>
            {t("logout")}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
