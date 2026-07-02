"use client";

/**
 * Root global error boundary. Next's App Router requires a global-error to render
 * uncaught errors from the root layout/segments; without it a thrown error shows
 * the cryptic "missing required error components, refreshing…" loop. It must
 * render its own <html>/<body> because it replaces the root layout.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#FAFAF9",
          color: "#1A1C1E",
          padding: "24px",
        }}
      >
        <div style={{ maxWidth: 480, textAlign: "center" }}>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#6B7280", margin: "0 0 16px" }}>
            {error?.message || "An unexpected error occurred."}
          </p>
          <button
            onClick={() => reset()}
            style={{
              fontSize: 14,
              fontWeight: 500,
              padding: "9px 16px",
              borderRadius: 10,
              border: "1px solid #1A1C1E",
              background: "#1A1C1E",
              color: "#FAFAF9",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
