"use client";
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { can } from "@/lib/perms";
import { formatEur } from "@/lib/money";
import { Kpi } from "@/components/Kpi";
import { Timeline } from "@/components/Timeline";
import { NightModeToggle } from "@/components/NightModeToggle";
import { Modal } from "@/components/Modal";
import { BookingDialog } from "@/components/BookingDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { VisitorHome } from "@/components/VisitorHome";
import type { FleetCounts, Vehicle } from "@/lib/types";

export default function DashboardPage() {
  const { user } = useAuth();
  const t = useT();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));
  const [counts, setCounts] = useState<FleetCounts | null>(null);
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [bookingCar, setBookingCar] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const load = () => apiGet<Vehicle[]>("/api/vehicles").then(setVehicles).catch(() => {});
  useEffect(() => {
    apiGet<FleetCounts>("/api/vehicles/counts").then(setCounts).catch(() => {});
    load();
  }, []);

  const available = vehicles.filter((v) => v.status === "Available");
  const roleLabel = user ? t(user.role_label_key) : "";
  const canBook = can(user, "create_reservation");
  const ql = q.trim().toLowerCase();
  const fleetShown = ql
    ? vehicles.filter((v) =>
        [v.vehicle_id, v.make_model, v.year, v.license_plate, v.color, v.status].some((f) =>
          String(f ?? "").toLowerCase().includes(ql)
        )
      )
    : vehicles;

  return (
    <div className="space-y-7">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold flex items-center gap-2">
            <span className="msr text-[22px]">person</span>
            {user?.full_name} — {roleLabel}
          </h1>
          <p className="text-sm text-muted mt-1">{t("dashboard_help")}</p>
        </div>
        <NightModeToggle />
      </div>

      <section className="space-y-2.5">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-muted">
          <span className="msr text-[18px]">calendar_month</span>
          {t("timeline_title")}
        </h2>
        <Timeline />
      </section>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label={t("kpi_total")} value={counts?.total ?? "—"} icon="directions_car" />
        <Kpi label={t("kpi_available")} value={counts?.available ?? "—"} icon="check_circle" accent />
        <Kpi label={t("kpi_rented")} value={counts?.rented ?? "—"} icon="vpn_key" />
        <Kpi label={t("kpi_garage")} value={counts?.garage ?? "—"} icon="build" />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold flex items-center gap-2 text-muted">
          <span className="msr text-[18px]">directions_car</span>
          {t("available_cars")} ({available.length})
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {available.map((v) => (
            <div key={v.vehicle_id} className="card p-3 space-y-2">
              <div className="h-[120px] rounded-[10px] bg-bg border border-line flex items-center justify-center text-muted">
                <span className="msr text-[34px]">directions_car</span>
              </div>
              <div className="font-semibold text-ink">
                {v.make_model}
                {v.year ? ` · ${v.year}` : ""}
              </div>
              <div className="text-xs text-muted flex items-center gap-1">
                <span className="msr text-[14px]">directions_car</span>
                {v.vehicle_id} · {v.license_plate || "—"}
              </div>
              <div className="font-bold text-accent">
                {formatEur(v.base_daily_rate)} <span className="text-xs text-muted font-normal">/ day</span>
              </div>
              {canBook && (
                <button className="btn btn-primary w-full" onClick={() => setBookingCar(v.vehicle_id)}>
                  <span className="msr text-[18px]">add</span>
                  {tf("rent", "Rent")}
                </button>
              )}
            </div>
          ))}
          {available.length === 0 && <div className="text-sm text-muted">{t("no_cars")}</div>}
        </div>
      </section>

      {/* Whole fleet */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-sm font-semibold flex items-center gap-2 text-muted">
            <span className="msr text-[18px]">directions_car</span>
            {tf("whole_fleet", "Fleet")} ({fleetShown.length})
          </h2>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("search")}
            className="!py-1.5 text-xs max-w-[220px]"
          />
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-line">
                <th className="p-2.5 font-medium">{t("col_model")}</th>
                <th className="p-2.5 font-medium">{t("col_plate")}</th>
                <th className="p-2.5 font-medium">{t("col_year")}</th>
                <th className="p-2.5 font-medium">{t("col_color")}</th>
                <th className="p-2.5 font-medium">{t("col_status")}</th>
                <th className="p-2.5 font-medium text-right">{t("col_rate")}</th>
              </tr>
            </thead>
            <tbody>
              {fleetShown.map((v) => (
                <tr key={v.vehicle_id} className="border-b border-line last:border-0">
                  <td className="p-2.5">
                    <span className="font-medium text-ink">{v.make_model}</span>
                    <span className="text-muted"> · {v.vehicle_id}</span>
                  </td>
                  <td className="p-2.5 text-muted">{v.license_plate || "—"}</td>
                  <td className="p-2.5 text-muted">{v.year || "—"}</td>
                  <td className="p-2.5 text-muted">{v.color || "—"}</td>
                  <td className="p-2.5">
                    <StatusBadge status={v.status} />
                  </td>
                  <td className="p-2.5 text-right font-medium">{formatEur(v.base_daily_rate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {bookingCar && canBook && (
        <Modal title={t("quick_register")} onClose={() => setBookingCar(null)} wide>
          <BookingDialog
            preselectVehicleId={bookingCar}
            onClose={() => setBookingCar(null)}
            onCreated={() => {
              setBookingCar(null);
              load();
            }}
 