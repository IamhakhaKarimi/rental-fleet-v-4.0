"use client";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ConfirmDeleteModal } from "@/components/ConfirmDeleteModal";
import { beginUnloadFlush } from "@/lib/api";
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
 *
 * Three things make that optimistic window honest rather than a lie the next
 * reload exposes:
 *
 *  - **The commit is settled synchronously.** `settle()` reads and rewrites a
 *    ref, not `setPending`'s updater: a state updater runs during the NEXT
 *    render, so the timer's `if (!toCommit) return` fired before the updater
 *    had handed it anything and every delete bailed out un-sent.
 *  - **The window does not survive the page.** A reload, a close or a
 *    navigation inside those 10s used to drop the pending `setTimeout` on the
 *    floor: the row had vanished from the screen but no DELETE was ever sent,
 *    so it came back on the next load. `pagehide` now commits everything still
 *    pending, `keepalive` so the request outlives the document.
 *  - **A background refetch cannot resurrect a removed row.** Pages poll, and a
 *    poll landing mid-window would happily re-add the row the user just
 *    deleted. Callers pass a `key` and filter their rows through `isPending`,
 *    which stays true until the delete commits or is undone.
 */

const UNDO_SECONDS = 10;

interface DeleteRequest {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Stable id of the row being deleted (e.g. `customer:12`). Pass it to keep
   *  the row hidden through a background refetch — see `isPending`. */
  key?: string;
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
  key?: string;
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
  /** True while `key`'s delete is in its undo window (removed on screen, not
   *  yet sent). Filter freshly-fetched rows through this so a poll landing
   *  mid-window doesn't put the row back. */
  isPending: (key: string) => boolean;
}

const Ctx = createContext<DeleteUndoApi>({ requestDelete: () => {}, isPending: () => false });

export function DeleteUndoProvider({ children }: { children: React.ReactNode }) {
  const [confirming, setConfirming] = useState<DeleteRequest | null>(null);
  const [pending, setPending] = useState<PendingDelete[]>([]);
  const seq = useRef(0);
  const toast = useToast();

  // The ref is the AUTHORITATIVE pending list; `pending` state exists only to
  // render the countdown bars. It has to be the ref, because both places that
  // finish a delete — the 10s timer and the pagehide flush — run outside
  // React's render cycle and need the list, and their answer, synchronously.
  const pendingRef = useRef<PendingDelete[]>([]);
  const publish = useCallback((list: PendingDelete[]) => {
    pendingRef.current = list;
    setPending(list);
  }, []);

  /** Take `id` out of the pending list and return it — synchronously — or
   *  undefined if it is already settled (undone, committed, or flushed). */
  const settle = useCallback(
    (id: number): PendingDelete | undefined => {
      const found = pendingRef.current.find((p) => p.id === id);
      if (!found) return undefined;
      clearInterval(found.timer);
      publish(pendingRef.current.filter((p) => p.id !== id));
      return found;
    },
    [publish]
  );

  const undo = useCallback(
    (id: number) => {
      settle(id)?.onRestore();
    },
    [settle]
  );

  const requestDelete = useCallback((req: DeleteRequest) => {
    setConfirming(req);
  }, []);

  const isPending = useCallback(
    (key: string) => pending.some((p) => p.key === key),
    [pending]
  );

  // Leaving the page ends the undo window early rather than cancelling the
  // delete: the user already confirmed it and watched the row disappear, so
  // silently keeping it is the wrong half of the bargain. `pagehide` covers
  // reload, close and cross-document navigation alike (and, unlike `unload`,
  // still fires for a page entering the back/forward cache).
  useEffect(() => {
    const flush = () => {
      const list = pendingRef.current;
      if (list.length === 0) return;
      pendingRef.current = [];
      beginUnloadFlush();
      for (const p of list) {
        clearInterval(p.timer);
        // No await and no rollback: the document is going away, and the
        // request is keepalive so the browser sees it through.
        p.onCommit().catch(() => {});
      }
    };
    window.addEventListener("pagehide", flush);
    return () => window.removeEventListener("pagehide", flush);
  }, []);

  const confirm = useCallback(() => {
    if (!confirming) return;
    const req = confirming;
    setConfirming(null);
    req.onRemove();
    const id = ++seq.current;
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      publish(
        pendingRef.current.map((p) =>
          p.id === id ? { ...p, secondsLeft: p.secondsLeft - 1 } : p
        )
      );
    }, 1000);
    publish([
      ...pendingRef.current,
      {
        id,
        key: req.key,
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
      const toCommit = settle(id);
      if (!toCommit) return; // undone, or already flushed by pagehide
      try {
        await toCommit.onCommit();
        if (toCommit.successMessage) toast.success(toCommit.successMessage);
      } catch (e: any) {
        toCommit.onRestore();
        toast.error(toCommit.errorMessage ?? e?.message ?? "Delete failed.");
      }
    }, UNDO_SECONDS * 1000);
  }, [confirming, publish, settle, toast]);

  return (
    <Ctx.Provider value={{ requestDelete, isPending }}>
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
