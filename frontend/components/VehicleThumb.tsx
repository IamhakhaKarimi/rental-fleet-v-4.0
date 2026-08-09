"use client";
import { memo, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";

// Module-level cache so remounts (list re-renders, view toggles, scrolling)
// reuse an already-fetched object URL instead of re-requesting the photo.
const thumbCache = new Map<string, string | null>();

/**
 * Vehicle photo thumbnail.
 *
 * Preferred path: a list page calls `useVehicleThumbs()` once for every id it
 * renders (one batched request) and passes the resolved value as `src` — see
 * Fleet/Dashboard. That closes the N+1 this component used to cause on its
 * own: one `GET .../thumb` request, one threadpool slot, one DB read, PER
 * visible card (DOCUMENTATION.md §8.2 M6).
 *
 * `src` is optional so this stays usable standalone (e.g. a single detail
 * view): omitted, it falls back to its own lazy per-vehicle fetch exactly as
 * before, via the authenticated `api()` wrapper rather than a plain
 * `<img src>` (dev auth is a Bearer header, which a bare `<img>` can't send).
 */
export const VehicleThumb = memo(function VehicleThumb({
  vehicleId,
  className,
  fallback = null,
  src: providedSrc,
}: {
  vehicleId: string;
  className?: string;
  fallback?: ReactNode;
  src?: string | null;
}) {
  const batched = providedSrc !== undefined;
  const [src, setSrc] = useState<string | null>(() =>
    batched ? providedSrc! : (thumbCache.has(vehicleId) ? thumbCache.get(vehicleId)! : null)
  );

  useEffect(() => {
    if (batched) {
      setSrc(providedSrc!);
      return;
    }
    if (thumbCache.has(vehicleId)) {
      setSrc(thumbCache.get(vehicleId)!);
      return;
    }
    let active = true;

    api(`/api/vehicles/${encodeURIComponent(vehicleId)}/thumb`, { raw: true })
      .then(async (res: Response) => {
        if (!res.ok || res.status === 204) {
          thumbCache.set(vehicleId, null);
          if (active) setSrc(null);
          return;
        }
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        thumbCache.set(vehicleId, objUrl);
        if (active) setSrc(objUrl);
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, [vehicleId, batched, providedSrc]);

  if (!src) return <>{fallback}</>;
  return <img src={src} alt="" className={className} />;
});
