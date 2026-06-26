"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { can } from "@/lib/perms";
import { Bell } from "./Bell";
import type { BusinessInfo, NavItem } from "@/lib/types";

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

  // Collapse to the icon rail on narrow viewports (≤768px), expand on wide.
  useEffect(() => {
    const apply = () => setExpanded(window.innerWidth >= 768);
    apply();
    window.addEventListener("resize", apply);
    return () => window.removeEventListener("resize", apply);
  }, []);

  const routeFor = (k: string) => (k === "dashboard" ? "/" : `/${k}`);
  const isActive = (k: string) => pathname === routeFor(k);

  async function doLogout() {
    await logout();
    router.replace("/login");
  }

  const roleLabel = user ? t(user.role_label_key) : "";

  return (
    <aside
      className={`shrink-0 border-r border-line bg-surface/40 sticky top-0 h-screen self-start overflow-hidden flex flex-col transition-[width] duration-200 ${
        expanded ? "w-[236px]" : "w-[64px]"
      }`}
    >
      <div className="flex items-center gap-2 p-3">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="btn !p-2 !border-0 !bg-transparent"
          aria-label="Toggle menu"
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
        {nav.map((item) => {
          const active = isActive(item.key);
          return (
            <button
              key={item.key}
              onClick={() => router.push(routeFor(item.key))}
              className={`w-full flex items-center gap-3 rounded-pill px-3 py-2 text-[0.78rem] font-medium transition-colors ${
                active ? "bg-[rgba(17,24,39,0.07)] text-ink font-semibold" : "text-[#3F3F46] hover:bg-[rgba(17,24,39,0.05)]"
              } ${expanded ? "" : "justify-center"}`}
              title={t(item.label_key)}
            >
              <span className="msr text-[20px]">{item.icon}</span>
              {expanded && <span className="truncate">{t(item.label_key)}</span>}
            </button>
          );
        })}
      </nav>

      {/* Footer: notifications bell + settings + account */}
      <div className="p-2 border-t border-line space-y-1 relative">
        {can(user, "create_reservation") && <Bell expanded={expanded} />}

        <button
          onClick={() => router.push("/settings")}
          className={`w-full flex items-center gap-3 rounded-pill px-3 py-2 text-[0.78rem] font-medium ${
            isActive("settings")
              ? "bg-[rgba(17,24,39,0.07)] text-ink font-semibold"
              : "text-[#3F3F46] hover:bg-[rgba(17,24,39,0.05)]"
          } ${expanded ? "" : "justify-center"}`}
          title={t("nav_settings")}
        >
          <span className="msr text-[20px]">settings</span>
          {expanded && <span className="truncate">{t("nav_settings")}</span>}
        </button>

        <button
          onClick={() => setAcct((v) => !v)}
          className={`w-full flex items-center gap-3 rounded-pill px-3 py-2 text-[0.78rem] hover:bg-[rgba(17,24,39,0.05)] ${
            expanded ? "" : "justify-center"
          }`}
        >
          <span className="msr text-[20px]">account_circle</span>
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
              className="w-full flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm text-danger hover:bg-[rgba(220,38,38,0.08)]"
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
