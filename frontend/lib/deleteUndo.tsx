"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { useToast } from "@/lib/toast";
import { useT } from "@/lib/i18n";

/**
 * Shared "confirm, then 10s undo window" flow for every CRUD delete in the app.
 *
 * `requestDelete()` first shows a `ConfirmDeleteModal`. On confirm, the caller's
 * `onRemove` runs immediately (optimistic UI removal) and a 10s countdown bar
 * appears with an Undo button. If the user hits Undo, `onRestore` runs and
 * nothing is sent to the server. If the countdown elapses, `onCommit` (the
 * actual DELETE call) fires; on failure `onRestore` runs again and an error
 * toast is shown, since the optimistic removal must be rolled back.
 */

const UNDO_SECONDS = 10;

interface DeleteRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Optimistically hide the item from the UI. Runs right after confirm. */
  onRemove: () => void;
  /** Bring the item back — used both for explicit Undo and for a failed commit. */
  onRestore: () => void;
  /** The actual DELETE call. Runs only once the 10s window elapses unopposed. */
  onCommit: () => Promise<void>;
  /** Toast text shown once the delete actually commits. */
  successMessage?: string;
  errorMessage?: string;
}

interface PendingDelete {
  id: number;
  title: string;
  secondsLeft: number;
  onRestore: () => void;
  onCommit: () => Promise<void>;
  successMessage?: string;
  errorMessage?: string;
  timer: ReturnType<typeof setInterval>;
}

interface DeleteUndoApi {
  requestDelete: (req: DeleteRequest) => void;
}

const Ctx = createContext<DeleteUndoApi>({ requestDelete: () => {} });

export function DeleteUndoProvider({ children }: { children: React.ReactNode }) {
  const [confirming, setConfirming] = useState<DeleteRequest | null>(null);
  const [pending, setPending] = useState<PendingDelete[]>([]);
  const seq = useRef(0);
  const toast = useToast();

  const settle = useCallback((id: number, run: (p: PendingDelete) => void) => {
    setPending((list) => {
      const found = list.find((p) => p.id === id);
      if (found) {
        clearInterval(found.timer);
        run(found);
      }
      return list.filter((p) => p.id !== id);
    });
  }, []);

  const undo = useCallback(
    (id: number) => {
      settle(id, (p) => p.onRestore());
    },
    [settle]
  );

  const requestDelete = useCallback((req: DeleteRequest) => {
    setConfirming(req);
  }, []);

  const confirm = useCallback(() => {
    if (!confirming) return;
    const req = confirming;
    setConfirming(null);
    req.onRemove();
    const id = ++seq.current;
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      setPending((list) =>
        list.map((p) => (p.id === id ? { ...p, secondsLeft: p.secondsLeft - 1 } : p))
      );
    }, 1000);
    setPending((list) => [
      ...list,
      {
        id,
        title: req.title,
        secondsLeft: UNDO_SECONDS,
        onRestore: req.onRestore,
        onCommit: req.onCommit,
        successMessage: req.successMessage,
        errorMessage: req.errorMessage,
        timer,
      },
    ]);
    setTimeout(async () => {
      let toCommit: PendingDelete | undefined;
      settle(id, (p) => {
        toCommit = p;
      });
      if (!toCommit) return;
      try {
        await toCommit.onCommit();
        if (toCommit.successMessage) toast.success(toCommit.successMessage);
      } catch (e: any) {
        toCommit.onRestore();
        toast.error(toCommit.errorMessage ?? e?.message ?? "Delete failed.");
      }
    }, UNDO_SECONDS * 1000);
  }, [confirming, settle, toast]);

  return (
    <Ctx.Provider value={{ requestDelete }}>
      {children}
      {confirming && (
        <ConfirmDeleteModal
          title={confirming.title}
          message={confirming.message}
          confirmLabel={confirming.confirmLabel}
          onConfirm={confirm}
          onClose={() => setConfirming(null)}
        />
      )}
      <UndoViewport pending={pending} onUndo={undo} />
    </Ctx.Provider>
  );
}

function UndoViewport({
  pending,
  onUndo,
}: {
  pending: PendingDelete[];
  onUndo: (id: number) => void;
}) {
  const t = useT();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));
  if (typeof document === "undefined" || pending.length === 0) return null;
  return createPortal(
    <div
      className="fixed bottom-4 right-4 flex flex-col-reverse gap-2 pointer-events-none"
      style={{ zIndex: 9999 }}
      aria-live="assertive"
      role="status"
    >
      {pending.map((p) => (
        <div
          key={p.id}
          className="card bg-surface pointer-events-auto flex items-center gap-3 pl-3 pr-3 py-2.5 shadow-2xl max-w-[min(92vw,380px)]"
          style={{ borderLeft: "4px solid var(--danger)" }}
        >
          <span className="msr text-[20px] shrink-0" style={{ color: "var(--danger)" }}>
            delete
          </span>
          <span className="text-sm text-ink leading-snug flex-1">
            {tf("deleting_in", "Deleting")} {p.title} — {p.secondsLeft}s
          </span>
          <button
            type="button"
            onClick={() => onUndo(p.id)}
            className="btn !py-1 !px-2.5 text-xs font-semibold shrink-0"
          >
            {tf("undo", "Undo")}
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}

export const useDeleteUndo = () => useContext(Ctx);
