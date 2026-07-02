"use client";
import { useEffect } from "react";

/**
 * Segment error boundary for the authenticated app. Catches render/runtime errors
 * in any (app) page (e.g. the Finance charts) and shows a recoverable message with
 * the real error text, instead of Next's "missing required error components" loop.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the real cause in the console for diagnosis.
    console.error(error);
  }, [error]);

  return (
    <div className="grid place-items-center py-16 px-6">
      <div className="card p-6 max-w-md text-center space-y-3">
        <div className="flex items-center justify-center gap-2 text-danger">
          <span className="msr text-[22px]">error</span>
          <h2 className="text-base font-semibold">Something went wrong</h2>
        </div>
        <p className="text-sm text-muted break-words">
          {error?.message || "An unexpected error occurred while loading this page."}
        </p>
        <div className="flex items-center justify-center gap-2 pt-1">
          <button className="btn btn-primary" onClick={() => reset()}>
            <span className="msr text-[18px]">refresh</span>
            Try again
          </button>
          <button className="btn" onClick={() => location.assign("/")}>
            <span className="msr text-[18px]">home</span>
            Dashboard
          </button>
        </div>
      </div>
    </div>
  );
}
