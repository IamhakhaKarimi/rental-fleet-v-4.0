"use client";
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { Modal } from "./Modal";

interface NotifItem {
  deal_id: string;
  vehicle_id: string;
  make_model: string;
  client_name: string;
  phone: string;
  end_dt: string;
  hours: number;
}
interface Notifs {
  badge: number;
  overdue: NotifItem[];
  due_soon: NotifItem[];
  due_soon_hours: number;
}

const fmt = (s: string) => {
  const d = new Date(s.replace(" ", "T"));
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")} ${String(
    d.getHours()
  ).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

function Row({ item, overdue }: { item: NotifItem; overdue: boolean }) {
  const wa = item.phone.replace(/\D/g, "");
  return (
    <div className="py-2.5 border-b border-line last:border-0">
      <div className="font-medium text-ink text-sm">
        {item.client_name} — {item.vehicle_id} · {item.make_model}
      </div>
      <div className="text-xs text-muted mt-0.5">
        → {fmt(item.end_dt)} · {overdue ? `${item.hours.toFixed(0)} h overdue` : `in ${item.hours.toFixed(0)} h`}
      </div>
      {wa && (
        <div className="flex items-center gap-3 mt-1.5 text-xs">
          <span className="text-muted">{item.phone}</span>
          <a href={`https://wa.me/${wa}`} target="_blank" rel="noreferrer" className="text-info flex items-center gap-1">
            <span className="msr text-[14px]">chat</span>WhatsApp
          </a>
          <a href={`tel:${item.phone}`} className="text-info flex items-center gap-1">
            <span className="msr text-[14px]">call</span>Call
          </a>
        </div>
      )}
    </div>
  );
}

export function Bell({
  expanded,
  variant = "sidebar",
}: {
  expanded?: boolean;
  /** "drawer" is the phone burger-sheet row: always labelled, full-height tap
   *  target, no rail/collapsed state. Only the trigger's face changes — the
   *  badge/tone logic and the Modal below are shared verbatim. */
  variant?: "sidebar" | "drawer";
}) {
  const t = useT();
  const [data, setData] = useState<Notifs | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    apiGet<Notifs>("/api/notifications").then(setData).catch(() => {});
  }, []);

  const badge = data?.badge || 0;
  const overdueN = data?.overdue.length || 0;
  const dueSoonN = data?.due_soon.length || 0;
  // Colour reflects the rental situation: overdue -> alert (red); due within 24h
  // -> warning (amber). Uses the dedicated --cal-warn amber (not the monochrome
  // --warn status token) so an approaching due date actually reads as a warning.
  // Text/icon colour needs ≥4.5:1 on the light sidebar, so the warning uses the
  // darker --cal-warn-ink (the brighter --cal-warn is a fill colour for the badge).
  // Due-soon now shows a soft "faded yellow" highlight on the bell (overdue stays
  // red). The highlight + legible ink come from the theme-aware .bell-warn class.
  const toneClass = overdueN > 0 ? "bell-alert" : dueSoonN > 0 ? "bell-warn" : "";
  const badgeColor = overdueN > 0 ? "var(--danger)" : "#EAB308";
  // Badge text: white reads on red; the yellow fill takes dark ink for contrast.
  const badgeText = overdueN > 0 ? "#ffffff" : "#1a1c1e";

  const label = t("reminders") === "reminders" ? "Reminders" : t("reminders");
  const isDrawer = variant === "drawer";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className={
          isDrawer
            ? `w-full flex items-center gap-3 rounded-xl px-3 min-h-[52px] text-[0.95rem] font-medium text-ink active:bg-bg ${toneClass}`
            : `w-full flex items-center gap-3 rounded-pill px-3 py-2 min-h-[44px] text-[0.78rem] active:bg-[rgba(17,24,39,0.08)] lg:hover:bg-[rgba(17,24,39,0.05)] ${toneClass} ${
                expanded ? "" : "justify-center"
              }`
        }
        aria-label="Reminders"
        title={overdueN > 0 ? "Overdue returns" : dueSoonN > 0 ? "Returns due within 24h" : "Reminders"}
      >
        <span className="relative inline-flex shrink-0">
          <span className={`msr ${isDrawer ? "text-[22px]" : "text-[20px]"}`}>notifications</span>
          {badge > 0 && (
            <span
              style={{ background: badgeColor, color: badgeText }}
              className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full text-[11px] font-bold flex items-center justify-center ring-2 ring-surface"
            >
              {badge > 9 ? "9+" : badge}
            </span>
          )}
        </span>
        {(isDrawer || expanded) && <span>{label}</span>}
      </button>

      {open && (
        <Modal title={label} onClose={() => setOpen(false)}>
          {badge === 0 && (
            <div className="text-sm text-ok flex items-center gap-2 py-4">
              <span className="msr text-[18px]">check_circle</span>
              {t("no_reminders") === "no_reminders" ? "No reminders right now." : t("no_reminders")}
            </div>
          )}
          {!!data?.overdue.length && (
            <section className="mb-4">
              <h3 className="text-sm font-semibold text-danger flex items-center gap-1.5 mb-1">
                <span className="msr text-[18px]">error</span>
                Overdue returns ({data.overdue.length})
              </h3>
              {data.overdue.map((i) => (
                <Row key={i.deal_id} item={i} overdue />
              ))}
            </section>
          )}
          {!!data?.due_soon.length && (
            <section>
              <h3 className="text-sm font-semibold flex items-center gap-1.5 mb-1" style={{ color: "var(--bell-warn-ink)" }}>
                <span className="msr text-[18px]">schedule</span>
                Returns due within {data.due_soon_hours} h ({data.due_soon.length})
              </h3>
              {data.due_soon.map((i) => (
                <Row key={i.deal_id} item={i} overdue={false} />
              ))}
            </section>
          )}
        </Modal>
      )}
    </>
  );
}
