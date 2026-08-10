"use client";
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { formatEur } from "@/lib/money";
import { NightModeToggle } from "@/components/NightModeToggle";
import { ContactForm } from "@/components/ContactForm";
import type { FleetCounts, Vehicle } from "@/lib/types";

interface Brand {
  business_name: string;
  initial: string;
  tagline: string;
}

// English fallback when a key isn't in the dictionary.
const f = (t: (k: string) => string, key: string, fb: string) => (t(key) === key ? fb : t(key));

/**
 * Customer-facing home for the visitor role: a bento browse board, no staff chrome
 * (no occupancy timeline, no fleet table, no KPIs, no booking). All data is
 * visitor-readable — vehicles + counts (view_fleet, level 0) and the public brand
 * header (/api/business/name). Tiles vary in size on purpose (the ink hero spans
 * 2×2, the newest car is a wide feature) so it reads as a board, not a card grid.
 */
export function VisitorHome() {
  const t = useT();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [counts, setCounts] = useState<FleetCounts | null>(null);
  const [brand, setBrand] = useState<Brand | null>(null);

  useEffect(() => {
    apiGet<Vehicle[]>("/api/vehicles").then(setVehicles).catch(() => {});
    apiGet<FleetCounts>("/api/vehicles/counts").then(setCounts).catch(() => {});
    apiGet<Brand>("/api/business/name").then(setBrand).catch(() => {});
  }, []);

  const available = vehicles.filter((v) => v.status === "Available");
  const name = brand?.business_name || "Balkan Car Rentals";
  const tagline = brand?.tagline || "";
  const [featured, ...rest] = available;

  const ink = { background: "var(--accent)", color: "var(--bg)", border: "none" } as const;
  let delay = 0;
  const stagger = () => ({ animationDelay: `${(delay++ * 45)}ms` });

  const CarTile = ({ v, wide }: { v: Vehicle; wide?: boolean }) => (
    <div
      className={`bento-in card p-4 flex transition-transform duration-200 hover:-translate-y-0.5 ${
        wide ? "col-span-2 flex-row items-center gap-4" : "flex-col"
      }`}
      style={stagger()}
    >
      <div
        className={`rounded-[10px] bg-bg border border-line flex items-center justify-center text-muted ${
          wide ? "w-[96px] h-[88px] shrink-0" : "h-[88px] mb-3"
        }`}
      >
        <span className="msr" style={{ fontSize: wide ? 40 : 30 }}>directions_car</span>
      </div>
      <div className={`min-w-0 ${wide ? "" : "flex flex-col grow"}`}>
        <div className="font-semibold text-ink truncate">
          {v.make_model}
          {v.year ? ` · ${v.year}` : ""}
        </div>
        <div className="text-xs text-muted mt-0.5 truncate">
          {v.vehicle_id} · {v.license_plate || "—"}
          {v.color ? ` · ${v.color}` : ""}
        </div>
        <div className={`${wide ? "mt-2" : "mt-auto pt-2"} font-bold text-accent ${wide ? "text-lg" : ""}`}>
          {formatEur(v.base_daily_rate)}{" "}
          <span className="text-xs text-muted font-normal">/ {f(t, "per_day", "day")}</span>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-12">
      <div className="flex justify-end">
        <NightModeToggle />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 [grid-auto-rows:minmax(150px,auto)]">
        {/* Hero — ink tile, brand + live availability */}
        <div className="bento-in card col-span-2 row-span-2 p-6 md:p-7 flex flex-col justify-between" style={{ ...ink, ...stagger() }}>
          <div>
            <div className="flex items-center gap-2 text-sm" style={{ opacity: 0.75 }}>
              <span className="msr text-[18px]">directions_car</span>
              {name}
            </div>
            <h1 className="mt-4 text-3xl md:text-4xl font-bold leading-[1.1]" style={{ textWrap: "balance" }}>
              {tagline || f(t, "visitor_hero", "Rent the right car for the road ahead.")}
            </h1>
          </div>
          <div className="flex items-end gap-2.5 mt-6">
            <span className="text-5xl font-bold leading-none" style={{ fontVariantNumeric: "tabular-nums" }}>
              {available.length}
            </span>
            <span className="text-sm pb-1" style={{ opacity: 0.8 }}>
              {f(t, "available_cars", "available now")}
            </span>
          </div>
        </div>

        {/* Two stat tiles */}
        <div className="bento-in card p-5 flex flex-col justify-center" style={stagger()}>
          <div className="text-4xl font-bold text-ink" style={{ fontVariantNumeric: "tabular-nums" }}>
            {counts?.available ?? available.length}
          </div>
          <div className="text-xs text-muted mt-1">{f(t, "available_cars", "Available now")}</div>
        </div>
        <div className="bento-in card p-5 flex flex-col justify-center" style={stagger()}>
          <div className="text-4xl font-bold text-ink" style={{ fontVariantNumeric: "tabular-nums" }}>
            {counts?.total ?? vehicles.length}
          </div>
          <div className="text-xs text-muted mt-1">{f(t, "fleet_size", "Cars in our fleet")}</div>
        </div>

        {/* Contact CTA — spans the two stat columns */}
        <div className="bento-in card col-span-2 p-5 flex items-center gap-4" style={stagger()}>
          <div className="w-11 h-11 rounded-full flex items-center justify-center shrink-0" style={ink}>
            <span className="msr text-[22px]">call</span>
          </div>
          <div className="min-w-0">
            <div className="font-semibold text-ink">{f(t, "contact_to_book", "Contact us to book")}</div>
            <div className="text-sm text-muted truncate">
              {f(t, "visitor_contact_sub", "Pick a car below and reach out — we'll get you on the road.")}
            </div>
          </div>
        </div>

        {/* Featured (newest available) car — wide tile */}
        {featured && <CarTile v={featured} wide />}

        {/* Remaining available cars */}
        {rest.map((v) => (
          <CarTile key={v.vehicle_id} v={v} />
        ))}

        {available.length === 0 && (
          <div className="bento-in card col-span-2 md:col-span-4 p-8 text-center text-muted" style={stagger()}>
            <span className="msr text-[28px] block mb-2">directions_car</span>
            {f(t, "no_cars", "No cars available right now.")}
          </div>
        )}
      </div>

      <div className="py-8 px-4 md:px-6">
        <ContactForm />
      </div>
    </div>
  );
}
