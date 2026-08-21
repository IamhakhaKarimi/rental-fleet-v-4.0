"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api, apiDel, apiGet, apiPost, apiPut } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { usePolling } from "@/lib/usePolling";
import { useResponsiveView } from "@/lib/useResponsiveView";
import { can } from "@/lib/perms";
import { useMoney } from "@/lib/currency";
import { useDeleteUndo } from "@/lib/deleteUndo";
import { Modal } from "@/components/Modal";
import { StatusBadge } from "@/components/StatusBadge";
import { RefreshIcon } from "@/components/RefreshIcon";
import { ViewToggle, type ViewMode } from "@/components/ViewToggle";
import { SwipeDeck, SwipePanel } from "@/components/SwipeCard";
import { VehicleCard, AvailabilityChip } from "@/components/VehicleCard";
import { VehicleThumb } from "@/components/VehicleThumb";
import { useVehicleThumbs } from "@/lib/useVehicleThumbs";
import { usePagedTable } from "@/lib/usePagedTable";
import { Pagination } from "@/components/Pagination";
import type { Vehicle } from "@/lib/types";

type V = Vehicle & { locked?: boolean };

const blank = {
  make_model: "",
  year: 2022,
  license_plate: "",
  color: "",
  mileage: 0,
  status: "Available",
  base_daily_rate_euros: 30,
  notes: "",
};

function VehicleForm({
  initial,
  onSubmit,
  submitLabel,
  lockedStatus,
}: {
  initial: typeof blank;
  onSubmit: (v: typeof blank) => Promise<void>;
  submitLabel: string;
  lockedStatus?: boolean;
}) {
  const t = useT();
  const [f, setF] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: any) => setF((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (!f.make_model.trim()) {
      setErr(t("fields_required"));
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await onSubmit(f);
    } catch (e: any) {
      setErr(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <label className="col-span-2 text-xs text-muted">
          {t("col_model")}
          <input value={f.make_model} onChange={(e) => set("make_model", e.target.value)} />
        </label>
        <label className="text-xs text-muted">
          {t("col_year")}
          <input type="number" value={f.year} onChange={(e) => set("year", +e.target.value)} />
        </label>
        <label className="text-xs text-muted">
          {t("col_plate")}
          <input value={f.license_plate} onChange={(e) => set("license_plate", e.target.value)} />
        </label>
        <label className="text-xs text-muted">
          {t("col_color")}
          <input value={f.color} onChange={(e) => set("color", e.target.value)} />
        </label>
        <label className="text-xs text-muted">
          {t("col_mileage") === "col_mileage" ? "Mileage (km)" : t("col_mileage")}
          <input type="number" value={f.mileage} onChange={(e) => set("mileage", +e.target.value)} />
        </label>
        <label className="text-xs text-muted">
          {t("col_rate")} (€)
          <input
            type="number"
            value={f.base_daily_rate_euros}
            onChange={(e) => set("base_daily_rate_euros", +e.target.value)}
          />
        </label>
        <label className="text-xs text-muted">
          {t("col_status")}
          <select
            value={f.status}
            onChange={(e) => set("status", e.target.value)}
            disabled={lockedStatus}
          >
            <option value="Available">Available</option>
            <option value="Maintenance">Maintenance</option>
          </select>
        </label>
        {lockedStatus && (
          <div className="col-span-2 flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn">
            <span className="msr text-[16px] shrink-0 mt-px">lock</span>
            <span>
              {t("status_locked_rented") === "status_locked_rented"
                ? "Status is locked while this vehicle is rented."
                : t("status_locked_rented")}
            </span>
          </div>
        )}
        <label className="col-span-2 text-xs text-muted">
          {t("notes") === "notes" ? "Notes" : t("notes")}
          <textarea value={f.notes} onChange={(e) => set("notes", e.target.value)} rows={2} />
        </label>
      </div>
      {err && <div className="text-sm text-danger">{err}</div>}
      <button className="btn btn-primary w-full" onClick={submit} disabled={busy}>
        {busy ? "…" : submitLabel}
      </button>
    </div>
  );
}

type Photo = { photo_id: number; photo: string; position: number };

function PhotoManager({ vehicleId }: { vehicleId: string }) {
  const t = useT();
  const toast = useToast();
  const { requestDelete } = useDeleteUndo();
  const tf = (k: string, fb: string) => (t(k) === k ? fb : t(k));
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const refetch = useCallback(() => {
    apiGet<Photo[]>(`/api/vehicles/${vehicleId}/photos`)
      .then(setPhotos)
      .catch(() => {});
  }, [vehicleId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  async function upload() {
    const input = fileRef.current;
    const files = input?.files;
    if (!files || files.length === 0) return;
    setBusy(true);
    setErr("");
    try {
      const fd = new FormData();
      for (const file of Array.from(files)) fd.append("files", file);
      await api(`/api/vehicles/${vehicleId}/photos`, { method: "POST", body: fd });
      if (input) input.value = "";
      toast.success(tf("photos_added", "Photos added."));
      refetch();
    } catch (e: any) {
      setErr(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  function remove(photoId: number) {
    let idx = -1;
    let removed: Photo | undefined;
    requestDelete({
      title: tf("delete_photo", "Delete photo"),
      message: tf("confirm_delete_photo", "Delete this photo? This cannot be undone."),
      onRemove: () =>
        setPhotos((prev) => {
          idx = prev.findIndex((p) => p.photo_id === photoId);
          removed = prev[idx];
          return prev.filter((p) => p.photo_id !== photoId);
        }),
      onRestore: () =>
        setPhotos((prev) => {
          if (!removed || prev.some((p) => p.photo_id === photoId)) return prev;
          const next = [...prev];
          next.splice(idx < 0 ? next.length : idx, 0, removed);
          return next;
        }),
      onCommit: async () => {
        await apiDel(`/api/vehicles/photos/${photoId}`);
        refetch();
      },
      successMessage: tf("photo_deleted", "Photo deleted."),
      errorMessage: t("error"),
    });
  }

  return (
    <div className="space-y-3 mt-5 pt-4 border-t border-border">
      <h3 className="text-sm font-semibold flex items-center gap-1.5">
        <span className="msr text-[18px]">photo_library</span>
        {t("manage_photos") === "manage_photos" ? "Manage Photos" : t("manage_photos")} (
        {photos.length})
      </h3>

      {photos.length === 0 ? (
        <p className="text-xs text-muted">
          {t("no_photos") === "no_photos" ? "No photos yet." : t("no_photos")}
        </p>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {photos.map((p) => (
            <div key={p.photo_id} className="relative group">
              <img
                src={"data:image/jpeg;base64," + p.photo}
                alt="vehicle"
                className="h-[90px] w-full object-cover rounded border border-border"
              />
              <button
                className="btn btn-danger !p-1 !absolute top-1 right-1"
                title={t("delete_photo") === "delete_photo" ? "Delete photo" : t("delete_photo")}
                onClick={() => remove(p.photo_id)}
              >
                <span className="msr text-[14px]">delete</span>
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 flex-wrap">
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="text-xs"
        />
        <button className="btn btn-primary !py-1.5 !px-3 text-xs" onClick={upload} disabled={busy}>
          <span className="msr text-[16px]">upload</span>
          {busy ? "…" : t("add_photos") === "add_photos" ? "Add Photos" : t("add_photos")}
        </button>
      </div>
      {err && <div className="text-sm text-danger">{err}</div>}
      <p className="text-[0.65rem] text-muted">
        {t("photo_hint") === "photo_hint" ? "15MB per file · PNG, JPG, WEBP" : t("photo_hint")}
      </p>
    </div>
  );
}

export default function FleetPage() {
  const t = useT();
  const toast = useToast();
  const { requestDelete } = useDeleteUndo();
  const tf = (k: string, fb: string) => (t(k) === k ? fb : t(k));
  const { user } = useAuth();
  const fmt = useMoney();
  const [vehicles, setVehicles] = useState<V[]>([]);
  const [q, setQ] = useState("");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<V | null>(null);
  const [removing, setRemoving] = useState<V | null>(null);
  const [view, changeView] = useResponsiveView("fleet_view");
  const thumbs = useVehicleThumbs(vehicles.map((v) => v.vehicle_id));
  // Server-paginated table (M5) — deliberately separate from `vehicles` above,
  // which stays the full filtered list the card/carousel view needs. Only
  // fetches while the table is actually visible.
  const [tableRefresh, setTableRefresh] = useState(0);
  const paged = usePagedTable<V>(`/api/vehicles?q=${encodeURIComponent(q)}`, 25, view === "table", tableRefresh);

  const load = useCallback(async () => {
    await apiGet<V[]>(`/api/vehicles?q=${encodeURIComponent(q)}`).then(setVehicles).catch(() => {});
    setTableRefresh((n) => n + 1);
  }, [q]);

  const { isLoading, refetch } = usePolling(load, { interval: 15000 });

  async function quickStatus(v: V, status: string) {
    try {
      await apiPost(`/api/vehicles/${v.vehicle_id}/status`, { status });
      toast.success(`${v.make_model} · ${tf("status_updated", "status updated")} → ${status}`);
      load();
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    }
  }
  // skipConfirm: the new card "Archive / Delete" modal is itself a deliberate
  // confirmation step, so it skips the native confirm() the table's direct
  // buttons still rely on.
  async function archive(v: V, skipConfirm = false) {
    if (!skipConfirm && !confirm(`${t("delete_btn")}: ${v.vehicle_id} · ${v.make_model}?`)) return;
    try {
      await apiPost(`/api/vehicles/${v.vehicle_id}/archive`);
      toast.success(`${v.make_model} — ${tf("vehicle_archived", "vehicle archived")}`);
      setRemoving(null);
      load();
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    }
  }
  function hardDelete(v: V, skipConfirm = false) {
    let idx = -1;
    const doRemove = () =>
      setVehicles((prev) => {
        idx = prev.findIndex((x) => x.vehicle_id === v.vehicle_id);
        return prev.filter((x) => x.vehicle_id !== v.vehicle_id);
      });
    const doRestore = () =>
      setVehicles((prev) => {
        if (prev.some((x) => x.vehicle_id === v.vehicle_id)) return prev;
        const next = [...prev];
        next.splice(idx < 0 ? next.length : idx, 0, v);
        return next;
      });
    const doCommit = async () => {
      await apiDel(`/api/vehicles/${v.vehicle_id}`);
      setRemoving(null);
      load();
    };
    if (skipConfirm) {
      // The card view's own Archive/Delete modal already confirmed this — don't
      // show ConfirmDeleteModal again, but still run the delete through the same
      // 10s-delayed commit shape (optimistic removal now, real DELETE call after
      // the window, restore + error toast on failure).
      doRemove();
      setTimeout(async () => {
        try {
          await doCommit();
          toast.success(`${v.vehicle_id} — ${tf("vehicle_deleted", "vehicle deleted")}`);
        } catch (e: any) {
          doRestore();
          toast.error(t(e?.key || "error"));
        }
      }, 10000);
      return;
    }
    requestDelete({
      title: tf("delete_vehicle", "Delete vehicle"),
      message: `${t("delete_btn")} (permanent): ${v.vehicle_id}?`,
      confirmLabel: t("delete_btn"),
      onRemove: doRemove,
      onRestore: doRestore,
      onCommit: doCommit,
      successMessage: `${v.vehicle_id} — ${tf("vehicle_deleted", "vehicle deleted")}`,
      errorMessage: t("error"),
    });
  }

  const canEdit = can(user, "service_vehicle");
  const canFleet = can(user, "edit_fleet");

  // Shared CRUD/status action buttons for a vehicle — used by both the card grid
  // and the table row so the two views stay in lockstep.
  const renderActions = (v: V) =>
    (canEdit || canFleet) && (
      <div className="flex items-center gap-2 flex-wrap">
        {canEdit && (
          <button
            className="btn !py-1.5 !px-3 text-xs"
            title={t("edit_vehicle") === "edit_vehicle" ? "Edit vehicle" : t("edit_vehicle")}
            onClick={() => setEditing(v)}
          >
            <span className="msr text-[16px]">edit</span>
            {t("edit") === "edit" ? "Edit" : t("edit")}
          </button>
        )}
        {v.status !== "Maintenance" && (
          <button
            className="btn !py-1.5 !px-3 text-xs"
            title={t("set_maintenance") === "set_maintenance" ? "Set status to Maintenance" : t("set_maintenance")}
            disabled={v.locked}
            onClick={() => quickStatus(v, "Maintenance")}
          >
            <span className="msr text-[16px]">build</span>Maintenance
          </button>
        )}
        {canFleet && v.status !== "In Garage" && (
          <button
            className="btn !py-1.5 !px-3 text-xs"
            title={t("set_garage") === "set_garage" ? "Move to garage" : t("set_garage")}
            disabled={v.locked}
            onClick={() => quickStatus(v, "In Garage")}
          >
            <span className="msr text-[16px]">garage</span>Garage
          </button>
        )}
        {(v.status === "Maintenance" || v.status === "In Garage") && (
          <button
            className="btn !py-1.5 !px-3 text-xs"
            title={t("set_available") === "set_available" ? "Set status to Available" : t("set_available")}
            disabled={v.locked}
            onClick={() => quickStatus(v, "Available")}
          >
            <span className="msr text-[16px]">check_circle</span>Available
          </button>
        )}
        {can(user, "soft_delete_vehicle") && (
          <button
            className="btn btn-danger !py-1.5 !px-3 text-xs"
            title={t("archive_hint") === "archive_hint" ? "Archive (soft delete — can be restored)" : t("archive_hint")}
            onClick={() => archive(v)}
          >
            <span className="msr text-[16px]">archive</span>
          </button>
        )}
        {can(user, "hard_delete_vehicle") && (
          <button
            className="btn btn-danger !py-1.5 !px-3 text-xs"
            title={t("delete_perm_hint") === "delete_perm_hint" ? "Delete permanently" : t("delete_perm_hint")}
            onClick={() => hardDelete(v)}
          >
            <span className="msr text-[16px]">delete</span>
          </button>
        )}
      </div>
    );

  // Photo-forward card action buttons — same conditions/handlers as renderActions
  // above, kept as its own function (rather than shared) so the table view above
  // stays pixel-identical while the card grid below can use its own grouping
  // (3-up neutral row + 2-up danger row) and button styling (solid Edit, soft
  // Archive vs solid Delete) per the new card design.
  const renderCardActions = (v: V) => {
    if (!canEdit && !canFleet) return null;
    const primary: JSX.Element[] = [];
    if (canEdit) {
      primary.push(
        <button
          key="edit"
          className="btn btn-primary !py-1.5 !px-2 text-xs"
          title={t("edit_vehicle") === "edit_vehicle" ? "Edit vehicle" : t("edit_vehicle")}
          onClick={() => setEditing(v)}
        >
          <span className="msr text-[16px]">edit</span>
          {t("edit") === "edit" ? "Edit" : t("edit")}
        </button>
      );
    }
    if (v.status !== "Maintenance") {
      primary.push(
        <button
          key="maint"
          className="btn !py-1.5 !px-2 text-xs"
          title={t("set_maintenance") === "set_maintenance" ? "Set status to Maintenance" : t("set_maintenance")}
          disabled={v.locked}
          onClick={() => quickStatus(v, "Maintenance")}
        >
          <span className="msr text-[16px]">build</span>Maint.
        </button>
      );
    }
    if (canFleet && v.status !== "In Garage") {
      primary.push(
        <button
          key="garage"
          className="btn !py-1.5 !px-2 text-xs"
          title={t("set_garage") === "set_garage" ? "Move to garage" : t("set_garage")}
          disabled={v.locked}
          onClick={() => quickStatus(v, "In Garage")}
        >
          <span className="msr text-[16px]">garage</span>Garage
        </button>
      );
    }
    if (v.status === "Maintenance" || v.status === "In Garage") {
      primary.push(
        <button
          key="avail"
          className="btn !py-1.5 !px-2 text-xs"
          title={t("set_available") === "set_available" ? "Set status to Available" : t("set_available")}
          disabled={v.locked}
          onClick={() => quickStatus(v, "Available")}
        >
          <span className="msr text-[16px]">check_circle</span>Available
        </button>
      );
    }

    // Archive and Delete are folded into one button that opens a confirmation
    // modal offering both — instead of two permanent-looking buttons sitting
    // side by side on the card.
    const canRemove = can(user, "soft_delete_vehicle") || can(user, "hard_delete_vehicle");

    if (primary.length === 0 && !canRemove) return null;
    return (
      <div className="space-y-2">
        {primary.length > 0 && <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">{primary}</div>}
        {canRemove && (
          <button
            className="btn btn-danger-soft w-full !py-1.5 !px-2 text-xs"
            title={tf("remove_vehicle_hint", "Archive or delete this vehicle")}
            onClick={() => setRemoving(v)}
          >
            <span className="msr text-[16px]">delete</span>
            {tf("archive_or_delete", "Archive / Delete")}
          </button>
        )}
      </div>
    );
  };

  // Always-reserved photo placeholder — most vehicles have no photo yet, so
  // this stands in rather than collapsing the card's photo area to nothing.
  const photoPlaceholder = (
    <div className="h-[190px] w-full rounded-[14px] bg-bg border border-line flex items-center justify-center text-muted">
      <span className="msr text-[40px]">directions_car</span>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* `flex-wrap` — this was the one page header without it, so at 375px the
          title and the three controls were squeezed onto a single line. */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="msr text-[22px]">directions_car</span>
          <h1 className="text-xl font-bold">{t("nav_fleet")}</h1>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <RefreshIcon onClick={refetch} isLoading={isLoading} />
          <ViewToggle
            value={view}
            onChange={changeView}
            cardsTitle={tf("view_cards", "Card view")}
            tableTitle={tf("view_table", "Table view")}
          />
          {canFleet && (
            <button
              className="btn btn-primary"
              onClick={() => setAdding(true)}
              title={t("fleet_add") === "fleet_add" ? "Add Vehicle" : t("fleet_add")}
            >
              <span className="msr text-[18px]">add</span>
              <span className="max-sm:hidden">{t("fleet_add") === "fleet_add" ? "Add Vehicle" : t("fleet_add")}</span>
            </button>
          )}
        </div>
      </div>
      <input placeholder={t("search")} value={q} onChange={(e) => setQ(e.target.value)} className="w-full max-w-sm" />
      <p className="text-xs text-muted">
        {vehicles.length} {t("col_count")}
      </p>

      {view === "cards" ? (
        <SwipeDeck
          items={vehicles}
          keyOf={(v) => v.vehicle_id}
          empty={<div className="text-sm text-muted">{t("no_cars")}</div>}
          render={(v) => (
            <VehicleCard
              name={v.make_model}
              photo={
                <VehicleThumb
                  vehicleId={v.vehicle_id}
                  src={thumbs[v.vehicle_id]}
                  className="h-[190px] w-full object-cover rounded-[14px]"
                  fallback={photoPlaceholder}
                />
              }
              reference={
                <>
                  {v.year || "—"} · {v.license_plate || "—"}
                  {v.color ? ` · ${v.color}` : ""}
                  {v.mileage != null ? ` · ${v.mileage.toLocaleString()} km` : ""}
                </>
              }
              status={<AvailabilityChip status={v.status} locked={v.locked} />}
              price={
                <SwipePanel>
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-1.5">
                      <span className="msr text-[16px] text-muted">sell</span>
                      <span className="text-xs text-muted">{tf("from", "from")}</span>
                      <span className="font-display font-bold text-base text-accent">
                        {fmt(v.base_daily_rate)}
                      </span>
                    </span>
                    <span className="text-[0.6rem] uppercase text-muted tracking-wide">
                      / {tf("day", "day")}
                    </span>
                  </div>
                </SwipePanel>
              }
              footer={(canEdit || canFleet) ? renderCardActions(v) : undefined}
            />
          )}
        />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-muted border-b border-line">
                <th className="p-2.5 font-medium">{t("col_model")}</th>
                <th className="p-2.5 font-medium">{t("col_year")}</th>
                <th className="p-2.5 font-medium">{t("col_plate")}</th>
                <th className="p-2.5 font-medium">{t("col_color")}</th>
                <th className="p-2.5 font-medium">{tf("col_mileage", "Mileage")}</th>
                <th className="p-2.5 font-medium">{t("col_status")}</th>
                <th className="p-2.5 font-medium text-right">{t("col_rate")}</th>
                {(canEdit || canFleet) && (
                  <th className="p-2.5 font-medium text-right">{tf("col_actions", "Actions")}</th>
                )}
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((v) => (
                <tr key={v.vehicle_id} className="border-b border-line last:border-0 align-top">
                  <td className="p-2.5">
                    <span className="font-medium text-ink">{v.make_model}</span>
                    <span className="text-muted"> · {v.vehicle_id}</span>
                  </td>
                  <td className="p-2.5 text-muted">{v.year || "—"}</td>
                  <td className="p-2.5 text-muted">{v.license_plate || "—"}</td>
                  <td className="p-2.5 text-muted">{v.color || "—"}</td>
                  <td className="p-2.5 text-muted">{v.mileage != null ? v.mileage : "—"}</td>
                  <td className="p-2.5">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <StatusBadge status={v.status} />
                      {v.locked && (
                        <span className="badge badge-warn">
                          <span className="msr text-[13px]">lock</span>
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-2.5 text-right font-medium">{fmt(v.base_daily_rate)}</td>
                  {(canEdit || canFleet) && (
                    <td className="p-2.5">
                      <div className="flex justify-end">{renderActions(v)}</div>
                    </td>
                  )}
                </tr>
              ))}
              {paged.rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="p-4 text-sm text-muted text-center">
                    {t("no_cars")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <Pagination
            page={paged.page}
            pageCount={paged.pageCount}
            total={paged.total}
            onChange={paged.setPage}
            label={t("col_count") === "col_count" ? "vehicles" : t("col_count")}
          />
        </div>
      )}

      {adding && (
        <Modal title={t("fleet_add") === "fleet_add" ? "Add Vehicle" : t("fleet_add")} onClose={() => setAdding(false)}>
          <VehicleForm
            initial={blank}
            submitLabel={t("add_btn") === "add_btn" ? "Add" : t("add_btn")}
            onSubmit={async (f) => {
              await apiPost("/api/vehicles", f);
              toast.success(tf("vehicle_added", "Vehicle added."));
              setAdding(false);
              load();
            }}
          />
        </Modal>
      )}

      {editing && (
        <Modal title={`${editing.vehicle_id} · ${editing.make_model}`} onClose={() => setEditing(null)}>
          {editing.locked && (
            <div className="flex items-start gap-2 rounded-lg border border-warn/30 bg-warn/10 p-2.5 text-xs text-warn mb-3">
              <span className="msr text-[16px] shrink-0 mt-px">lock</span>
              <span>
                {t("status_locked_rented") === "status_locked_rented"
                  ? "Status is locked while this vehicle is rented."
                  : t("status_locked_rented")}
              </span>
            </div>
          )}
          <VehicleForm
            initial={{
              make_model: editing.make_model,
              year: editing.year ?? 2022,
              license_plate: editing.license_plate || "",
              color: editing.color || "",
              mileage: editing.mileage ?? 0,
              status: editing.status === "Maintenance" ? "Maintenance" : "Available",
              base_daily_rate_euros: Math.max(0, Math.round((editing.base_daily_rate || 0) / 100)),
              notes: editing.notes || "",
            }}
            lockedStatus={!!editing.locked}
            submitLabel={t("update_btn") === "update_btn" ? "Save" : t("update_btn")}
            onSubmit={async (f) => {
              await apiPut(`/api/vehicles/${editing.vehicle_id}`, f);
              toast.success(tf("vehicle_updated", "Vehicle updated."));
              setEditing(null);
              load();
            }}
          />
          {canEdit && <PhotoManager vehicleId={editing.vehicle_id} />}
        </Modal>
      )}

      {removing && (
        <Modal
          title={`${removing.vehicle_id} · ${removing.make_model}`}
          onClose={() => setRemoving(null)}
        >
          <div className="space-y-4">
            <p className="text-sm text-muted">
              {tf(
                "remove_vehicle_prompt",
                "Archive keeps this vehicle's history and can be restored later. Delete removes it permanently."
              )}
            </p>
            <div className="space-y-2">
              {can(user, "soft_delete_vehicle") && (
                <button
                  className="btn btn-danger-soft w-full"
                  onClick={() => archive(removing, true)}
                >
                  <span className="msr text-[18px]">archive</span>
                  {t("archive_hint") === "archive_hint"
                    ? "Archive (soft delete — can be restored)"
                    : t("archive_hint")}
                </button>
              )}
              {can(user, "hard_delete_vehicle") && (
                <button
                  className="btn btn-danger w-full"
                  onClick={() => hardDelete(removing, true)}
                >
                  <span className="msr text-[18px]">delete</span>
                  {t("delete_perm_hint") === "delete_perm_hint" ? "Delete permanently" : t("delete_perm_hint")}
                </button>
              )}
              <button className="btn w-full" onClick={() => setRemoving(null)}>
                <span className="msr text-[18px]">close</span>
                {tf("cancel", "Cancel")}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
