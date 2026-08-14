"use client";
import { Modal } from "@/components/Modal";
import { useT } from "@/lib/i18n";

/** Shared confirmation step for every destructive delete in the app. Pairs with
 *  `useDeleteUndo()` (lib/deleteUndo.tsx), which schedules the actual API call
 *  behind a 10s undo window after this is confirmed — this modal is only the
 *  "are you sure" gate, it never performs the delete itself. */
export function ConfirmDeleteModal({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));
  return (
    <Modal title={title} onClose={onClose} size="md">
      <p className="text-sm text-muted mb-5">{message}</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>
          {tf("cancel", "Cancel")}
        </button>
        <button
          type="button"
          className="btn !border-[var(--danger)] !text-[var(--danger)]"
          onClick={onConfirm}
        >
          {confirmLabel ?? tf("delete", "Delete")}
        </button>
      </div>
    </Modal>
  );
}
