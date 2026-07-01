"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Lightweight toast notifications for CRUD confirmations.
 *
 * `useToast()` exposes `success` / `error` / `info` (and the lower-level `push`).
 * Callers pass an already-translated string — components own their own i18n, so
 * the toast layer stays presentation-only. Toasts stack bottom-right, auto-dismiss
 * after a few seconds, and can be clicked to dismiss early. Rendered through a
 * portal at a z-index above the modal overlay (z-50) so confirmations remain
 * visible while a dialog is open.
 */

type ToastKind = "success" | "error" | "info";

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

interface ToastApi {
  push: (message: string, kind?: ToastKind) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  dismiss: (id: number) => void;
}

const Ctx = createContext<ToastApi>({
  push: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
  dismiss: () => {},
});

const ICON: Record<ToastKind, string> = {
  success: "check_circle",
  error: "error",
  info: "info",
};
// Left-accent colour per kind (uses the app's themeable tokens; error is the one
// non-monochrome accent so failures read as a true alert).
const HL: Record<ToastKind, string> = {
  success: "var(--ok)",
  error: "var(--danger)",
  info: "var(--info)",
};

const AUTO_DISMISS_MS = 3400;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const seq = useRef(0);
  const timers = useRef<Record<number, ReturnType<typeof setTimeout>>>({});

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((x) => x.id !== id));
    const tm = timers.current[id];
    if (tm) {
      clearTimeout(tm);
      delete timers.current[id];
    }
  }, []);

  const push = useCallback(
    (message: string, kind: ToastKind = "success") => {
      if (!message) return;
      const id = ++seq.current;
      setToasts((list) => [...list, { id, kind, message }]);
      timers.current[id] = setTimeout(() => dismiss(id), AUTO_DISMISS_MS);
    },
    [dismiss]
  );

  const api: ToastApi = {
    push,
    success: useCallback((m: string) => push(m, "success"), [push]),
    error: useCallback((m: string) => push(m, "error"), [push]),
    info: useCallback((m: string) => push(m, "info"), [push]),
    dismiss,
  };

  return (
    <Ctx.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} dismiss={dismiss} />
    </Ctx.Provider>
  );
}

function ToastViewport({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  // Render the portal only after mount. The server and the client's first render
  // both return null (so the hydrated HTML matches); the portal then appears via
  // this post-mount effect. Gating on `typeof document` instead would return null
  // on the server but a portal on the client's first render — a hydration mismatch.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return createPortal(
    <div
      className="fixed bottom-4 right-4 flex flex-col gap-2 pointer-events-none"
      style={{ zIndex: 9999 }}
      aria-live="polite"
      role="status"
    >
      {toasts.map((tt) => (
        <button
          key={tt.id}
          onClick={() => dismiss(tt.id)}
          className="toast-in card pointer-events-auto flex items-start gap-2.5 pl-3 pr-3.5 py-2.5 text-left shadow-2xl max-w-[min(92vw,360px)]"
          style={{ borderLeft: `4px solid ${HL[tt.kind]}` }}
          title="Dismiss"
        >
          <span className="msr text-[20px] shrink-0 mt-0.5" style={{ color: HL[tt.kind] }}>
            {ICON[tt.kind]}
          </span>
          <span className="text-sm text-ink leading-snug">{tt.message}</span>
        </button>
      ))}
    </div>,
    document.body
  );
}

export const useToast = () => useContext(Ctx);
