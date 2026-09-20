"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiDel, apiGet, apiPost, apiPut, apiBase } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n, useT } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { can, roleLevel } from "@/lib/perms";
import { useCurrency, useMoney, DEFAULT_EUR_ALL_RATE } from "@/lib/currency";
import { useTheme } from "@/lib/theme";
import { refreshLicenseLimits } from "@/lib/license";
import { Modal } from "@/components/Modal";
import { DateField } from "@/components/DateField";
import { AdminPanel } from "@/components/AdminPanel";
import { useDeleteUndo } from "@/lib/deleteUndo";

// English fallback when a key isn't in the dictionary.
const f = (t: (k: string) => string, key: string, fb: string) =>
  t(key) === key ? fb : t(key);

// ── small shared bits ────────────────────────────────────────────────────────
function Field({
  label,
  children,
  full,
}: {
  label: string;
  children: React.ReactNode;
  full?: boolean;
}) {
  return (
    <label className={`text-xs text-muted ${full ? "col-span-2" : ""}`}>
      {label}
      {children}
    </label>
  );
}

function Notice({ ok, msg }: { ok: boolean; msg: string }) {
  if (!msg) return null;
  return <div className={`text-sm ${ok ? "text-ok" : "text-danger"}`}>{msg}</div>;
}

function SectionCard({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        {icon && <span className="msr text-[18px] text-muted">{icon}</span>}
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {children}
    </div>
  );
}

function fmtDate(s: string | null | undefined, lang: string): string {
  if (!s) return "—";
  const d = new Date(String(s).replace(" ", "T"));
  if (isNaN(d.getTime())) return String(s);
  return new Intl.DateTimeFormat(lang || "en", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

// ============================================================================
// PROFILE
// ============================================================================
interface Profile {
  username: string;
  full_name: string;
  email: string;
  role: string;
}
interface LangOption {
  code: string;
  label: string;
}

interface PasswordPolicy {
  min_length: number;
  min_classes: number;
  classes: string[];
}

// Mirrors services/auth_service.validate_password so the user sees the verdict
// live, as they type. The server re-checks — this is guidance, never the gate.
function checkPasswordStrength(pw: string, policy: PasswordPolicy | null) {
  const min = policy?.min_length ?? 12;
  const lower = /[a-z]/.test(pw);
  const upper = /[A-Z]/.test(pw);
  const digit = /[0-9]/.test(pw);
  const special = /[^A-Za-z0-9]/.test(pw);
  const classes = [lower, upper, digit, special].filter(Boolean).length;
  const longEnough = pw.length >= min;
  return {
    min,
    longEnough,
    lower,
    upper,
    digit,
    special,
    classes,
    ok: longEnough && classes >= (policy?.min_classes ?? 3),
  };
}

function ProfileTab() {
  const t = useT();
  const toast = useToast();
  const { refresh } = useAuth();
  const { setLang } = useI18n();
  const [p, setP] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [cnf, setCnf] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [policy, setPolicy] = useState<PasswordPolicy | null>(null);
  const [langs, setLangs] = useState<LangOption[]>([]);
  const [curLang, setCurLang] = useState("tr");
  const [msg, setMsg] = useState<{ ok: boolean; m: string }>({ ok: true, m: "" });
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; m: string }>({ ok: true, m: "" });

  const strength = useMemo(() => checkPasswordStrength(nw, policy), [nw, policy]);
  const pwMatches = nw.length > 0 && nw === cnf;

  const load = useCallback(() => {
    apiGet<Profile>("/api/profile")
      .then((d) => {
        setP(d);
        setFullName(d.full_name || "");
        setEmail(d.email || "");
      })
      .catch(() => {});
    apiGet<{ options: LangOption[]; current: string }>("/api/profile/languages")
      .then((d) => {
        setLangs(d.options || []);
        setCurLang(d.current || "tr");
      })
      .catch(() => {});
    apiGet<PasswordPolicy>("/api/auth/password-policy")
      .then(setPolicy)
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  // Backend error keys carry a raw "{n}" placeholder for the configured
  // minimum length — t() does no interpolation, so fill it in here.
  const errText = (key: string) => t(key).replace("{n}", String(policy?.min_length ?? 12));

  async function run(fn: () => Promise<void>, okMsg: string) {
    setMsg({ ok: true, m: "" });
    try {
      await fn();
      setMsg({ ok: true, m: okMsg });
      toast.success(okMsg);
    } catch (e: any) {
      setMsg({ ok: false, m: errText(e?.key || "error") });
    }
  }

  async function changePassword() {
    setPwMsg({ ok: true, m: "" });
    if (!pwMatches) {
      setPwMsg({ ok: false, m: f(t, "passwords_no_match", "Passwords do not match.") });
      return;
    }
    if (!strength.ok) {
      setPwMsg({
        ok: false,
        m: f(t, "password_too_simple_hint", "Please add all necessary characters to create safe password."),
      });
      return;
    }
    try {
      await apiPut("/api/profile/password", {
        current_password: cur,
        new_password: nw,
        confirm_password: cnf,
      });
      setCur("");
      setNw("");
      setCnf("");
      setPwMsg({ ok: true, m: "" });
      toast.success(f(t, "saved", "Saved"));
    } catch (e: any) {
      setPwMsg({ ok: false, m: errText(e?.key || "error") });
    }
  }

  const rule = (ok: boolean, label: string) => (
    <div className={`flex items-center gap-1.5 text-xs ${ok ? "text-muted" : "text-danger"}`}>
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${ok ? "bg-muted" : "bg-danger"}`} />
      {label}
    </div>
  );

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <SectionCard title={f(t, "tab_profile", "Profile")} icon="badge">
        <div className="text-xs text-muted">
          {f(t, "username", "Username")}: <span className="text-ink font-medium">{p?.username || "—"}</span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={f(t, "full_name", "Full Name")} full>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} />
          </Field>
        </div>
        <button
          className="btn btn-primary w-full"
          onClick={() =>
            run(async () => {
              await apiPut("/api/profile/full-name", { full_name: fullName });
              await refresh();
              load();
            }, f(t, "saved", "Saved"))
          }
        >
          {f(t, "update_btn", "Save")}
        </button>
      </SectionCard>

      <SectionCard title={f(t, "email", "Email")} icon="mail">
        <Field label={f(t, "email", "Email")} full>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        <button
          className="btn btn-primary w-full"
          onClick={() =>
            run(async () => {
              await apiPut("/api/profile/email", { email });
              await refresh();
              load();
            }, f(t, "saved", "Saved"))
          }
        >
          {f(t, "update_btn", "Save")}
        </button>
      </SectionCard>

      <SectionCard title={f(t, "change_password", "Change Password")} icon="lock">
        <Field label={f(t, "current_password", "Current Password")} full>
          <div className="flex items-center gap-2">
            <input
              type={showPw ? "text" : "password"}
              value={cur}
              onChange={(e) => setCur(e.target.value)}
              autoComplete="current-password"
              className={`flex-1 min-w-0 ${cur ? "!border-ok" : ""}`}
            />
            {cur && <span className="msr text-[18px] text-ok">check_circle</span>}
          </div>
        </Field>
        <Field label={f(t, "new_password", "New Password")} full>
          <div className="flex items-center gap-2">
            <input
              type={showPw ? "text" : "password"}
              value={nw}
              onChange={(e) => setNw(e.target.value)}
              autoComplete="new-password"
              className={`flex-1 min-w-0 ${nw ? (strength.ok ? "!border-ok" : "!border-danger") : ""}`}
            />
            <button
              type="button"
              className="btn !p-2"
              onClick={() => setShowPw((v) => !v)}
              aria-label={showPw ? "hide password" : "show password"}
            >
              <span className="msr text-[16px]">{showPw ? "visibility_off" : "visibility"}</span>
            </button>
          </div>
        </Field>

        {nw && !strength.ok && (
          <div className="col-span-2 space-y-1.5">
            <div className="text-xs text-danger">
              {f(t, "password_too_simple_hint", "Please add all necessary characters to create safe password.")}
            </div>
            <div className="space-y-1">
              {rule(strength.longEnough, f(t, "password_min_chars", `Minimum characters ${strength.min}`).replace("{n}", String(strength.min)))}
              {rule(strength.upper, f(t, "password_need_upper", "One uppercase character"))}
              {rule(strength.lower, f(t, "password_need_lower", "One lowercase character"))}
              {rule(strength.special, f(t, "password_need_special", "One special character"))}
              {rule(strength.digit, f(t, "password_need_digit", "One number"))}
            </div>
          </div>
        )}

        <Field label={f(t, "confirm_password", "Confirm Password")} full>
          <input
            type={showPw ? "text" : "password"}
            value={cnf}
            onChange={(e) => setCnf(e.target.value)}
            autoComplete="new-password"
            className={cnf ? (pwMatches ? "!border-ok" : "!border-danger") : ""}
          />
          {cnf.length > 0 && !pwMatches && (
            <div className="text-xs text-danger mt-1">
              {f(t, "passwords_no_match", "Passwords do not match.")}
            </div>
          )}
        </Field>

        <Notice ok={pwMsg.ok} msg={pwMsg.m} />

        <button
          className="btn btn-primary w-full"
          disabled={!cur || !nw || !cnf || !strength.ok || !pwMatches}
          onClick={changePassword}
        >
          {f(t, "update_btn", "Save")}
        </button>
      </SectionCard>

      <SectionCard title={f(t, "tab_language", "Language")} icon="translate">
        <div className="space-y-2">
          {langs.map((l) => (
            <label
              key={l.code}
              className="flex items-center gap-2 text-sm cursor-pointer"
            >
              <input
                type="radio"
                name="lang"
                className="!w-auto"
                checked={curLang === l.code}
                onChange={() => setCurLang(l.code)}
              />
              {l.label}
            </label>
          ))}
        </div>
        <button
          className="btn btn-primary w-full"
          onClick={() =>
            run(async () => {
              await apiPut("/api/profile/language", { lang: curLang });
              setLang(curLang);
              await refresh();
            }, f(t, "saved", "Saved"))
          }
        >
          {f(t, "update_btn", "Save")}
        </button>
      </SectionCard>

      <div className="lg:col-span-2">
        <Notice ok={msg.ok} msg={msg.m} />
      </div>
    </div>
  );
}

// ============================================================================
// USERS
// ============================================================================
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

function UsersTab() {
  const t = useT();
  const toast = useToast();
  const { requestDelete } = useDeleteUndo();
  const [rows, setRows] = useState<UserRow[]>([]);
  const [roles, setRoles] = useState<AssignableRole[]>([]);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; m: string }>({ ok: true, m: "" });
  const [resetInfo, setResetInfo] = useState<{ user: string; pw: string } | null>(null);

  const load = useCallback(() => {
    apiGet<UserRow[]>("/api/users").then(setRows).catch(() => {});
    apiGet<AssignableRole[]>("/api/users/assignable-roles").then(setRoles).catch(() => {});
  }, []);
  useEffect(load, [load]);

  const roleLabel = (key: string, fb: string) => (key ? f(t, key, fb) : fb);

  async function act(fn: () => Promise<void>, okMsg?: string) {
    setMsg({ ok: true, m: "" });
    try {
      await fn();
      if (okMsg) toast.success(okMsg);
      load();
    } catch (e: any) {
      setMsg({ ok: false, m: t(e?.key || "error") });
    }
  }

  async function changeRole(u: UserRow, role: string) {
    if (role === u.role) return;
    await act(
      () => apiPut(`/api/users/${encodeURIComponent(u.username)}/role`, { role }),
      f(t, "role_updated", "Role updated.")
    );
  }
  async function toggleActive(u: UserRow) {
    await act(
      () => apiPut(`/api/users/${encodeURIComponent(u.username)}/active`, { active: !u.is_active }),
      u.is_active ? f(t, "user_deactivated", "User deactivated.") : f(t, "user_activated", "User activated.")
    );
  }
  function del(u: UserRow) {
    let idx = -1;
    requestDelete({
      title: f(t, "delete_btn", "Delete"),
      message: `${f(t, "delete_btn", "Delete")}: ${u.username}?`,
      onRemove: () =>
        setRows((prev) => {
          idx = prev.findIndex((r) => r.username === u.username);
          return prev.filter((r) => r.username !== u.username);
        }),
      onRestore: () =>
        setRows((prev) => {
          if (prev.some((r) => r.username === u.username)) return prev;
          const next = [...prev];
          next.splice(idx < 0 ? next.length : idx, 0, u);
          return next;
        }),
      onCommit: async () => {
        await apiDel(`/api/users/${encodeURIComponent(u.username)}`);
        load();
      },
      successMessage: f(t, "user_deleted", "User deleted."),
      errorMessage: t("error"),
    });
  }
  async function resetPw(u: UserRow) {
    setMsg({ ok: true, m: "" });
    try {
      const r = await apiPost<{ sent: boolean; recipient: string; new_password: string }>(
        `/api/users/${encodeURIComponent(u.username)}/reset-password`
      );
      if (r.sent) {
        setMsg({ ok: true, m: `${f(t, "recover_sent", "Email sent")}: ${r.recipient}` });
        toast.success(`${f(t, "recover_sent", "Email sent")}: ${r.recipient}`);
      } else {
        setResetInfo({ user: u.username, pw: r.new_password });
      }
    } catch (e: any) {
      setMsg({ ok: false, m: t(e?.key || "error") });
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">{f(t, "tab_users", "Users")}</h2>
        <button className="btn btn-primary" onClick={() => setAdding(true)}>
          <span className="msr text-[18px]">person_add</span>
          {f(t, "add_user", "Add User")}
        </button>
      </div>
      <Notice ok={msg.ok} msg={msg.m} />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-line">
              <th className="p-3">{f(t, "username", "Username")}</th>
              <th className="p-3">{f(t, "full_name", "Name")}</th>
              <th className="p-3">{f(t, "email", "Email")}</th>
              <th className="p-3">{f(t, "col_role", "Role")}</th>
              <th className="p-3">{f(t, "col_status", "Status")}</th>
              <th className="p-3 text-right">{f(t, "actions", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const canEdit = u.in_scope && !u.locked && !u.is_me;
              return (
                <tr key={u.username} className="border-b border-line last:border-0">
                  <td className="p-3 font-medium">
                    {u.username}
                    {u.is_me && (
                      <span className="badge badge-info ml-1">{f(t, "you", "you")}</span>
                    )}
                  </td>
                  <td className="p-3">{u.full_name || "—"}</td>
                  <td className="p-3 text-muted">{u.email || "—"}</td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5">
                      <span className="msr text-[16px] text-muted" title={f(t, "col_role", "Role")}>
                        badge
                      </span>
                      <select
                        className="!py-1 text-xs"
                        value={u.role}
                        disabled={!canEdit || roles.length === 0}
                        onChange={(e) => changeRole(u, e.target.value)}
                      >
                      {roles.find((r) => r.role === u.role) === undefined && (
                        <option value={u.role}>
                          {roleLabel(u.role_label_key, u.role)}
                        </option>
                      )}
                      {roles.map((r) => (
                        <option key={r.role} value={r.role}>
                          {roleLabel(r.label_key, r.role)}
                        </option>
                      ))}
                      </select>
                    </div>
                  </td>
                  <td className="p-3">
                    <span className={`badge ${u.is_active ? "badge-ok" : "badge-archived"}`}>
                      {u.is_active ? f(t, "active", "Active") : f(t, "inactive", "Inactive")}
                    </span>
                    {u.locked && (
                      <span className="badge badge-warn ml-1">
                        <span className="msr text-[12px]">lock</span>
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-1.5 justify-end flex-wrap">
                      <button
                        className="btn !py-1 !px-2.5 text-xs"
                        disabled={!canEdit}
                        onClick={() => toggleActive(u)}
                      >
                        {u.is_active ? f(t, "deactivate", "Deactivate") : f(t, "activate", "Activate")}
                      </button>
                      <button
                        className="btn !py-1 !px-2.5 text-xs"
                        disabled={u.locked}
                        onClick={() => resetPw(u)}
                      >
                        <span className="msr text-[15px]">key</span>
                      </button>
                      <button
                        className="btn btn-danger !py-1 !px-2.5 text-xs"
                        disabled={!canEdit}
                        onClick={() => del(u)}
                      >
                        <span className="msr text-[15px]">delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td className="p-3 text-muted text-sm" colSpan={6}>
                  {f(t, "no_results", "No users")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {adding && (
        <Modal title={f(t, "add_user", "Add User")} onClose={() => setAdding(false)}>
          <AddUserForm
            roles={roles}
            roleLabel={roleLabel}
            onDone={() => {
              setAdding(false);
              load();
            }}
          />
        </Modal>
      )}

      {resetInfo && (
        <Modal title={f(t, "reset_password", "Reset Password")} onClose={() => setResetInfo(null)}>
          <div className="space-y-3">
            <div className="text-sm text-muted">
              {f(t, "recover_fallback", "New password (email not configured)")}: {resetInfo.user}
            </div>
            <div className="card p-3 font-mono text-lg text-center select-all">{resetInfo.pw}</div>
            <button className="btn btn-primary w-full" onClick={() => setResetInfo(null)}>
              {f(t, "close", "Close")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function AddUserForm({
  roles,
  roleLabel,
  onDone,
}: {
  roles: AssignableRole[];
  roleLabel: (key: string, fb: string) => string;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [f0, setF0] = useState({
    username: "",
    password: "",
    full_name: "",
    role: roles[0]?.role || "",
    email: "",
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, v: string) => setF0((p) => ({ ...p, [k]: v }));

  async function submit() {
    if (!f0.username.trim() || !f0.password.trim() || !f0.role) {
      setErr(f(t, "fields_required", "Fields required"));
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await apiPost("/api/users", f0);
      toast.success(f(t, "user_added", "User added."));
      onDone();
    } catch (e: any) {
      setErr(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={f(t, "username", "Username")}>
          <input value={f0.username} onChange={(e) => set("username", e.target.value)} />
        </Field>
        <Field label={f(t, "password", "Password")}>
          <input type="password" value={f0.password} onChange={(e) => set("password", e.target.value)} />
        </Field>
        <Field label={f(t, "full_name", "Full Name")} full>
          <input value={f0.full_name} onChange={(e) => set("full_name", e.target.value)} />
        </Field>
        <Field label={f(t, "email", "Email")} full>
          <input type="email" value={f0.email} onChange={(e) => set("email", e.target.value)} />
        </Field>
        <Field label={f(t, "col_role", "Role")} full>
          <select value={f0.role} onChange={(e) => set("role", e.target.value)}>
            {roles.map((r) => (
              <option key={r.role} value={r.role}>
                {roleLabel(r.label_key, r.role)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {err && <div className="text-sm text-danger">{err}</div>}
      <button className="btn btn-primary w-full" onClick={submit} disabled={busy}>
        {busy ? "…" : f(t, "add_btn", "Add")}
      </button>
    </div>
  );
}

// ============================================================================
// BUSINESS
// ============================================================================
interface BusinessInfo {
  business_name: string;
  has_logo: boolean;
  has_stamp: boolean;
  phone: string;
  address: string;
  maps_url: string;
  email: string;
  iban: string;
  pay_qr_enabled: boolean;
  currency: string;
  exchange_rate: number;
}

const CURRENCY_OPTIONS = [
  { value: "EUR", label: "EUR — €" },
  { value: "ALL", label: "ALL — Lek" },
];

function ImageUploader({
  label,
  has,
  imgPath,
  uploadPath,
  onChange,
}: {
  label: string;
  has: boolean;
  imgPath: string;
  uploadPath: string;
  onChange: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const { requestDelete } = useDeleteUndo();
  const [busy, setBusy] = useState(false);
  const [bust, setBust] = useState(Date.now());
  const [hidden, setHidden] = useState(false);

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api(uploadPath, { method: "POST", body: fd });
      setBust(Date.now());
      toast.success(`${label} — ${f(t, "saved", "Saved")}`);
      onChange();
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }
  function remove() {
    requestDelete({
      title: f(t, "remove", "Remove"),
      message: `${label} — ${f(t, "confirm_remove_image", "Remove this image? This cannot be undone.")}`,
      onRemove: () => setHidden(true),
      onRestore: () => setHidden(false),
      onCommit: async () => {
        setBusy(true);
        try {
          await apiDel(uploadPath);
          onChange();
        } finally {
          setBusy(false);
        }
      },
      successMessage: `${label} — ${f(t, "removed", "Removed")}`,
      errorMessage: t("error"),
    });
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted">{label}</div>
      {has && !hidden && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${apiBase()}${imgPath}?b=${bust}`}
          alt={label}
          className="max-h-20 rounded-lg border border-line bg-white p-1"
        />
      )}
      <div className="flex items-center gap-2">
        <label className="btn !py-1.5 !px-3 text-xs cursor-pointer">
          <span className="msr text-[16px]">upload</span>
          {f(t, "upload", "Upload")}
          <input
            type="file"
            accept="image/*"
            className="hidden !w-auto"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload(file);
              e.target.value = "";
            }}
          />
        </label>
        {has && !hidden && (
          <button className="btn btn-danger !py-1.5 !px-3 text-xs" disabled={busy} onClick={remove}>
            {f(t, "remove", "Remove")}
          </button>
        )}
      </div>
    </div>
  );
}

interface ThemeData {
  theme: Record<string, string>;
  fonts: string[];
  defaults: Record<string, string>;
}
const THEME_COLOR_KEYS: { key: string; label: string; fb: string }[] = [
  { key: "primary", label: "theme_primary", fb: "Primary" },
  { key: "secondary", label: "theme_secondary", fb: "Secondary" },
  { key: "success", label: "theme_success", fb: "Success" },
  { key: "warning", label: "theme_warning", fb: "Warning" },
  { key: "alert", label: "theme_alert", fb: "Alert" },
  { key: "disabled", label: "theme_disabled", fb: "Disabled" },
  { key: "bg", label: "theme_bg", fb: "Background" },
];
// The two colours mixed into the gradient painted on a reservation's timeline bar
// / card header once its rental has started (see .cal-bar--started / .client-bar-
// started in globals.css) — kept in their own list so they can render with a live
// gradient preview instead of a single swatch.
const BAR_GRADIENT_KEYS: { key: string; label: string; fb: string }[] = [
  { key: "bar_gradient_start", label: "theme_bar_gradient_start", fb: "Started-rental bar — gradient start" },
  { key: "bar_gradient_end", label: "theme_bar_gradient_end", fb: "Started-rental bar — gradient end" },
];

function ThemeDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const toast = useToast();
  const { refreshTheme } = useTheme();
  const [data, setData] = useState<ThemeData | null>(null);
  const [v, setV] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    apiGet<ThemeData>("/api/settings/theme")
      .then((d) => {
        setData(d);
        setV({ ...d.defaults, ...d.theme });
      })
      .catch(() => {});
  }, []);

  const set = (k: string, val: string) => setV((p) => ({ ...p, [k]: val }));

  async function save() {
    setBusy(true);
    setErr("");
    try {
      await apiPut("/api/settings/theme", v);
      refreshTheme(); // apply new brand colours/font immediately
      toast.success(f(t, "theme_saved", "Theme saved."));
      onClose();
    } catch (e: any) {
      setErr(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  async function reset() {
    setBusy(true);
    setErr("");
    try {
      await apiPost("/api/settings/theme/reset");
      refreshTheme(); // revert to defaults immediately
      toast.success(f(t, "theme_reset", "Theme reset to defaults."));
      onClose();
    } catch (e: any) {
      setErr(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={f(t, "select_theme", "Select Theme")} onClose={onClose} wide>
      <div className="space-y-3">
        <Field label={f(t, "theme_font", "Font")} full>
          <select value={v.font || ""} onChange={(e) => set("font", e.target.value)}>
            {(data?.fonts || []).map((fn) => (
              <option key={fn} value={fn}>
                {fn}
              </option>
            ))}
          </select>
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {THEME_COLOR_KEYS.map((c) => (
            <Field key={c.key} label={f(t, c.label, c.fb)}>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  className="!w-10 !p-0.5 h-9"
                  value={v[c.key] || "#000000"}
                  onChange={(e) => set(c.key, e.target.value)}
                />
                <input
                  className="flex-1 font-mono text-xs"
                  value={v[c.key] || ""}
                  onChange={(e) => set(c.key, e.target.value)}
                />
              </div>
            </Field>
          ))}
        </div>

        {/* Started-rental bar gradient — a dedicated pair (not single swatches)
            since the two colours are mixed together; a live preview strip shows
            the resulting gradient as either colour changes. */}
        <div className="pt-1">
          <div className="text-xs font-semibold text-muted mb-2">
            {f(t, "theme_bar_gradient_title", "Active Rental Bar Gradient")}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {BAR_GRADIENT_KEYS.map((c) => (
              <Field key={c.key} label={f(t, c.label, c.fb)}>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    className="!w-10 !p-0.5 h-9"
                    value={v[c.key] || "#ffffff"}
                    onChange={(e) => set(c.key, e.target.value)}
                  />
                  <input
                    className="flex-1 font-mono text-xs"
                    value={v[c.key] || ""}
                    onChange={(e) => set(c.key, e.target.value)}
                  />
                </div>
              </Field>
            ))}
          </div>
          <div
            className="mt-2 h-9 rounded-[8px] border border-line"
            style={{
              background: `linear-gradient(135deg, ${v.bar_gradient_start || "#ffffff"} 0%, ${
                v.bar_gradient_end || "#bae6fd"
              } 100%)`,
            }}
            title={f(t, "theme_bar_gradient_preview", "Preview")}
          />
        </div>

        {err && <div className="text-sm text-danger">{err}</div>}
        <div className="flex items-center gap-2">
          <button className="btn btn-primary flex-1" onClick={save} disabled={busy}>
            {busy ? "…" : f(t, "theme_save_btn", "Save")}
          </button>
          <button className="btn flex-1" onClick={reset} disabled={busy}>
            {f(t, "theme_reset_btn", "Reset to defaults")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function BusinessTab() {
  const t = useT();
  const toast = useToast();
  const { user } = useAuth();
  const isSuper = can(user, "edit_business_settings");
  const [b, setB] = useState<BusinessInfo | null>(null);
  const [name, setName] = useState("");
  const [themeOpen, setThemeOpen] = useState(false);
  const [contact, setContact] = useState({
    phone: "",
    email: "",
    address: "",
    maps_url: "",
    iban: "",
    pay_qr_enabled: false,
  });
  const [currency, setCurrency] = useState({
    currency: "EUR",
    exchange_rate: DEFAULT_EUR_ALL_RATE,
  });
  // Saving the display currency has to update the app-wide context too, or the
  // rest of the UI keeps formatting money the old way until a page reload.
  const { refresh: refreshCurrency } = useCurrency();
  const [msg, setMsg] = useState<{ ok: boolean; m: string }>({ ok: true, m: "" });

  const load = useCallback(() => {
    apiGet<BusinessInfo>("/api/settings/business")
      .then((d) => {
        setB(d);
        setName(d.business_name || "");
        setContact({
          phone: d.phone || "",
          email: d.email || "",
          address: d.address || "",
          maps_url: d.maps_url || "",
          iban: d.iban || "",
          pay_qr_enabled: !!d.pay_qr_enabled,
        });
        setCurrency({
          currency: d.currency || "EUR",
          exchange_rate: d.exchange_rate || DEFAULT_EUR_ALL_RATE,
        });
      })
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function run(fn: () => Promise<void>, okMsg: string) {
    setMsg({ ok: true, m: "" });
    try {
      await fn();
      setMsg({ ok: true, m: okMsg });
      toast.success(okMsg);
    } catch (e: any) {
      setMsg({ ok: false, m: t(e?.key || "error") });
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {isSuper && (
        <SectionCard title={f(t, "business_name", "Business Name")} icon="storefront">
          <Field label={f(t, "business_name", "Business Name")} full>
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <button
            className="btn btn-primary w-full"
            onClick={() =>
              run(async () => {
                await apiPut("/api/settings/business/name", { name });
                load();
              }, f(t, "saved", "Saved"))
            }
          >
            {f(t, "update_btn", "Save")}
          </button>
        </SectionCard>
      )}

      {isSuper && (
        <SectionCard title={f(t, "currency_settings", "Currency")} icon="payments">
          <div className="text-xs text-muted">
            {f(t, "currency_help", "Amounts are always stored in EUR; this only controls which currency is shown.")}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label={f(t, "currency_label", "Display Currency")}>
              <select
                value={currency.currency}
                onChange={(e) => setCurrency((p) => ({ ...p, currency: e.target.value }))}
              >
                {CURRENCY_OPTIONS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={f(t, "currency_rate_label", "Exchange rate (1 EUR = ? ALL)")}>
              <input
                type="number"
                min={0.01}
                step="0.01"
                value={Number.isFinite(currency.exchange_rate) ? currency.exchange_rate : ""}
                onChange={(e) =>
                  // NaN, not 0, for an empty field: the server rejects a
                  // non-positive rate, so a cleared box must fail loudly rather
                  // than post a 0 that used to be silently rewritten to 92.
                  setCurrency((p) => ({ ...p, exchange_rate: parseFloat(e.target.value) }))
                }
              />
            </Field>
          </div>
          <button
            className="btn btn-primary w-full"
            disabled={!(currency.exchange_rate > 0)}
            onClick={() =>
              run(async () => {
                await apiPut("/api/settings/business/currency", currency);
                load();
                await refreshCurrency();
              }, f(t, "saved", "Saved"))
            }
          >
            {f(t, "update_btn", "Save")}
          </button>
        </SectionCard>
      )}

      <SectionCard title={f(t, "business_contact", "Business Contact & Invoice QR")} icon="contact_page">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={f(t, "phone", "Phone")}>
            <input value={contact.phone} onChange={(e) => setContact((p) => ({ ...p, phone: e.target.value }))} />
          </Field>
          <Field label={f(t, "email", "Email")}>
            <input value={contact.email} onChange={(e) => setContact((p) => ({ ...p, email: e.target.value }))} />
          </Field>
          <Field label={f(t, "address", "Address")} full>
            <input value={contact.address} onChange={(e) => setContact((p) => ({ ...p, address: e.target.value }))} />
          </Field>
          <Field label={f(t, "maps_url", "Maps URL")} full>
            <input value={contact.maps_url} onChange={(e) => setContact((p) => ({ ...p, maps_url: e.target.value }))} />
          </Field>
          {isSuper && (
            <>
              <Field label={f(t, "iban", "IBAN")} full>
                <input value={contact.iban} onChange={(e) => setContact((p) => ({ ...p, iban: e.target.value }))} />
              </Field>
              <label className="col-span-2 flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  className="!w-auto"
                  checked={contact.pay_qr_enabled}
                  onChange={(e) => setContact((p) => ({ ...p, pay_qr_enabled: e.target.checked }))}
                />
                {f(t, "pay_qr_enabled", "Enable pay-the-balance QR on invoices")}
              </label>
            </>
          )}
        </div>
        <button
          className="btn btn-primary w-full"
          onClick={() =>
            run(async () => {
              const payload: any = {
                phone: contact.phone,
                email: contact.email,
                address: contact.address,
                maps_url: contact.maps_url,
              };
              if (isSuper) {
                payload.iban = contact.iban;
                payload.pay_qr_enabled = contact.pay_qr_enabled;
              }
              await apiPut("/api/settings/business/contact", payload);
              load();
            }, f(t, "saved", "Saved"))
          }
        >
          {f(t, "update_btn", "Save")}
        </button>
      </SectionCard>

      <SectionCard title={f(t, "company_logo", "Company Logo")} icon="image">
        <ImageUploader
          label={f(t, "company_logo", "Company Logo")}
          has={!!b?.has_logo}
          imgPath="/api/settings/logo.png"
          uploadPath="/api/settings/logo"
          onChange={load}
        />
      </SectionCard>

      <SectionCard title={f(t, "company_stamp", "Company Stamp / Seal")} icon="verified">
        <ImageUploader
          label={f(t, "company_stamp", "Company Stamp / Seal")}
          has={!!b?.has_stamp}
          imgPath="/api/settings/stamp.png"
          uploadPath="/api/settings/stamp"
          onChange={load}
        />
      </SectionCard>

      {isSuper && (
        <SectionCard title={f(t, "select_theme", "Select Theme")} icon="palette">
          <div className="text-xs text-muted">
            {f(t, "theme_help", "Customize the app's font and brand colours. Applies to everyone.")}
          </div>
          <button className="btn btn-primary w-full" onClick={() => setThemeOpen(true)}>
            <span className="msr text-[18px]">palette</span>
            {f(t, "select_theme", "Select Theme")}
          </button>
        </SectionCard>
      )}

      {themeOpen && <ThemeDialog onClose={() => setThemeOpen(false)} />}

      <div className="lg:col-span-2">
        <Notice ok={msg.ok} msg={msg.m} />
      </div>
    </div>
  );
}

// ============================================================================
// LICENSE
// ============================================================================
interface LicenseRow {
  license_id: number;
  licensee: string;
  year: number;
  years: number;
  amount: number;
  purchase_date: string;
  notes: string;
}
const blankLicense = {
  licensee: "",
  year: new Date().getFullYear(),
  years: 1,
  amount_eur: 0,
  purchase_date: "",
  notes: "",
};

interface LicenseActivityRow {
  id: number;
  username: string;
  action: string;
  entity: string;
  entity_id: string;
  detail: string;
  ts: string;
}

// Feature areas this app actually has — every licence covers all of them
// today (no per-plan gating exists), so the checklist is informational.
// Icons reuse the same Material Symbols the sidebar already uses per section.
const LICENSE_FEATURES = [
  { code: "fleet", icon: "directions_car" },
  { code: "reservations", icon: "event" },
  { code: "customers", icon: "group" },
  { code: "finance", icon: "payments" },
  { code: "reports", icon: "bar_chart" },
  { code: "invoices", icon: "receipt_long" },
] as const;

type LicenseState = "active" | "grace" | "read_only" | "missing";

function computeLicenseState(status: {
  licensed_year: number;
  days_left: number;
  grace_days: number;
} | null): { state: LicenseState; expiresAt: Date | null; graceDaysLeft: number } {
  if (!status) return { state: "missing", expiresAt: null, graceDaysLeft: 0 };
  const expiresAt = new Date(status.licensed_year, 11, 31, 23, 59, 59);
  if (status.days_left >= 0) return { state: "active", expiresAt, graceDaysLeft: 0 };
  const daysPastExpiry = -status.days_left;
  const graceDaysLeft = status.grace_days - daysPastExpiry;
  if (graceDaysLeft > 0) return { state: "grace", expiresAt, graceDaysLeft };
  return { state: "read_only", expiresAt, graceDaysLeft: 0 };
}

const LICENSE_STATE_BADGE: Record<LicenseState, string> = {
  active: "badge-ok",
  grace: "badge-warn",
  read_only: "badge-danger",
  missing: "badge-archived",
};

function licenseActivityLabel(t: (k: string) => string, action: string): string {
  const key = `lic_activity_${action}`;
  const translated = t(key);
  if (translated !== key) return translated;
  return action.replace(/_/g, " ");
}

// Dot colour per audit action — green for grants/activations, blue for a
// direct override, red for a deletion. Anything unrecognised falls back to
// the neutral "info" blue rather than guessing at severity.
const LICENSE_ACTIVITY_DOT: Record<string, string> = {
  generate_license_key: "bg-lic-ok",
  redeem_license: "bg-lic-ok",
  add_license: "bg-lic-ok",
  set_licensed_year: "bg-lic-info-ink",
  set_grace_days: "bg-lic-info-ink",
  edit_license: "bg-cal-warn",
  delete_license: "bg-danger",
};

function licenseActivityDetail(t: (k: string) => string, row: LicenseActivityRow): string {
  const key = `lic_activity_detail_${row.action}`;
  const raw = t(key);
  const template = raw === key ? "" : raw;
  if (template) {
    return template.replace("{year}", row.entity_id || "").replace("{detail}", row.detail || "");
  }
  return row.detail || row.entity_id || "";
}

function monthGrid(year: number, month: number): (number | null)[][] {
  const first = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startWeekday = (first.getDay() + 6) % 7; // Monday-first
  const cells: (number | null)[] = Array(startWeekday).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

function CopyableField({ label, value }: { label: string; value: string }) {
  const t = useT();
  return (
    <div>
      <div className="text-xs text-muted mb-1">{label}</div>
      {/* The copy glyph stays 28px so it sits inside the field; its tap area is
          padded out to 44px via the ::after overlay, matching the touch-target
          floor the mobile CSS layer applies to inputs and labels app-wide. */}
      <div className="relative">
        <input
          readOnly
          value={value}
          className="w-full font-mono text-xs select-all !pr-9"
          onFocus={(e) => e.target.select()}
        />
        <button
          type="button"
          title={f(t, "copy", "Copy")}
          aria-label={`${f(t, "copy", "Copy")} — ${label}`}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 grid place-items-center rounded-lg text-muted hover:text-ink hover:bg-bg after:absolute after:-inset-2 after:content-['']"
          onClick={() => navigator.clipboard?.writeText(value)}
        >
          <span className="msr text-[15px]">content_copy</span>
        </button>
      </div>
    </div>
  );
}

/** A licence card: numbered step chip + title, optional info icon and right-side action. */
function StepCard({
  step,
  title,
  info,
  action,
  children,
}: {
  step: number;
  title: string;
  info?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0 h-6 w-6 grid place-items-center rounded-lg bg-bg border border-line text-[11px] font-semibold text-muted">
            {step}
          </span>
          <h2 className="text-sm font-semibold truncate">{title}</h2>
          {info && (
            <span className="msr text-[15px] text-muted shrink-0" title={info} aria-label={info}>
              info
            </span>
          )}
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

/** The soft blue explainer strip used under the status and grace cards. */
function LicenseInfoBanner({ title, body }: { title: string; body?: string }) {
  return (
    <div className="flex items-start gap-2.5 rounded-xl bg-lic-info-bg px-3 py-2.5">
      <span className="msr text-[16px] text-lic-info-ink shrink-0 mt-px">info</span>
      <div className="min-w-0">
        <div className="text-xs font-semibold text-lic-info-ink">{title}</div>
        {body && <div className="text-xs text-lic-info-ink/80 mt-0.5">{body}</div>}
      </div>
    </div>
  );
}

/** One bordered entitlement row: leading glyph, label, trailing granted/withheld mark. */
function EntitlementRow({ icon, label, granted }: { icon: string; label: string; granted: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl border border-line px-3 py-2.5">
      <div className="flex items-center gap-2 min-w-0">
        <span className="msr text-[16px] text-muted shrink-0">{icon}</span>
        <span className="text-sm text-ink truncate">{label}</span>
      </div>
      <span className={`msr text-[17px] shrink-0 ${granted ? "text-lic-ok" : "text-lic-off"}`}>
        {granted ? "check_circle" : "do_not_disturb_on"}
      </span>
    </div>
  );
}

function LicenseOverviewGrid({
  status,
  activity,
  yearSel,
  setYearSel,
  onUnlock,
  onGraceDaysSaved,
}: {
  status: {
    licensed_year: number;
    current_year: number;
    year_options: number[];
    days_left: number;
    renewal_due: boolean;
    grace_days: number;
    installation_id: string;
    license_key: string;
    redeemed_years: number[];
    issued_at: string | null;
    activated_at: string | null;
    latest_license: LicenseRow | null;
  };
  activity: LicenseActivityRow[];
  yearSel: number;
  setYearSel: (y: number) => void;
  onUnlock: () => void;
  onGraceDaysSaved: () => void;
}) {
  const t = useT();
  const { lang } = useI18n();
  const toast = useToast();
  const { state, expiresAt } = computeLicenseState(status);
  const latest = status.latest_license;

  // The bar spans this licence's start through the END of the following year, so
  // the locked stretch past expiry is visible rather than implied.
  const startAt = latest?.purchase_date
    ? new Date(latest.purchase_date)
    : new Date(status.licensed_year, 0, 1);
  const expiry = expiresAt ?? new Date(status.licensed_year, 11, 31);
  const barEnd = new Date(status.licensed_year + 1, 11, 31);
  const span = barEnd.getTime() - startAt.getTime();
  const pct = (d: Date) =>
    span > 0 ? Math.min(100, Math.max(0, ((d.getTime() - startAt.getTime()) / span) * 100)) : 0;
  const elapsedPct = pct(new Date());
  const expiryPct = pct(expiry);

  const [graceInput, setGraceInput] = useState(status.grace_days);
  const [graceBusy, setGraceBusy] = useState(false);
  useEffect(() => setGraceInput(status.grace_days), [status.grace_days]);

  const [activityExpanded, setActivityExpanded] = useState(false);
  const visibleActivity = activityExpanded ? activity.slice(0, 50) : activity.slice(0, 4);

  async function saveGraceDays() {
    setGraceBusy(true);
    try {
      await apiPut("/api/license/grace-days", { days: graceInput });
      toast.success(f(t, "saved", "Saved"));
      onGraceDaysSaved();
    } catch (e: any) {
      toast.error(t(e?.key || "error"));
    } finally {
      setGraceBusy(false);
    }
  }

  const stateLabel = f(t, `lic_state_${state}`, {
    active: "Active",
    grace: "Grace period",
    read_only: "Read-only",
    missing: "Not licensed",
  }[state]);
  const planLabel = f(t, "lic_plan_business", "Business");
  const headline = [latest?.licensee, planLabel, status.licensed_year].filter(Boolean).join(" ");
  const maxDateLabel = fmtDate(expiry.toISOString(), lang);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* 1 — Licence status */}
      <StepCard step={1} title={f(t, "lic_status_title", "Licence status")}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-2">
            <span
              className={`inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-xs font-medium ${
                state === "active"
                  ? "bg-lic-ok-bg text-lic-ok-ink"
                  : state === "grace"
                  ? "bg-warn/15 text-warn"
                  : state === "read_only"
                  ? "bg-danger/12 text-danger"
                  : "bg-lic-off-bg text-lic-off"
              }`}
            >
              <span className="msr text-[14px]">
                {state === "active" ? "check_circle" : state === "missing" ? "do_not_disturb_on" : "error"}
              </span>
              {stateLabel}
            </span>
            <div className="text-lg font-semibold text-ink leading-tight truncate">{headline}</div>
            <div className="text-xs text-muted flex items-center gap-1.5">
              <span className="msr text-[14px]">calendar_month</span>
              {f(t, "lic_valid_from", "Valid from {d}").replace("{d}", fmtDate(startAt.toISOString(), lang))}
              {" · "}
              {f(t, "lic_expires_on", "Expires on {d}").replace("{d}", maxDateLabel)}
            </div>
          </div>
          <div className="shrink-0 rounded-xl bg-lic-ok-bg px-3 py-2 text-center">
            <div className="text-xl font-semibold text-lic-ok-ink leading-none">
              {Math.max(0, status.days_left)}
            </div>
            <div className="text-[11px] text-lic-ok-ink/80 mt-1">
              {f(t, "lic_days_remaining", "Days remaining")}
            </div>
          </div>
        </div>

        <div className="space-y-1.5">
          <div className="text-xs text-muted">{f(t, "lic_period_coverage", "Licence period coverage")}</div>
          <div className="relative h-1.5 rounded-full bg-lic-off-bg">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-lic-ok"
              style={{ width: `${elapsedPct}%` }}
            />
            {/* Everything past expiry is locked — mark the boundary, not just the end. */}
            <div
              className="absolute -top-1 h-3.5 w-px bg-lic-off"
              style={{ left: `${expiryPct}%` }}
              aria-hidden
            />
            <span
              className="msr text-[13px] text-lic-off absolute -top-[7px]"
              style={{ left: `calc(${expiryPct}% + 3px)` }}
              aria-hidden
            >
              lock
            </span>
          </div>
          <div className="relative h-4 text-[10px] text-muted">
            <span className="absolute left-0">{fmtDate(startAt.toISOString(), lang)}</span>
            <span className="absolute -translate-x-1/2 whitespace-nowrap" style={{ left: `${expiryPct}%` }}>
              {maxDateLabel}
            </span>
            <span className="absolute right-0">{fmtDate(barEnd.toISOString(), lang)}</span>
          </div>
        </div>

        <LicenseInfoBanner
          title={f(t, "lic_reservations_until", "Reservations allowed until {d}").replace("{d}", maxDateLabel)}
          body={f(t, "lic_horizon_help", "The calendar and timeline booking horizon are limited by your licence.")}
        />

        <div className="flex items-end gap-3 flex-wrap pt-1 border-t border-line">
          <Field label={f(t, "unlock_year", "Unlock year")}>
            <select value={yearSel} onChange={(e) => setYearSel(+e.target.value)}>
              {(status.year_options || []).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </Field>
          <button className="btn btn-primary" onClick={onUnlock}>
            {f(t, "unlock_btn", "Unlock")}
          </button>
        </div>
      </StepCard>

      {/* 2 — Licence details */}
      <StepCard step={2} title={f(t, "lic_details_title", "Licence details")}>
        <div className="grid grid-cols-3 gap-3">
          <Field label={f(t, "lic_plan", "Licence plan")}>
            <select disabled value="business">
              <option value="business">{planLabel}</option>
            </select>
          </Field>
          <Field label={f(t, "lic_term", "Term")}>
            <select disabled value="annual">
              <option value="annual">{f(t, "lic_term_annual", "Annual")}</option>
            </select>
          </Field>
          <Field label={f(t, "lic_year", "Licence year")}>
            <select disabled value={status.licensed_year}>
              <option value={status.licensed_year}>{status.licensed_year}</option>
            </select>
          </Field>
        </div>
        <CopyableField label={f(t, "lic_key", "Licence key")} value={status.license_key} />
        <CopyableField label={f(t, "lic_installation_id", "Installation ID")} value={status.installation_id} />
        <div className="grid grid-cols-2 gap-4 pt-1">
          <div>
            <div className="text-xs text-muted">{f(t, "lic_issued_at", "Issued at")}</div>
            <div className="text-sm text-ink">{status.issued_at ? fmtDate(status.issued_at, lang) : "—"}</div>
          </div>
          <div>
            <div className="text-xs text-muted">{f(t, "lic_activated_at", "Activated at")}</div>
            <div className="text-sm text-ink">{status.activated_at ? fmtDate(status.activated_at, lang) : "—"}</div>
          </div>
        </div>
      </StepCard>

      {/* 3 — Reservation coverage */}
      <StepCard
        step={3}
        title={f(t, "lic_coverage_title", "Reservation coverage")}
        info={f(t, "lic_horizon_help", "The calendar and timeline booking horizon are limited by your licence.")}
      >
        <div className="text-xs text-muted">
          {f(t, "lic_coverage_help", "Bookings with checkout dates after {y} are blocked.").replace(
            "{y}",
            maxDateLabel
          )}
        </div>
        <CoverageCalendar expiresAt={expiry} lang={lang} />
        <div className="flex items-center gap-4 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-lic-ok inline-block" />
            {f(t, "lic_allowed", "Allowed")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-lic-off inline-block" />
            {f(t, "lic_blocked", "Blocked")}
          </span>
        </div>
        <div className="text-xs text-muted pt-3 border-t border-line">
          {f(t, "lic_coverage_footer", "Your timeline and calendar are limited to {y}.").replace(
            "{y}",
            maxDateLabel
          )}
        </div>
      </StepCard>

      {/* 4 — Feature entitlements */}
      <StepCard step={4} title={f(t, "lic_features_title", "Feature entitlements")}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
          {LICENSE_FEATURES.map(({ code, icon }) => (
            <EntitlementRow
              key={code}
              icon={icon}
              label={f(t, `lic_feature_${code}`, code[0].toUpperCase() + code.slice(1))}
              granted
            />
          ))}
        </div>
        <div className="text-xs text-muted">
          {f(t, "lic_features_help", "Feature availability is determined by your licence plan.")}
        </div>
      </StepCard>

      {/* 5 — Grace period & enforcement */}
      <StepCard step={5} title={f(t, "lic_grace_title", "Grace period & enforcement")}>
        <div className="flex gap-4">
          <div className="shrink-0 w-28 rounded-xl border border-line overflow-hidden text-center">
            <div className="text-[11px] text-muted bg-bg px-2 py-1.5 border-b border-line">
              {f(t, "lic_grace_short", "Grace period")}
            </div>
            <div className="px-2 py-3 space-y-2">
              <input
                type="number"
                min={0}
                max={90}
                value={graceInput}
                onChange={(e) => setGraceInput(+e.target.value)}
                aria-label={f(t, "lic_grace_days_label", "Grace period (days)")}
                className="w-full !text-2xl !font-semibold text-center !px-1"
              />
              <div className="text-[11px] text-muted leading-tight">
                {f(t, "lic_grace_days_after", "days after expiry")}
              </div>
              <button
                className="btn btn-primary w-full !py-1 !px-2 text-xs"
                disabled={graceBusy || graceInput === status.grace_days}
                onClick={saveGraceDays}
              >
                {f(t, "update_btn", "Save")}
              </button>
            </div>
          </div>
          <div className="min-w-0 space-y-3">
            <div>
              <div className="text-xs font-medium text-ink mb-1.5">
                {f(t, "lic_grace_during", "During the grace period you can:")}
              </div>
              <ul className="space-y-1.5 text-xs text-ink">
                <li className="flex items-center gap-1.5">
                  <span className="msr text-[15px] text-lic-ok shrink-0">check_circle</span>
                  {f(t, "lic_grace_access", "Access system and data")}
                </li>
                <li className="flex items-center gap-1.5">
                  <span className="msr text-[15px] text-lic-ok shrink-0">check_circle</span>
                  {f(t, "lic_grace_manage", "Create and manage reservations")}
                </li>
              </ul>
            </div>
          </div>
        </div>
        <LicenseInfoBanner
          title={f(t, "lic_grace_notice", "A reminder threshold only — this installation never locks you out.")}
        />
      </StepCard>

      {/* 6 — Licence activity */}
      <StepCard
        step={6}
        title={f(t, "lic_activity_title", "Licence activity")}
        action={
          activity.length > visibleActivity.length || activityExpanded ? (
            <button type="button" className="btn !py-1 !px-2.5 text-xs" onClick={() => setActivityExpanded((v) => !v)}>
              {activityExpanded ? f(t, "lic_show_less", "Show less") : f(t, "lic_view_all", "View all")}
            </button>
          ) : undefined
        }
      >
        <div className="space-y-3.5">
          {visibleActivity.map((row) => (
            <div key={row.id} className="flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${
                    LICENSE_ACTIVITY_DOT[row.action] || "bg-lic-info-ink"
                  }`}
                />
                <div className="min-w-0">
                  <div className="text-sm font-medium text-ink">{licenseActivityLabel(t, row.action)}</div>
                  <div className="text-xs text-muted truncate">{licenseActivityDetail(t, row)}</div>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-muted whitespace-nowrap">{fmtDate(row.ts, lang)}</div>
                <div className="text-[11px] text-muted">{row.username}</div>
              </div>
            </div>
          ))}
          {activity.length === 0 && (
            <div className="text-xs text-muted">{f(t, "no_results", "No records")}</div>
          )}
        </div>
      </StepCard>
    </div>
  );
}

/**
 * Two static months straddling the licence cutoff — the expiry month and the one
 * after it, so the allowed→blocked boundary is always what the reader sees.
 */
function CoverageCalendar({ expiresAt, lang }: { expiresAt: Date; lang: string }) {
  const months = [0, 1].map((offset) => {
    const d = new Date(expiresAt.getFullYear(), expiresAt.getMonth() + offset, 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const monthFmt = new Intl.DateTimeFormat(lang || "en", { month: "short", year: "numeric" });
  const weekdayFmt = new Intl.DateTimeFormat(lang || "en", { weekday: "narrow" });
  // 1 Jan 2024 was a Monday, so offsets 0..6 walk Mon..Sun — matching monthGrid.
  const weekdayLabels = [0, 1, 2, 3, 4, 5, 6].map((d) => weekdayFmt.format(new Date(2024, 0, 1 + d)));
  const sameDay = (a: Date, b: Date) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const firstBlocked = new Date(expiresAt.getFullYear(), expiresAt.getMonth(), expiresAt.getDate() + 1);

  return (
    <div className="grid grid-cols-2 gap-3">
      {months.map(({ year, month }) => (
        <div key={`${year}-${month}`}>
          <div className="text-[11px] font-semibold text-muted uppercase mb-1.5">
            {monthFmt.format(new Date(year, month, 1))}
          </div>
          <div className="grid grid-cols-7 gap-0.5 mb-1">
            {weekdayLabels.map((w, i) => (
              <div key={i} className="text-[9px] text-muted text-center">
                {w}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {monthGrid(year, month)
              .flat()
              .map((day, i) => {
                if (day == null) return <div key={i} className="h-5" />;
                const cell = new Date(year, month, day);
                const blocked = cell > expiresAt;
                const isCutoff = sameDay(cell, firstBlocked);
                const isLastAllowed = sameDay(cell, expiresAt);
                return (
                  <div
                    key={i}
                    title={cell.toLocaleDateString(lang || "en")}
                    className={`text-[10px] leading-none rounded grid place-items-center h-5 w-full ${
                      blocked ? "bg-lic-off-bg text-lic-off-ink" : "bg-lic-ok-bg text-lic-ok-ink"
                    } ${isLastAllowed ? "ring-1 ring-lic-ok font-semibold" : ""}`}
                  >
                    {isCutoff ? <span className="msr text-[11px]">lock</span> : day}
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

function LicenseTab() {
  const fmt = useMoney();
  const t = useT();
  const toast = useToast();
  const { requestDelete } = useDeleteUndo();
  const { lang } = useI18n();
  const { user } = useAuth();
  const canGenerate = can(user, "edit_business_settings");
  const canRedeem = roleLevel(user) >= 2;
  const [status, setStatus] = useState<{
    licensed_year: number;
    current_year: number;
    year_options: number[];
    days_left: number;
    renewal_due: boolean;
    grace_days: number;
    installation_id: string;
    license_key: string;
    redeemed_years: number[];
    issued_at: string | null;
    activated_at: string | null;
    latest_license: LicenseRow | null;
  } | null>(null);
  const [activity, setActivity] = useState<LicenseActivityRow[]>([]);
  const [yearSel, setYearSel] = useState<number>(0);
  const [rows, setRows] = useState<LicenseRow[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<LicenseRow | null>(null);
  const [smtp, setSmtp] = useState({ host: "", port: "", user: "", password: "", sender: "" });
  const [smtpConfigured, setSmtpConfigured] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; m: string }>({ ok: true, m: "" });
  // Key generator + redeem
  const thisYear = new Date().getFullYear();
  const [genYear, setGenYear] = useState<number>(thisYear);
  const [genKey, setGenKey] = useState("");
  const [redeemKey, setRedeemKey] = useState("");
  const [redeemMsg, setRedeemMsg] = useState<{ ok: boolean; m: string }>({ ok: true, m: "" });

  const refreshStatus = useCallback(() => {
    apiGet<typeof status>("/api/license/status")
      .then((d) => {
        setStatus(d);
        if (d) setYearSel(d.licensed_year);
      })
      .catch(() => {});
    apiGet<LicenseActivityRow[]>("/api/license/activity").then(setActivity).catch(() => {});
    // Every date picker in the app caps itself at the licensed year, so re-read
    // the shared cap here rather than leaving them stale until a page reload.
    refreshLicenseLimits();
  }, []);

  const load = useCallback(() => {
    // Status / records / SMTP are super-admin-only endpoints. An admin (super-admin's
    // child) only sees — and only needs — the Redeem section, so skip those calls for
    // non-super to avoid noisy 403s.
    if (!canGenerate) return;
    refreshStatus();
    apiGet<LicenseRow[]>("/api/licenses").then(setRows).catch(() => {});
    apiGet<any>("/api/smtp")
      .then((d) => {
        setSmtp({
          host: d.smtp_host || "",
          port: d.smtp_port || "",
          user: d.smtp_user || "",
          password: d.smtp_pass || "",
          sender: d.smtp_from || "",
        });
        setSmtpConfigured(!!d.is_configured);
      })
      .catch(() => {});
  }, [refreshStatus, canGenerate]);
  useEffect(load, [load]);

  async function generate() {
    setRedeemMsg({ ok: true, m: "" });
    try {
      const r = await apiPost<{ year: number; key: string }>("/api/license/generate-key", {
        year: genYear,
      });
      setGenKey(r.key);
      toast.success(`${f(t, "generate_key", "License key generated")} · ${r.year}`);
    } catch (e: any) {
      setGenKey("");
      setRedeemMsg({ ok: false, m: t(e?.key || "error") });
    }
  }

  async function redeem() {
    setRedeemMsg({ ok: true, m: "" });
    try {
      const r = await apiPost<{ ok: boolean; year: number; licensed_year: number }>(
        "/api/license/redeem",
        { key: redeemKey }
      );
      setRedeemKey("");
      if (canGenerate) refreshStatus();
      else refreshLicenseLimits();
      const okMsg = `${f(t, "year", "Year")} ${r.year} ${f(t, "activated", "activated")}`;
      setRedeemMsg({ ok: true, m: okMsg });
      toast.success(okMsg);
    } catch (e: any) {
      const fallback =
        e?.key === "invalid_key"
          ? "Invalid license key"
          : e?.key === "key_already_used"
          ? "This license key has already been used"
          : e?.key === "key_already_covered"
          ? "This year is already covered by your current license"
          : "Error";
      setRedeemMsg({ ok: false, m: f(t, e?.key || "error", fallback) });
    }
  }

  async function run(fn: () => Promise<void>, okMsg: string) {
    setMsg({ ok: true, m: "" });
    try {
      await fn();
      setMsg({ ok: true, m: okMsg });
      toast.success(okMsg);
    } catch (e: any) {
      setMsg({ ok: false, m: t(e?.key || "error") });
    }
  }

  function delLicense(r: LicenseRow) {
    let idx = -1;
    requestDelete({
      title: f(t, "delete_btn", "Delete"),
      message: `${f(t, "delete_btn", "Delete")}: ${r.licensee} (${r.year})?`,
      onRemove: () =>
        setRows((prev) => {
          idx = prev.findIndex((x) => x.license_id === r.license_id);
          return prev.filter((x) => x.license_id !== r.license_id);
        }),
      onRestore: () =>
        setRows((prev) => {
          if (prev.some((x) => x.license_id === r.license_id)) return prev;
          const next = [...prev];
          next.splice(idx < 0 ? next.length : idx, 0, r);
          return next;
        }),
      onCommit: async () => {
        await apiDel(`/api/licenses/${r.license_id}`);
        load();
      },
      successMessage: f(t, "deleted", "Deleted"),
      errorMessage: t("error"),
    });
  }

  return (
    <div className="space-y-4">
      <Notice ok={msg.ok} msg={msg.m} />

      {canGenerate && status && (
        <LicenseOverviewGrid
          status={status}
          activity={activity}
          yearSel={yearSel}
          setYearSel={setYearSel}
          onUnlock={() =>
            run(async () => {
              await apiPut("/api/license/year", { year: yearSel });
              load();
            }, f(t, "saved", "Saved"))
          }
          onGraceDaysSaved={refreshStatus}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {canGenerate && (
          <SectionCard title={f(t, "generate_key", "Generate License Key")} icon="vpn_key">
            <div className="flex items-end gap-3 flex-wrap">
              <Field label={f(t, "col_year", "Year")}>
                <select value={genYear} onChange={(e) => setGenYear(+e.target.value)}>
                  {Array.from({ length: 11 }, (_, i) => thisYear + i).map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </Field>
              <button className="btn btn-primary" onClick={generate}>
                {f(t, "generate_key_btn", "Generate Key")}
              </button>
            </div>
            {genKey && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <input
                    readOnly
                    value={genKey}
                    className="flex-1 font-mono text-xs select-all"
                    onFocus={(e) => e.target.select()}
                  />
                  <button
                    className="btn !py-1.5 !px-3 text-xs"
                    title={f(t, "copy", "Copy")}
                    onClick={() => navigator.clipboard?.writeText(genKey)}
                  >
                    <span className="msr text-[16px]">content_copy</span>
                  </button>
                </div>
                {status?.redeemed_years.includes(genYear) && (
                  <span className="badge badge-archived">{f(t, "lic_key_used", "Already used")}</span>
                )}
              </div>
            )}
          </SectionCard>
        )}

        {canRedeem && (
          <SectionCard title={f(t, "redeem_key", "Redeem License Key")} icon="key">
            <div className="text-xs text-muted">
              {f(t, "redeem_help", "Enter the license key your super-admin sent you to activate the next year's calendar.")}
            </div>
            <div className="flex items-end gap-3 flex-wrap">
              <Field label={f(t, "license_key", "License Key")} full>
                <input
                  value={redeemKey}
                  onChange={(e) => setRedeemKey(e.target.value)}
                  placeholder="BCR-…"
                  className="font-mono"
                />
              </Field>
              <button
                className="btn btn-primary"
                onClick={redeem}
                disabled={!redeemKey.trim()}
              >
                {f(t, "activate", "Activate")}
              </button>
            </div>
          </SectionCard>
        )}

        {(canGenerate || canRedeem) && (
          <div className="lg:col-span-2">
            <Notice ok={redeemMsg.ok} msg={redeemMsg.m} />
          </div>
        )}
      </div>

      {canGenerate && (
      <SectionCard title={f(t, "license_records", "License Records")} icon="receipt_long">
        <div className="flex justify-end">
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <span className="msr text-[18px]">add</span>
            {f(t, "add_btn", "Add")}
          </button>
        </div>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-line">
                <th className="p-2.5">{f(t, "licensee", "Licensee")}</th>
                <th className="p-2.5">{f(t, "col_year", "Year")}</th>
                <th className="p-2.5">{f(t, "years", "Years")}</th>
                <th className="p-2.5">{f(t, "amount", "Amount")}</th>
                <th className="p-2.5">{f(t, "purchase_date", "Purchase Date")}</th>
                <th className="p-2.5 text-right">{f(t, "actions", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.license_id} className="border-b border-line last:border-0">
                  <td className="p-2.5 font-medium">{r.licensee || "—"}</td>
                  <td className="p-2.5">{r.year}</td>
                  <td className="p-2.5">{r.years}</td>
                  <td className="p-2.5">{fmt(r.amount)}</td>
                  <td className="p-2.5 text-muted">{fmtDate(r.purchase_date, lang)}</td>
                  <td className="p-2.5">
                    <div className="flex items-center gap-1.5 justify-end">
                      <button
                        className="btn !py-1 !px-2.5 text-xs"
                        onClick={() => setEditing(r)}
                      >
                        <span className="msr text-[15px]">edit</span>
                      </button>
                      <button
                        className="btn btn-danger !py-1 !px-2.5 text-xs"
                        onClick={() => delLicense(r)}
                      >
                        <span className="msr text-[15px]">delete</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td className="p-2.5 text-muted" colSpan={6}>
                    {f(t, "no_results", "No records")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>
      )}

      {canGenerate && (
      <SectionCard title={f(t, "smtp_settings", "Email (SMTP)")} icon="outgoing_mail">
        <div className="text-xs">
          <span className={`badge ${smtpConfigured ? "badge-ok" : "badge-archived"}`}>
            {smtpConfigured ? f(t, "configured", "Configured") : f(t, "not_configured", "Not configured")}
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Field label={f(t, "smtp_host", "Host")}>
            <input value={smtp.host} onChange={(e) => setSmtp((p) => ({ ...p, host: e.target.value }))} />
          </Field>
          <Field label={f(t, "smtp_port", "Port")}>
            <input value={smtp.port} onChange={(e) => setSmtp((p) => ({ ...p, port: e.target.value }))} />
          </Field>
          <Field label={f(t, "smtp_user", "User")}>
            <input value={smtp.user} onChange={(e) => setSmtp((p) => ({ ...p, user: e.target.value }))} />
          </Field>
          <Field label={f(t, "smtp_pass", "Password")}>
            <input
              type="password"
              value={smtp.password}
              onChange={(e) => setSmtp((p) => ({ ...p, password: e.target.value }))}
            />
          </Field>
          <Field label={f(t, "smtp_from", "Sender (From)")} full>
            <input value={smtp.sender} onChange={(e) => setSmtp((p) => ({ ...p, sender: e.target.value }))} />
          </Field>
        </div>
        <button
          className="btn btn-primary w-full"
          onClick={() =>
            run(async () => {
              await apiPut("/api/smtp", smtp);
              load();
            }, f(t, "saved", "Saved"))
          }
        >
          {f(t, "update_btn", "Save")}
        </button>
      </SectionCard>
      )}

      {adding && (
        <Modal title={f(t, "add_license", "Add License")} onClose={() => setAdding(false)}>
          <LicenseForm
            initial={blankLicense}
            submitLabel={f(t, "add_btn", "Add")}
            onSubmit={async (v) => {
              await apiPost("/api/licenses", v);
              toast.success(f(t, "license_added", "License record added."));
              setAdding(false);
              load();
            }}
          />
        </Modal>
      )}
      {editing && (
        <Modal title={`${f(t, "edit", "Edit")}: ${editing.licensee}`} onClose={() => setEditing(null)}>
          <LicenseForm
            initial={{
              licensee: editing.licensee || "",
              year: editing.year,
              years: editing.years,
              amount_eur: Math.round((editing.amount || 0) / 100),
              purchase_date: editing.purchase_date || "",
              notes: editing.notes || "",
            }}
            submitLabel={f(t, "update_btn", "Save")}
            onSubmit={async (v) => {
              await apiPut(`/api/licenses/${editing.license_id}`, v);
              toast.success(f(t, "license_updated", "License record updated."));
              setEditing(null);
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}

function LicenseForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: typeof blankLicense;
  submitLabel: string;
  onSubmit: (v: typeof blankLicense) => Promise<void>;
}) {
  const t = useT();
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const set = (k: string, val: any) => setV((p) => ({ ...p, [k]: val }));

  async function submit() {
    setBusy(true);
    setErr("");
    try {
      await onSubmit(v);
    } catch (e: any) {
      setErr(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label={f(t, "licensee", "Licensee")} full>
          <input value={v.licensee} onChange={(e) => set("licensee", e.target.value)} />
        </Field>
        <Field label={f(t, "col_year", "Year")}>
          <input type="number" value={v.year} onChange={(e) => set("year", +e.target.value)} />
        </Field>
        <Field label={f(t, "years", "Years")}>
          <input type="number" value={v.years} onChange={(e) => set("years", +e.target.value)} />
        </Field>
        <Field label={`${f(t, "amount", "Amount")} (€)`}>
          <input
            type="number"
            value={v.amount_eur}
            onChange={(e) => set("amount_eur", +e.target.value)}
          />
        </Field>
        <Field label={f(t, "purchase_date", "Purchase Date")}>
          <DateField
            value={v.purchase_date}
            onChange={(iso) => set("purchase_date", iso)}
            ariaLabel={f(t, "purchase_date", "Purchase Date")}
          />
        </Field>
        <Field label={f(t, "notes", "Notes")} full>
          <textarea rows={2} value={v.notes} onChange={(e) => set("notes", e.target.value)} />
        </Field>
      </div>
      {err && <div className="text-sm text-danger">{err}</div>}
      <button className="btn btn-primary w-full" onClick={submit} disabled={busy}>
        {busy ? "…" : submitLabel}
      </button>
    </div>
  );
}

// ============================================================================
// DANGER ZONE
// ============================================================================
function ResetButton({
  label,
  path,
  onDone,
}: {
  label: string;
  path: string;
  onDone: () => void;
}) {
  const t = useT();
  const toast = useToast();
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const armed = confirm.trim().toUpperCase() === "RESET";

  async function go() {
    setBusy(true);
    setMsg("");
    try {
      await apiPost(path, { confirm });
      setConfirm("");
      setMsg(f(t, "done", "Done"));
      toast.success(`${label} — ${f(t, "done", "Done")}`);
      onDone();
    } catch (e: any) {
      setMsg(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 space-y-2 border-danger/40">
      <div className="text-sm font-medium text-danger">{label}</div>
      <div className="text-xs text-muted">
        {f(t, "type_reset_to_confirm", 'Type RESET to confirm.')}
      </div>
      <div className="flex items-center gap-2">
        <input
          placeholder="RESET"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className="w-full lg:max-w-[140px]"
        />
        <button className="btn btn-danger" disabled={!armed || busy} onClick={go}>
          {busy ? "…" : f(t, "reset_btn", "Reset")}
        </button>
      </div>
      {msg && <div className="text-xs text-muted">{msg}</div>}
    </div>
  );
}

// ============================================================================
// ACTIVITY
// ============================================================================
interface ActivityRow {
  id: number;
  ts: string;
  username: string;
  action: string;
  entity: string;
  entity_id: string;
  detail: string;
}

interface ReturnableItem {
  kind: "vehicle" | "rental" | "cost" | "compensation";
  entity: string;
  entity_id: string;
  label: string;
}

// vehicle_id -> "PLATE — Make/Model" (falls back to just make/model if no plate)
function vehicleTag(make_model: string, license_plate?: string | null): string {
  return license_plate ? `${license_plate} — ${make_model}` : make_model;
}

// Activity rows only carry an entity + entity_id (e.g. rental · RENT-202607-011).
// These maps resolve that id to the client name / vehicle plate+model shown next
// to it, reusing the existing customers/rentals/vehicles endpoints — no new
// backend support needed.
function useActivityLookups() {
  const [customerNames, setCustomerNames] = useState<Map<string, string>>(new Map());
  const [vehicleTags, setVehicleTags] = useState<Map<string, string>>(new Map());
  const [rentalInfo, setRentalInfo] = useState<Map<string, { client: string; vehicle: string }>>(new Map());

  useEffect(() => {
    apiGet<{ customer_id: number; full_name: string }[]>("/api/customers")
      .then((rows) => setCustomerNames(new Map(rows.map((c) => [String(c.customer_id), c.full_name]))))
      .catch(() => {});
    apiGet<{ vehicle_id: string; make_model: string; license_plate?: string | null }[]>("/api/vehicles/active")
      .then((rows) => setVehicleTags(new Map(rows.map((v) => [v.vehicle_id, vehicleTag(v.make_model, v.license_plate)]))))
      .catch(() => {});
    apiGet<
      { deal_id: string; client_name: string; make_model: string; license_plate?: string | null }[]
    >("/api/rentals/all")
      .then((rows) =>
        setRentalInfo(
          new Map(rows.map((r) => [r.deal_id, { client: r.client_name, vehicle: vehicleTag(r.make_model, r.license_plate) }]))
        )
      )
      .catch(() => {});
  }, []);

  return { customerNames, vehicleTags, rentalInfo };
}

function ActivityTab() {
  const t = useT();
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [actions, setActions] = useState<string[]>([]);
  const [users, setUsers] = useState<string[]>([]);
  const [returnable, setReturnable] = useState<ReturnableItem[]>([]);
  const [filterBy, setFilterBy] = useState<"action" | "user">("action");
  const [actionF, setActionF] = useState("");
  const [userF, setUserF] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; m: string }>({ ok: true, m: "" });
  const { customerNames, vehicleTags, rentalInfo } = useActivityLookups();

  const loadActivity = useCallback(() => {
    apiGet<{ rows: ActivityRow[]; actions: string[]; users: string[] }>("/api/activity")
      .then((d) => {
        setRows(d.rows || []);
        setActions(d.actions || []);
        setUsers(d.users || []);
      })
      .catch(() => {});
  }, []);

  const loadReturnable = useCallback(() => {
    apiGet<ReturnableItem[]>("/api/activity/returnable")
      .then((d) => setReturnable(d || []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadActivity();
    loadReturnable();
  }, [loadActivity, loadReturnable]);

  // "entity:entity_id" → kind, for matching activity rows against undoable
  // items. Keyed on the pair (not entity_id alone) because vehicle_cost.cost_id
  // and charge.charge_id are both plain autoincrement ints and can collide.
  const returnableByEntity = useMemo(() => {
    const m = new Map<string, ReturnableItem["kind"]>();
    for (const it of returnable) m.set(`${it.entity}:${it.entity_id}`, it.kind);
    return m;
  }, [returnable]);

  async function doReturn(entityId: string, kind: ReturnableItem["kind"]) {
    setMsg({ ok: true, m: "" });
    try {
      await apiPost(`/api/activity/return/${kind}/${encodeURIComponent(entityId)}`);
      loadActivity();
      loadReturnable();
    } catch (e: any) {
      setMsg({ ok: false, m: t(e?.key || "error") });
    }
  }

  const maskLabel = (name: string) =>
    name === "system_admin_label" ? f(t, "system_admin_label", "system admin") : name;

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filterBy === "action" && actionF) return r.action === actionF;
      if (filterBy === "user" && userF) return r.username === userF;
      return true;
    });
  }, [rows, filterBy, actionF, userF]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label={f(t, "filter_by", "Filter by")}>
          <select
            value={filterBy}
            onChange={(e) => setFilterBy(e.target.value as "action" | "user")}
          >
            <option value="action">{f(t, "col_action", "Action")}</option>
            <option value="user">{f(t, "user", "User")}</option>
          </select>
        </Field>
        {filterBy === "action" ? (
          <Field label={f(t, "col_action", "Action")}>
            <select value={actionF} onChange={(e) => setActionF(e.target.value)}>
              <option value="">{f(t, "all", "All")}</option>
              {actions.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
          </Field>
        ) : (
          <Field label={f(t, "user", "User")}>
            <select value={userF} onChange={(e) => setUserF(e.target.value)}>
              <option value="">{f(t, "all", "All")}</option>
              {users.map((u) => (
                <option key={u} value={u}>
                  {maskLabel(u)}
                </option>
              ))}
            </select>
          </Field>
        )}
        <div className="text-xs text-muted ml-auto self-center">
          {filtered.length} {f(t, "col_count", "records")}
        </div>
      </div>

      <Notice ok={msg.ok} msg={msg.m} />

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-line">
              <th className="p-3">{f(t, "col_when", "When")}</th>
              <th className="p-3">{f(t, "user", "User")}</th>
              <th className="p-3">{f(t, "col_action", "Action")}</th>
              <th className="p-3">{f(t, "entity", "Entity")}</th>
              <th className="p-3">{f(t, "col_client_vehicle", "Client / Vehicle")}</th>
              <th className="p-3">{f(t, "detail", "Detail")}</th>
              <th className="p-3 text-right">{f(t, "actions", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const kind = r.entity_id ? returnableByEntity.get(`${r.entity}:${r.entity_id}`) : undefined;
              const rental = r.entity === "rental" ? rentalInfo.get(r.entity_id) : undefined;
              const vehicleName = r.entity === "vehicle" ? vehicleTags.get(r.entity_id) : undefined;
              const customerName = r.entity === "customer" ? customerNames.get(r.entity_id) : undefined;
              return (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="p-3 text-muted whitespace-nowrap font-mono text-xs">{r.ts}</td>
                  <td className="p-3">{maskLabel(r.username)}</td>
                  <td className="p-3">{r.action}</td>
                  <td className="p-3 text-muted">
                    {r.entity}
                    {r.entity_id ? ` · ${r.entity_id}` : ""}
                  </td>
                  <td className="p-3 text-muted">
                    {rental ? `${rental.client} · ${rental.vehicle}` : vehicleName || customerName || "—"}
                  </td>
                  <td className="p-3 text-muted">{r.detail || "—"}</td>
                  <td className="p-3 text-right">
                    {kind && (
                      <button
                        className="btn !py-1 !px-2 text-xs"
                        title={f(t, "return_btn", "Return")}
                        onClick={() => doReturn(r.entity_id, kind)}
                      >
                        <span className="msr text-[15px]">undo</span>
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
            {filtered.length === 0 && (
              <tr>
                <td className="p-3 text-muted" colSpan={7}>
                  {f(t, "no_results", "No activity")}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ============================================================================
// BACKUP / RESTORE
// ============================================================================
function BackupTab() {
  const t = useT();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; m: string }>({ ok: true, m: "" });

  async function downloadDump(url: string, fallbackName: string) {
    setBusy(true);
    setMsg({ ok: true, m: "" });
    try {
      const res = (await api(url, { raw: true })) as Response;
      if (!res.ok) {
        let key = "error";
        try {
          const d = await res.json();
          if (typeof d?.detail === "string") key = d.detail;
        } catch {
          /* non-JSON error */
        }
        throw { key };
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") || "";
      const name = cd.match(/filename="?([^"]+)"?/)?.[1] || fallbackName;
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = name;
      a.click();
      URL.revokeObjectURL(objUrl);
      setMsg({ ok: true, m: f(t, "backup_downloaded", "Backup downloaded") });
      toast.success(f(t, "backup_downloaded", "Backup downloaded"));
    } catch (e: any) {
      setMsg({ ok: false, m: t(e?.key || "error") });
    } finally {
      setBusy(false);
    }
  }

  async function restore() {
    if (!file) return;
    if (
      !confirm(
        f(
          t,
          "restore_confirm",
          "This will REPLACE all current data with the backup. This cannot be undone. Continue?"
        )
      )
    )
      return;
    setBusy(true);
    setMsg({ ok: true, m: "" });
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await api<{ ok: boolean; counts: Record<string, number> }>("/api/data/import", {
        method: "POST",
        body: fd,
      });
      setFile(null);
      const total = Object.values(r.counts || {}).reduce((a, b) => a + b, 0);
      const okMsg = `${f(t, "restore_done", "Restore complete")} · ${total}`;
      setMsg({ ok: true, m: okMsg });
      toast.success(okMsg);
    } catch (e: any) {
      setMsg({ ok: false, m: t(e?.key || "error") });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <SectionCard title={f(t, "backup_database", "Backup Database")} icon="cloud_download">
        <div className="text-xs text-muted">
          {f(
            t,
            "backup_help",
            "Download a full JSON snapshot of the database (fleet, rentals, customers, finance, users and settings). Keep it somewhere safe."
          )}
        </div>
        <div className="flex flex-col gap-2">
          <button
            className="btn btn-primary w-full"
            onClick={() => downloadDump("/api/data/backup", "bcr-backup.json")}
            disabled={busy}
          >
            <span className="msr text-[18px]">cloud_download</span>
            {busy ? "…" : f(t, "download_backup", "Download Backup (JSON)")}
          </button>
          <button
            className="btn w-full"
            onClick={() => downloadDump("/api/data/backup.csv", "bcr-backup-csv.zip")}
            disabled={busy}
            title={f(t, "download_backup_csv_hint", "One CSV per table, bundled as a .zip — opens in Excel")}
          >
            <span className="msr text-[18px]">table_view</span>
            {busy ? "…" : f(t, "download_backup_csv", "Download as CSV (.zip)")}
          </button>
          <button
            className="btn w-full"
            onClick={() => downloadDump("/api/data/backup-single.csv", "bcr-backup.csv")}
            disabled={busy}
            title={f(t, "download_backup_single_csv_hint", "Every table concatenated into one CSV file")}
          >
            <span className="msr text-[18px]">description</span>
            {busy ? "…" : f(t, "download_backup_single_csv", "Download as single CSV file")}
          </button>
          <button
            className="btn w-full"
            onClick={() => downloadDump("/api/data/backup.sqlite", "bcr-backup.sqlite")}
            disabled={busy}
            title={f(t, "download_backup_sqlite_hint", "Portable single-file SQLite database")}
          >
            <span className="msr text-[18px]">database</span>
            {busy ? "…" : f(t, "download_backup_sqlite", "Download as SQLite (.sqlite)")}
          </button>
        </div>
      </SectionCard>

      <SectionCard title={f(t, "restore_database", "Restore / Import")} icon="cloud_upload">
        <div className="text-xs text-danger">
          {f(
            t,
            "restore_help",
            "Importing a backup REPLACES all current data. Make a backup first — this cannot be undone."
          )}
        </div>
        <label className="btn !py-1.5 !px-3 text-xs cursor-pointer w-fit">
          <span className="msr text-[16px]">description</span>
          {file ? file.name : f(t, "choose_file", "Choose backup file…")}
          <input
            type="file"
            accept="application/json,.json"
            className="hidden !w-auto"
            disabled={busy}
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              e.target.value = "";
            }}
          />
        </label>
        <button
          className="btn btn-danger w-full"
          onClick={restore}
          disabled={busy || !file}
        >
          <span className="msr text-[18px]">cloud_upload</span>
          {busy ? "…" : f(t, "restore_backup", "Restore Backup")}
        </button>
      </SectionCard>

      <div className="lg:col-span-2">
        <Notice ok={msg.ok} msg={msg.m} />
      </div>

      <div className="lg:col-span-2 space-y-2">
        <div className="flex items-center gap-2 text-danger">
          <span className="msr text-[18px]">warning</span>
          <h2 className="text-sm font-semibold">{f(t, "danger_zone", "Danger Zone")}</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ResetButton label={f(t, "reset_finance", "Reset Finance Records")} path="/api/data/reset/finance" onDone={() => {}} />
          <ResetButton label={f(t, "reset_clients", "Reset Clients")} path="/api/data/reset/clients" onDone={() => {}} />
          <ResetButton label={f(t, "reset_fleet", "Reset Fleet")} path="/api/data/reset/fleet" onDone={() => {}} />
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// PAGE — tab shell
// ============================================================================
type TabId = "profile" | "users" | "roles" | "business" | "license" | "activity" | "backup";

export default function SettingsPage() {
  const t = useT();
  const { user } = useAuth();
  const [tab, setTab] = useState<TabId>("profile");

  const tabs = useMemo(() => {
    const list: { id: TabId; label: string; icon: string; show: boolean }[] = [
      { id: "profile", label: f(t, "tab_profile", "Profile"), icon: "person", show: true },
      { id: "users", label: f(t, "tab_users", "Users"), icon: "group", show: can(user, "manage_users") },
      { id: "roles", label: f(t, "tab_roles", "Roles"), icon: "admin_panel_settings", show: can(user, "manage_users") },
      { id: "business", label: f(t, "tab_business", "Business"), icon: "storefront", show: can(user, "manage_users") },
      { id: "license", label: f(t, "tab_license", "License"), icon: "workspace_premium", show: roleLevel(user) >= 2 },
      { id: "backup", label: f(t, "tab_backup", "Backup"), icon: "backup", show: can(user, "backup_database") },
      { id: "activity", label: f(t, "tab_activity", "Activity"), icon: "history", show: can(user, "manage_users") },
    ];
    return list.filter((x) => x.show);
  }, [t, user]);

  // Keep the active tab valid as permissions resolve.
  useEffect(() => {
    if (tabs.length && !tabs.some((x) => x.id === tab)) setTab(tabs[0].id);
  }, [tabs, tab]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2">
        <span className="msr text-[22px]">settings</span>
        <h1 className="text-xl font-bold">{f(t, "nav_settings", "Settings")}</h1>
      </div>

      {/* Up to seven tabs. Wrapping them on a phone builds a four-row block
          before any content appears, so below `lg` this is a single
          horizontally-scrollable row instead. */}
      <div
        className="flex flex-wrap gap-1.5 border-b border-line pb-2
                   max-lg:flex-nowrap max-lg:overflow-x-auto max-lg:no-scrollbar"
      >
        {tabs.map((x) => (
          <button
            key={x.id}
            className={`btn !py-1.5 !px-3 text-xs max-lg:shrink-0 max-lg:whitespace-nowrap ${
              tab === x.id ? "btn-primary" : "!bg-transparent !border-transparent"
            }`}
            onClick={() => setTab(x.id)}
          >
            <span className="msr text-[16px]">{x.icon}</span>
            {x.label}
          </button>
        ))}
      </div>

      {tab === "profile" && <ProfileTab />}
      {tab === "users" && can(user, "manage_users") && <UsersTab />}
      {tab === "roles" && can(user, "manage_users") && <AdminPanel />}
      {tab === "business" && can(user, "manage_users") && <BusinessTab />}
      {tab === "license" && roleLevel(user) >= 2 && <LicenseTab />}
      {tab === "backup" && can(user, "backup_database") && <BackupTab />}
      {tab === "activity" && can(user, "manage_users") && <ActivityTab />}
    </div>
  );
}
