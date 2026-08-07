"use client";
import { memo, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";

// Module-level cache so remounts (list re-renders, view toggles, scrolling)
// reuse an already-fetched object URL instead of re-requesting the photo.
const thumbCache = new Map<string, string | null>();

/**
 * Lazy vehicle photo thumbnail — GET /api/vehicles/{id}/thumb (raw JPEG, 204 if
 * the vehicle has none). Fetched via the authenticated `api()` wrapper rather
 * than a plain `<img src>`: dev auth is a Bearer header (see lib/api.ts), which
 * an <img> tag can't send, so a bare URL would 401 across the dev cross-origin
 * split. Renders `fallback` until the photo resolves (or if there isn't one).
 */
export const VehicleThumb = memo(function VehicleThumb({
  vehicleId,
  className,
  fallback = null,
}: {
  vehicleId: string;
  className?: string;
  fallback?: ReactNode;
}) {
  const [src, setSrc] = useState<string | null>(() =>
    thumbCache.has(vehicleId) ? thumbCache.get(vehicleId)! : null
  );

  useEffect(() => {
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
  }, [vehicleId]);

  if (!src) return <>{fallback}</>;
  return <img src={src} alt="" className={className} />;
});
