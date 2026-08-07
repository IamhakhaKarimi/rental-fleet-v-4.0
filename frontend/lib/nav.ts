import type { NavItem } from "@/lib/types";

/**
 * Route mapping for the nav keys served by `GET /api/nav`
 * (backend/api/routers/meta.py). The list is permission-filtered server-side,
 * so the client never decides *what* a user may see — only how to lay it out.
 */
export const routeFor = (key: string) => (key === "dashboard" ? "/" : `/${key}`);

export const isNavActive = (key: string, pathname: string | null) =>
  pathname === routeFor(key);

/**
 * Keys that earn a slot in the phone bottom bar. Everything else falls through
 * to the burger sheet. Four primary slots + "More" is the most a 375px bar can
 * hold at a 44px touch target without the labels colliding.
 */
const PRIMARY_KEYS = ["dashboard", "reservations", "customers", "finance"];

/**
 * Split the *server's* nav payload — never a hardcoded list. A visitor only
 * receives `dashboard`, so the bar must degrade to one item plus More rather
 * than rendering slots for pages the user cannot open.
 * API order is preserved within each group.
 */
export function splitNav(nav: NavItem[]): { primary: NavItem[]; overflow: NavItem[] } {
  return {
    primary: nav.filter((i) => PRIMARY_KEYS.includes(i.key)),
    overflow: nav.filter((i) => !PRIMARY_KEYS.includes(i.key)),
  };
}
