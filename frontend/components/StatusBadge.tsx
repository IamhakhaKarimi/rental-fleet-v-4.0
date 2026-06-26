"use client";
import { useT } from "@/lib/i18n";

// STATUS_TOKEN (config/settings.py) — status -> design token class.
const TOKEN: Record<string, string> = {
  Available: "ok",
  Rented: "info",
  "In Garage": "warn",
  Maintenance: "warn",
  DELETED: "archived",
  Overdue: "danger",
};

// i18n keys for status labels (fall back to the raw status if the key is absent).
const LABEL_KEY: Record<string, string> = {
  Available: "status_available",
  Rented: "status_rented",
  "In Garage": "status_garage",
  Maintenance: "status_maintenance",
  DELETED: "status_deleted",
};

export function StatusBadge({ status }: { status: string }) {
  const t = useT();
  const token = TOKEN[status] || "archived";
  const key = LABEL_KEY[status];
  const label = key ? (t(key) === key ? status : t(key)) : status;
  return <span className={`badge badge-${token}`}>{label}</span>;
}
