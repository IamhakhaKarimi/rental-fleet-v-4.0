"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { can } from "@/lib/perms";
import { isNavActive, routeFor } from "@/lib/nav";
import { Bell } from "./Bell";
import type { BusinessInfo, NavItem } from "@/lib/types";

/** Row face shared by every sidebar entry. `active` and `expanded` are the only
 *  things that vary, so keeping it here stops the call sites below from drifting
 *  apart. Two deliberate details:
 *
 *  - Hover is gated behind `lg:`; on a touch tablet a `:hover` state sticks after
 *    the tap, so those viewports get `active:` instead. Desktop keeps the
 *    original hover exactly.
 *  - The inactive ink stays the literal `#3F3F46` it has always been in light
 *    mode, so desktop renders unchanged, with `dark:text-muted` layered on top —
 *    that hardcoded grey is all but invisible on night mode's #232427 surface.
 */
const rowBase =
  "w-full flex items-center gap-3 rounded-pill px-3 py-2 min-h-[44px] text-[0.78rem] transition-colors";
const rowIdle =
  "text-[#3F3F46] dark:text-muted active:bg-[rgba(17,24,39,0.08)] lg:hover:bg-[rgba(17,24,39,0.05)]";

const rowClass = (active: boolean, expanded: boolean) =>
  `${rowBase} font-medium ${
    active ? "bg-[rgba(17,24,39,0.07)] text-ink font-semibold" : rowIdle
  } ${expanded ? "" : "justify-center"}`;

export function Sidebar() {
  const t = useT();
  const { user, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  const [expanded, setExpanded] = useState(true);
  const [nav, setNav] = useState<NavItem[]>([]);
  const [biz, setBiz] = useState<BusinessInfo | null>(null);
  const [acct, setAcct] = useState(false);

  useEffect(() => {
    apiGet<NavItem[]>("/api/nav").then(setNav).catch(() => {});
    apiGet<BusinessInfo>("/api/business/name").then(setBiz).catch(() => {});
  }, []);

  // Pick the *initial* face once, on mount: the labelled 236px sidebar on
  // desktop, the 64px icon rail on tablet. Deliberately not a resize listener —
  // the old one re-ran on every resize and orientation change, silently undoing
  // whatever the user had chosen with the toggle below.
  useEffect(() => {
    setExpanded(window.innerWidth >= 1024);
  }, []);

  const isActive = (k: string) => isNavActive(k, pathname);

  async function doLogout() {
    await logout();
    router.replace("/login");
  }

  const roleLabel = user ? t(user.role_label_key) : "";

  return (
    // Phone gets the bottom bar + burger sheet instead; this whole column is
    // hidden below 768px so `<main>` can use the full width.
    <aside
      className={`hidden md:flex shrink-0 border-r border-line bg-surface/40 sticky top-0 h-[100dvh] self-start overflow-hidden flex-col transition-[width] duration-200 ${
        expanded ? "w-[236px]" : "w-[64px]"
      }`}
    >
      <div className="flex items-center gap-2 p-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="btn !p-2 !border-0 !bg-transparent"
          aria-label="Toggle menu"
          aria-expanded={expanded}
        >
          <span className="msr text-[22px]">{expanded ? "menu_open" : "menu"}</span>
        </button>
        {expanded && (
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-[30px] h-[30px] rounded-[9px] bg-accent text-bg flex items-center justify-center font-bold text-sm shrink-0">
              {biz?.initial || "B"}
            </div>
            <div className="min-w-0">
              <div className="text-[0.8rem] font-bold text-ink truncate">{biz?.business_name || "Balkan"}</div>
              <div className="text-[0.55rem] tracking-[0.14em] uppercase text-muted">{biz?.tagline || "Fleet"}</div>
            </div>
          </div>
        )}
      </div>

      <nav className="flex-1 px-2 space-y-1 mt-2 overflow-y-auto">
        {nav.map((item) => (
          <Link
            key={item.key}
            href={routeFor(item.key)}
            className={rowClass(isActive(item.key), expanded)}
            title={t(item.label_key)}
            aria-current={isActive(item.key) ? "page" : undefined}
          >
            <span className="msr text-[20px] shrink-0">{item.icon}</span>
            {expanded && <span className="truncate">{t(item.label_key)}</span>}
          </Link>
        ))}
      </nav>

      {/* Footer: notifications bell + settings + account */}
      <div className="p-2 border-t border-line space-y-1 relative">
        {can(user, "create_reservation") && <Bell expanded={expanded} />}

        <Link
          href="/settings"
          className={rowClass(isActive("settings"), expanded)}
          title={t("nav_settings")}
          aria-current={isActive("settings") ? "page" : undefined}
        >
          <span className="msr text-[20px] shrink-0">settings</span>
          {expanded && <span className="truncate">{t("nav_settings")}</span>}
        </Link>

        <button
          onClick={() => setAcct((v) => !v)}
          className={`${rowBase} active:bg-[rgba(17,24,39,0.08)] lg:hover:bg-[rgba(17,24,39,0.05)] ${
            expanded ? "" : "justify-center"
          }`}
          aria-expanded={acct}
        >
          <span className="msr text-[20px] shrink-0">account_circle</span>
          {expanded && <span className="truncate text-ink">{user?.full_name}</span>}
        </button>

        {acct && (
          <div className="absolute left-2 right-2 card p-2 shadow-soft z-20 bg-surface" style={{ bottom: "3.6rem" }}>
            <div className="px-2 py-1.5">
              <div className="text-[0.9rem] font-bold text-ink truncate">{user?.full_name}</div>
              <div className="text-[0.72rem] text-muted">{roleLabel}</div>
            </div>
            <div className="border-t border-line my-1" />
            <button
              onClick={doLogout}
              className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 min-h-[44px] text-sm text-danger active:bg-[rgba(220,38,38,0.12)] lg:hover:bg-[rgba(220,38,38,0.08)]"
            >
              <span className="msr text-[18px]">logout</span>
              {t("logout")}
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
