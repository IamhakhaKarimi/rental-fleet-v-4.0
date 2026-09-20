import { lazy, Suspense } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppLayout } from "./pages/AppLayout";
import { ErrorBoundary } from "./ErrorBoundary";
import { Skeleton } from "@/components/Skeleton";

// Eager: the two unauthenticated screens and the dashboard. Everything behind
// the auth gate is split, so a login only downloads what it needs.
import Login from "./pages/Login";
import ResetPassword from "./pages/ResetPassword";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const Fleet = lazy(() => import("./pages/Fleet"));
const Reservations = lazy(() => import("./pages/Reservations"));
const Customers = lazy(() => import("./pages/Customers"));
const Finance = lazy(() => import("./pages/Finance"));
const Settings = lazy(() => import("./pages/Settings"));
const Invoice = lazy(() => import("./pages/Invoice"));

function PageFallback() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

/**
 * The route table. Paths are unchanged from the App Router file tree, so every
 * bookmark, invoice link and `routeFor()` value keeps working:
 *
 *   app/(app)/page.tsx                    ->  /
 *   app/(app)/fleet/page.tsx              ->  /fleet
 *   app/(app)/invoices/[dealId]/page.tsx  ->  /invoices/:dealId
 *   app/login/page.tsx                    ->  /login
 *
 * The `(app)` group becomes a pathless layout route: same nesting, same auth
 * gate, no URL segment — exactly what the parentheses meant in Next.
 */
export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/reset-password" element={<ResetPassword />} />

      <Route element={<AppLayout />}>
        <Route
          path="/"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageFallback />}>
                <Dashboard />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/fleet"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageFallback />}>
                <Fleet />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/reservations"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageFallback />}>
                <Reservations />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/customers"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageFallback />}>
                <Customers />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/finance"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageFallback />}>
                <Finance />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/settings"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageFallback />}>
                <Settings />
              </Suspense>
            </ErrorBoundary>
          }
        />
        <Route
          path="/invoices/:dealId"
          element={
            <ErrorBoundary>
              <Suspense fallback={<PageFallback />}>
                <Invoice />
              </Suspense>
            </ErrorBoundary>
          }
        />
      </Route>

      {/* No 404 screen existed under Next either — an unknown path fell through
          to the dashboard's auth gate. Keep that behaviour. */}
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
