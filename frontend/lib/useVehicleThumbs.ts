"use client";
import { useEffect, useState } from "react";
import { api } from "./api";

/**
 * Batched vehicle-thumbnail loader — GET /api/vehicles/thumbs/batch once for a
 * whole list of ids, instead of `VehicleThumb` issuing one HTTP request (one
 * threadpool slot, one DB read) per visible card. Module-level cache + in-flight
 * set are shared across every caller/remount, same pattern as VehicleThumb's own
 * cache used to be.
 */
const cache = new Map<string, string | null>(); // vehicleId -> data: URI, or null (no photo)
const inFlight = new Set<string>();

export function useVehicleThumbs(vehicleIds: string[]): Record<string, string | null> {
  const [, forceRender] = useState(0);
  const ids = vehicleIds.filter(Boolean);
  const key = ids.join(",");

  useEffect(() => {
    const missing = ids.filter((id) => !cache.has(id) && !inFlight.has(id));
    if (missing.length === 0) return;
    missing.forEach((id) => inFlight.add(id));
    let active = true;

    api<Record<string, string | null>>(
      `/api/vehicles/thumbs/batch?ids=${missing.map(encodeURIComponent).join(",")}`
    )
      .then((res) => {
        for (const id of missing) {
          const b64 = res[id];
          cache.set(id, b64 ? `data:image/jpeg;base64,${b64}` : null);
          inFlight.delete(id);
        }
        if (active) forceRender((n) => n + 1);
      })
      .catch(() => {
        missing.forEach((id) => inFlight.delete(id));
      });

    return () => {
      active = false;
    };
    // `key` (the joined id list) is the real dependency; `ids`/`missing` are
    // derived from it each render and would otherwise retrigger every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const out: Record<string, string | null> = {};
  for (const id of ids) out[id] = cache.has(id) ? (cache.get(id) as string | null) : null;
  return out;
}
