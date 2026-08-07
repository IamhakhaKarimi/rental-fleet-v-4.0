"use client";
import { memo, type ReactNode } from "react";
import { useT } from "@/lib/i18n";
import { StatusBadge } from "@/components/StatusBadge";

/**
 * Shared vehicle-card shell — one design used by both the Fleet page and the
 * Landing page's "Cars Available in This Window" cards, so the two never
 * drift apart. Page-specific bits (the action buttons at the bottom) are
 * passed in as `footer`; everything above it is identical between pages.
 */
export const VehicleCard = memo(function VehicleCard({
  photo,
  name,
  reference,
  status,
  price,
  footer,
}: {
  photo: ReactNode;
  name: string;
  reference: ReactNode;
  status: ReactNode;
  price: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="swipe-card h-full flex flex-col">
      <div className="veh-card-photo">{photo}</div>
      <div className="swipe-body flex-1 flex flex-col">
        <div className="veh-card-name">{name}</div>
        <div className="swipe-ref mt-1">{reference}</div>
        <div className="mt-2">{status}</div>
        <div className="mt-3">{price}</div>
        {footer && <div className="mt-3">{footer}</div>}
      </div>
    </div>
  );
});

/**
 * Single dynamic availability indicator (plain colored bullet + label —
 * merges what used to be a separate stored-status badge and a "locked/Rented"
 * badge). `locked` wins over the stored status column since it reflects an
 * active rental right now; any other status (Maintenance/Garage) falls back
 * to the existing neutral StatusBadge pill.
 */
export function AvailabilityChip({ status, locked }: { status: string; locked?: boolean }) {
  const t = useT();
  if (locked) {
    return (
      <span className="avail-chip avail-chip-alert">
        <span className="msr text-[13px]">lock</span>
        {t("status_rented") === "status_rented" ? "Rented" : t("status_rented")}
      </span>
    );
  }
  if (status === "Available") {
    return (
      <span className="avail-chip avail-chip-success">
        {t("status_available") === "status_available" ? "Available" : t("status_available")}
      </span>
    );
  }
  return <StatusBadge status={status} />;
}
