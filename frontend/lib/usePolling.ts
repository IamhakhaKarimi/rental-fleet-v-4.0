import { useEffect, useRef, useState } from "react";

export interface UsePollingOptions {
  interval?: number; // ms between polls (default 15000)
  onError?: (error: any) => void;
}

/**
 * Hook for auto-polling an async fetch function.
 * Handles refetch on mount, at the interval, and on window focus.
 * Cleanup cancels the polling on unmount.
 *
 * Usage:
 *   const [vehicles, setVehicles] = useState([]);
 *   const { isLoading, refetch } = usePolling(
 *     () => apiGet("/api/vehicles").then(setVehicles),
 *     { interval: 15000 }
 *   );
 */
export function usePolling(
  fetchFn: () => Promise<void>,
  opts: UsePollingOptions = {}
) {
  const { interval = 15000, onError } = opts;
  const [isLoading, setIsLoading] = useState(false);
  const timeoutRef = useRef<NodeJS.Timeout>();
  const isMountedRef = useRef(true);

  // The polling loop is armed once on mount, so it would otherwise keep calling
  // the fetchFn from that first render forever. Callers whose fetchFn closes over
  // state (a search box, a filter) would then have every poll overwrite their
  // results with the initial query. Keep the latest fn in a ref and always call
  // through it so a poll uses current state.
  const fnRef = useRef(fetchFn);
  fnRef.current = fetchFn;
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const refetch = async () => {
    if (!isMountedRef.current) return;
    setIsLoading(true);
    try {
      await fnRef.current();
    } catch (e) {
      if (onErrorRef.current) onErrorRef.current(e);
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  };

  const schedule = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (!isMountedRef.current) return;
      // Skip background polls while the tab is hidden — the focus/visibility
      // listener below will catch up immediately once it's visible again.
      if (document.hidden) {
        schedule();
        return;
      }
      refetch().then(schedule);
    }, interval);
  };

  // Initial fetch + polling on mount
  useEffect(() => {
    isMountedRef.current = true;
    refetch().then(schedule);

    // Refetch when window regains focus (tab switch, alt+tab, etc) or the
    // tab becomes visible again after being backgrounded.
    const handleFocus = () => refetch();
    const handleVisibility = () => {
      if (!document.hidden) refetch();
    };
    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      isMountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  return { isLoading, refetch };
}
