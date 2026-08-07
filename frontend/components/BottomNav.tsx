"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { apiGet } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { isNavActive, routeFor, splitNav } from "@/lib/nav";
import { NavDrawer } from "./NavDrawer";
import type { BusinessInfo, NavItem } from "@/lib/types";

/**
 * Phone-only thumb-zone navigation (`md:hidden`) — the bottom bar plus the
 * burger sheet it opens. Above 768px the sidebar/rail takes over and this whole
 * component is display:none, so the two never overlap.
 *
 * Four primary destinations + More. `splitNav` decides the split from the
 * *server's* permission-filtered `/api/nav` payload, so a visitor who only
 * receives `dashboard` gets one slot and a More button, not four dead icons.
 */
export function BottomNav() {
  const t = useT();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));
  const pathname = usePathname();
  const [nav, setNav] = useState<NavItem[]>([]);
  const [biz, setBiz] = useState<BusinessInfo | null>(null);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    apiGet<NavItem[]>("/api/nav").then(setNav).catch(() => {});
    apiGet<BusinessInfo>("/api/business/name").then(setBiz).catch(() => {});
  }, []);

  const { primary, overflow } = splitNav(nav);

  const slot =
    "flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 min-h-[56px] px-1 " +
    "text-[0.68rem] font-medium transition-colors active:bg-bg";

  return (
    <>
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-40 flex items-stretch
                   border-t border-line bg-surface
                   pb-[env(safe-area-inset-bottom)]"
        aria-label="Primary"
      >
        {primary.map((item) => {
          const active = isNavActive(item.key, pathname);
          return (
            <Link
              key={item.key}
              href={routeFor(item.key)}
              className={`${slot} ${active ? "text-ink" : "text-muted"}`}
              aria-current={active ? "page" : undefined}
            >
              <span className={`msr text-[22px] ${active ? "" : "opacity-80"}`}>{item.icon}</span>
              <span className="truncate max-w-full">{t(item.label_key)}</span>
            </Link>
          );
        })}

        <button
          onClick={() => setDrawer(true)}
          className={`${slot} ${drawer ? "text-ink" : "text-muted"}`}
          aria-label={tf("more", "More")}
          aria-expanded={drawer}
        >
          <span className="msr text-[22px]">{drawer ? "menu_open" : "menu"}</span>
          <span className="truncate max-w-full">{tf("more", "More")}</span>
        </button>
      </nav>

      <NavDrawer open={drawer} onClose={() => setDrawer(false)} overflow={overflow} biz={biz} />
    </>
  );
}
