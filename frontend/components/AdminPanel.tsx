"use client";
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { apiGet, apiPost, apiPut } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { can } from "@/lib/perms";
import { RefreshIcon } from "@/components/RefreshIcon";

/* ── Shapes from backend/api/routers/admin_panel.py + settings_account.py ──── */
interface RoleCol {
  role: string;
  label_key: string;
  level: number;
  editable: boolean;
}
interface PermRow {
  permission: string;
  label_key: string;
  min_level: number;
  locked: boolean;
  editable: boolean;
}
interface PermGroup {
  group: string;
  label_key: string;
  permissions: PermRow[];
}
interface PermPayload {
  roles: RoleCol[];
  groups: PermGroup[];
  matrix: Record<string, Record<string, boolean>>;
  defaults: Record<string, Record<string, boolean>>;
  overrides: Record<string, string[]>;
  scope: "full" | "minimal";
  actor_role: string;
}
interface UserRow {
  username: string;
  full_name: string;
  email: string;
  role: string;
  is_active: boolean;
  is_me: boolean;
  in_scope: boolean;
  locked: boolean;
  role_label_key: string;
}
interface AssignableRole {
  role: string;
  label_key: string;
}

/** Pending edits: role -> permission -> checked. Only cells the operator
 *  actually touched, so a save never rewrites untouched rows. */
type Draft = Record<string, Record<string, boolean>>;

/**
 * Admin Panel — staff accounts grouped by role plus the roles x permissions
 * matrix. Lives inside Settings (the "Roles" tab) rather than the sidebar: it's
 * configuration, not day-to-day work, so it belongs with the other admin
 * screens. Gated on `manage_users`; the backend decides whether this operator
 * sees the full matrix (super admin) or only the client-registration slice.
 */
export function AdminPanel() {
  const { t } = useI18n();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));
  const { user } = useAuth();
  const toast = useToast();

  const [perm, setPerm] = useState<PermPayload | null>(null);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<AssignableRole[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  const allowed = can(user, "manage_users");

  const load = useCallback(async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      const [p, u, r] = await Promise.all([
        apiGet<PermPayload>("/api/admin/permissions"),
        apiGet<UserRow[]>("/api/users"),
        apiGet<AssignableRole[]>("/api/users/assignable-roles"),
      ]);
      setPerm(p);
      setUsers(u);
      setRoles(r);
      setDraft({});
    } catch {
      /* the gate below already explains a 403; a transient error just leaves
         the last good render in place */
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => {
    load();
  }, [load]);

  // A cell's shown state is the draft value when touched, else the server's.
  const valueOf = (role: string, p: string) =>
    draft[role]?.[p] ?? perm?.matrix?.[role]?.[p] ?? false;

  const dirty = useMemo(() => {
    if (!perm) return [] as { role: string; permission: string; value: boolean }[];
    const out: { role: string; permission: string; value: boolean }[] = [];
    for (const [role, row] of Object.entries(draft)) {
      for (const [p, v] of Object.entries(row)) {
        if (v !== perm.matrix?.[role]?.[p]) out.push({ role, permission: p, value: v });
      }
    }
    return out;
  }, [draft, perm]);

  const toggle = (role: string, p: string) =>
    setDraft((d) => ({ ...d, [role]: { ...(d[role] || {}), [p]: !valueOf(role, p) } }));

  async function save() {
    if (!dirty.length) return;
    const changes: Draft = {};
    for (const c of dirty) {
      (changes[c.role] ||= {})[c.permission] = c.value;
    }
    setBusy(true);
    try {
      const next = await apiPut<PermPayload>("/api/admin/permissions", { changes });
      setPerm(next);
      setDraft({});
      toast.success(tf("saved", "Saved"));
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  async function resetDefaults() {
    if (!confirm(tf("reset_defaults", "Reset to Defaults") + "?")) return;
    setBusy(true);
    try {
      const next = await apiPost<PermPayload>("/api/admin/permissions/reset");
      setPerm(next);
      setDraft({});
      toast.success(tf("saved", "Saved"));
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  async function changeUserRole(u: UserRow, role: string) {
    if (role === u.role) return;
    try {
      await apiPut(`/api/users/${encodeURIComponent(u.username)}/role`, { role });
      toast.success(tf("role_updated", "Role updated."));
      load();
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    }
  }

  async function toggleActive(u: UserRow) {
    try {
      await apiPut(`/api/users/${encodeURIComponent(u.username)}/active`, { active: !u.is_active });
      toast.success(
        u.is_active
          ? tf("user_deactivated", "User deactivated.")
          : tf("user_activated", "User activated.")
      );
      load();
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    }
  }

  if (!allowed) {
    return (
      <div className="card p-6 text-sm text-muted">{tf("access_denied", "Access denied.")}</div>
    );
  }

  const minimal = perm?.scope === "minimal";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <span className="msr text-[18px]">admin_panel_settings</span>
          <h2 className="text-sm font-semibold">{tf("admin_panel_title", "Admin Panel")}</h2>
          {perm && (
            <span className="badge badge-info">
              {t(perm.roles.find((r) => r.role === perm.actor_role)?.label_key || perm.actor_role)}
            </span>
          )}
        </div>
        <RefreshIcon onClick={load} isLoading={loading} />
      </div>

      {/* ── Staff accounts, grouped by role ──────────────────────────────── */}
      <StaffByRole
        users={users}
        roles={roles}
        roleCols={perm?.roles || []}
        onChangeRole={changeUserRole}
        onToggleActive={toggleActive}
        t={t}
        tf={tf}
      />

      {/* ── Role / permission matrix ─────────────────────────────────────── */}
      <section className="card p-4 space-y-4">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-sm font-semibold flex items-center gap-1.5">
              <span className="msr text-[18px]">rule</span>
              {tf("admin_roles_title", "Roles & Permissions")}
            </h2>
            <p className="text-xs text-muted mt-1 max-w-2xl">
              {minimal
                ? tf("admin_roles_hint_min", "Manage what an Agent may do around client registration.")
                : tf(
                    "admin_roles_hint_full",
                    "Tick what each role may do. Super Admin always keeps every permission."
                  )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {dirty.length > 0 && (
              <span className="text-xs text-muted">
                {dirty.length} {tf("unsaved_changes", "unsaved change(s)")}
              </span>
            )}
            <button className="btn" onClick={resetDefaults} disabled={busy}>
              <span className="msr text-[16px]">restart_alt</span>
              {tf("reset_defaults", "Reset to Defaults")}
            </button>
            <button
              className="btn btn-primary"
              onClick={save}
              disabled={busy || dirty.length === 0}
            >
              <span className="msr text-[16px]">check</span>
              {busy ? "…" : tf("save_changes", "Save Changes")}
            </button>
          </div>
        </div>

        {perm && (
          <div className="overflow-x-auto">
            <table className="perm-matrix">
              <thead>
                <tr>
                  <th className="perm-head-label">{tf("permission", "Permission")}</th>
                  {perm.roles.map((r) => (
                    <th key={r.role} className="perm-head-role">
                      <span>{t(r.label_key)}</span>
                      {!r.editable && (
                        <small title={tf("perm_locked_hint", "Fixed for security.")}>
                          <span className="msr text-[12px]">lock</span>
                        </small>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {perm.groups.map((g) => (
                  <Fragment key={g.group}>
                    <tr className="perm-group-row">
                      <td colSpan={perm.roles.length + 1}>{t(g.label_key)}</td>
                    </tr>
                    {g.permissions.map((p) => (
                      <tr key={p.permission}>
                        <td className="perm-label">
                          <span>{t(p.label_key)}</span>
                          {p.locked && (
                            <span
                              className="msr perm-lock"
                              title={tf("perm_locked_hint", "Fixed for security.")}
                            >
                              lock
                            </span>
                          )}
                        </td>
                        {perm.roles.map((r) => {
                          const editable = r.editable && p.editable;
                          const on = valueOf(r.role, p.permission);
                          const changed = on !== perm.defaults?.[r.role]?.[p.permission];
                          return (
                            <td key={r.role} className="perm-cell">
                              <label
                                className={`perm-box ${on ? "is-on" : ""} ${
                                  editable ? "" : "is-fixed"
                                } ${changed ? "is-changed" : ""}`}
                                title={
                                  changed ? tf("perm_overridden", "Changed from default") : undefined
                                }
                              >
                                <input
                                  type="checkbox"
                                  checked={on}
                                  disabled={!editable}
                                  onChange={() => toggle(r.role, p.permission)}
                                  aria-label={`${t(r.label_key)} — ${t(p.label_key)}`}
                                />
                                <span className="msr">{on ? "check" : "remove"}</span>
                              </label>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

/**
 * Staff list grouped by role — the "user view" half of the panel. Deliberately a
 * different read than Settings → Users (a flat admin table): here the question
 * is "who holds which role", so role is the organising axis.
 *
 * The four role groups sit side by side in one row (see `.staff-grid`), which
 * keeps the whole section about a quarter of the height it used to be; the grid
 * collapses to two columns on tablets and one on phones.
 */
function StaffByRole({
  users,
  roles,
  roleCols,
  onChangeRole,
  onToggleActive,
  t,
  tf,
}: {
  users: UserRow[];
  roles: AssignableRole[];
  roleCols: RoleCol[];
  onChangeRole: (u: UserRow, role: string) => void;
  onToggleActive: (u: UserRow) => void;
  t: (k: string) => string;
  tf: (k: string, f: string) => string;
}) {
  // Fall back to the roles present in the data when the matrix hasn't loaded.
  const order = roleCols.length
    ? roleCols.map((r) => ({ role: r.role, label_key: r.label_key }))
    : Array.from(new Set(users.map((u) => u.role))).map((r) => ({ role: r, label_key: r }));

  return (
    <section className="card p-4 space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-1.5">
        <span className="msr text-[18px]">group</span>
        {tf("admin_users_title", "Staff Accounts")}
        <span className="badge badge-info ml-1">{users.length}</span>
      </h2>

      <div className="staff-grid">
        {order.map((col) => {
          const members = users.filter((u) => u.role === col.role);
          return (
            <div key={col.role} className="staff-row">
              <div className="staff-row-head">
                <span className="msr text-[15px]">badge</span>
                {t(col.label_key)}
                <span className="staff-count">{members.length}</span>
              </div>
              <div className="staff-row-body">
                {members.map((u) => {
                  const canEdit = u.in_scope && !u.locked && !u.is_me;
                  return (
                    <div key={u.username} className={`staff-chip ${u.is_active ? "" : "is-off"}`}>
                      <div className="staff-avatar">
                        {(u.full_name || u.username).trim().slice(0, 1).toUpperCase()}
                      </div>
                      <div className="staff-id">
                        <div className="staff-name">
                          {u.full_name || u.username}
                          {u.is_me && <span className="badge badge-info">{tf("you", "you")}</span>}
                          {u.locked && (
                            <span className="msr text-[13px] text-muted" title={tf("perm_locked_hint", "Locked")}>
                              lock
                            </span>
                          )}
                        </div>
                        <div className="staff-sub">{u.username}{u.email ? ` · ${u.email}` : ""}</div>
                      </div>
                      <div className="staff-actions">
                        <select
                          className="staff-role !py-1 text-xs"
                          value={u.role}
                          disabled={!canEdit || roles.length === 0}
                          onChange={(e) => onChangeRole(u, e.target.value)}
                          aria-label={tf("col_role", "Role")}
                        >
                          {!roles.some((r) => r.role === u.role) && (
                            <option value={u.role}>{t(u.role_label_key) || u.role}</option>
                          )}
                          {roles.map((r) => (
                            <option key={r.role} value={r.role}>
                              {t(r.label_key)}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn !py-1 !px-2 text-xs shrink-0"
                          disabled={!canEdit}
                          onClick={() => onToggleActive(u)}
                          title={
                            u.is_active ? tf("deactivate", "Deactivate") : tf("activate", "Activate")
                          }
                        >
                          <span className="msr text-[15px]">
                            {u.is_active ? "toggle_on" : "toggle_off"}
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}
                {members.length === 0 && (
                  <div className="text-xs text-muted py-1.5">{tf("no_results", "None")}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
