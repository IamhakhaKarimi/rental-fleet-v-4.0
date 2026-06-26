"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { api, apiDel, apiGet, apiPost, apiPut, API_BASE } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useI18n, useT } from "@/lib/i18n";
import { can, roleLevel } from "@/lib/perms";
import { formatEur } from "@/lib/money";
import { useTheme } from "@/lib/theme";
import { Modal } from "@/components/Modal";

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

function ProfileTab() {
  const t = useT();
  const { refresh } = useAuth();
  const { setLang } = useI18n();
  const [p, setP] = useState<Profile | null>(null);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [cnf, setCnf] = useState("");
  const [langs, setLangs] = useState<LangOption[]>([]);
  const [curLang, setCurLang] = useState("tr");
  const [msg, setMsg] = useState<{ ok: boolean; m: string }>({ ok: true, m: "" });

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
  }, []);
  useEffect(load, [load]);

  async function run(fn: () => Promise<void>, okMsg: string) {
    setMsg({ ok: true, m: "" });
    try {
      await fn();
      setMsg({ ok: true, m: okMsg });
    } catch (e: any) {
      setMsg({ ok: false, m: t(e?.key || "error") });
    }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <SectionCard title={f(t, "tab_profile", "Profile")} icon="badge">
        <div className="text-xs text-muted">
          {f(t, "username", "Username")}: <span className="text-ink font-medium">{p?.username || "—"}</span>
        </div>
        <div className="grid grid-cols-2 gap-3">
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
          <input type="password" value={cur} onChange={(e) => setCur(e.target.value)} />
        </Field>
        <Field label={f(t, "new_password", "New Password")} full>
          <input type="password" value={nw} onChange={(e) => setNw(e.target.value)} />
        </Field>
        <Field label={f(t, "confirm_password", "Confirm Password")} full>
          <input type="password" value={cnf} onChange={(e) => setCnf(e.target.value)} />
        </Field>
        <button
          className="btn btn-primary w-full"
          onClick={() =>
            run(async () => {
              await apiPut("/api/profile/password", {
                current_password: cur,
                new_password: nw,
                confirm_password: cnf,
              });
              setCur("");
              setNw("");
              setCnf("");
            }, f(t, "saved", "Saved"))
          }
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

  async function act(fn: () => Promise<void>) {
    setMsg({ ok: true, m: "" });
    try {
      await fn();
      load();
    } catch (e: any) {
      setMsg({ ok: false, m: t(e?.key || "error") });
    }
  }

  async function changeRole(u: UserRow, role: string) {
    if (role === u.role) return;
    await act(() => apiPut(`/api/users/${encodeURIComponent(u.username)}/role`, { role }));
  }
  async function toggleActive(u: UserRow) {
    await act(() =>
      apiPut(`/api/users/${encodeURIComponent(u.username)}/active`, { active: !u.is_active })
    );
  }
  async function del(u: UserRow) {
    if (!confirm(`${f(t, "delete_btn", "Delete")}: ${u.username}?`)) return;
    await act(() => apiDel(`/api/users/${encodeURIComponent(u.username)}`));
  }
  async function resetPw(u: UserRow) {
    setMsg({ ok: true, m: "" });
    try {
      const r = await apiPost<{ sent: boolean; recipient: string; new_password: string }>(
        `/api/users/${encodeURIComponent(u.username)}/reset-password`
      );
      if (r.sent) {
        setMsg({ ok: true, m: `${f(t, "recover_sent", "Email sent")}: ${r.recipient}` });
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
      onDone();
    } catch (e: any) {
      setErr(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
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
}

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
  const [busy, setBusy] = useState(false);
  const [bust, setBust] = useState(Date.now());

  async function upload(file: File) {
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      await api(uploadPath, { method: "POST", body: fd });
      setBust(Date.now());
      onChange();
    } catch (e: any) {
      alert(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      await apiDel(uploadPath);
      onChange();
    } catch (e: any) {
      alert(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2">
      <div className="text-xs text-muted">{label}</div>
      {has && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`${API_BASE}${imgPath}?b=${bust}`}
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
        {has && (
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

function ThemeDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
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
        <div className="grid grid-cols-2 gap-3">
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
        {err && <div className="text-sm text-danger">{err}</div>}
        <div className="flex items-center gap-2">
          <button className="btn btn-primary flex-1" onClick={save} disabled={busy}>
            {busy ? "…" : f(t, "update_btn", "Save")}
          </button>
          <button className="btn flex-1" onClick={reset} disabled={busy}>
            {f(t, "reset_btn", "Reset")}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function BusinessTab() {
  const t = useT();
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
      })
      .catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function run(fn: () => Promise<void>, okMsg: string) {
    setMsg({ ok: true, m: "" });
    try {
      await fn();
      setMsg({ ok: true, m: okMsg });
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

      <SectionCard title={f(t, "business_contact", "Business Contact & Invoice QR")} icon="contact_page">
        <div className="grid grid-cols-2 gap-3">
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

function LicenseTab() {
  const t = useT();
  const { lang } = useI18n();
  const { user } = useAuth();
  const canGenerate = can(user, "edit_business_settings");
  const canRedeem = roleLevel(user) >= 2;
  const [status, setStatus] = useState<{
    licensed_year: number;
    current_year: number;
    year_options: number[];
  } | null>(null);
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
  }, []);

  const load = useCallback(() => {
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
  }, [refreshStatus]);
  useEffect(load, [load]);

  async function generate() {
    setRedeemMsg({ ok: true, m: "" });
    try {
      const r = await apiPost<{ year: number; key: string }>("/api/license/generate-key", {
        year: genYear,
      });
      setGenKey(r.key);
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
      refreshStatus();
      setRedeemMsg({
        ok: true,
        m: `${f(t, "year", "Year")} ${r.year} ${f(t, "activated", "activated")}`,
      });
    } catch (e: any) {
      setRedeemMsg({
        ok: false,
        m: f(t, e?.key || "error", e?.key === "invalid_key" ? "Invalid license key" : "Error"),
      });
    }
  }

  async function run(fn: () => Promise<void>, okMsg: string) {
    setMsg({ ok: true, m: "" });
    try {
      await fn();
      setMsg({ ok: true, m: okMsg });
    } catch (e: any) {
      setMsg({ ok: false, m: t(e?.key || "error") });
    }
  }

  async function delLicense(r: LicenseRow) {
    if (!confirm(`${f(t, "delete_btn", "Delete")}: ${r.licensee} (${r.year})?`)) return;
    await run(async () => {
      await apiDel(`/api/licenses/${r.license_id}`);
      load();
    }, f(t, "deleted", "Deleted"));
  }

  return (
    <div className="space-y-4">
      <Notice ok={msg.ok} msg={msg.m} />

      <SectionCard title={f(t, "license_status", "License Status")} icon="workspace_premium">
        <div className="text-sm">
          {f(t, "licensed_until", "Licensed until year")}:{" "}
          <span className="font-semibold text-ink">{status?.licensed_year ?? "—"}</span>
        </div>
        <div className="flex items-end gap-3">
          <Field label={f(t, "unlock_year", "Unlock year")}>
            <select value={yearSel} onChange={(e) => setYearSel(+e.target.value)}>
              {(status?.year_options || []).map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </Field>
          <button
            className="btn btn-primary"
            onClick={() =>
              run(async () => {
                await apiPut("/api/license/year", { year: yearSel });
                load();
              }, f(t, "saved", "Saved"))
            }
          >
            {f(t, "unlock_btn", "Unlock")}
          </button>
        </div>
      </SectionCard>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {canGenerate && (
          <SectionCard title={f(t, "generate_key", "Generate License Key")} icon="vpn_key">
            <div className="flex items-end gap-3">
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
            )}
          </SectionCard>
        )}

        {canRedeem && (
          <SectionCard title={f(t, "redeem_key", "Redeem License Key")} icon="key">
            <div className="flex items-end gap-3">
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

      <SectionCard title={f(t, "license_records", "License Records")} icon="receipt_long">
        <div className="flex justify-end">
          <button className="btn btn-primary" onClick={() => setAdding(true)}>
            <span className="msr text-[18px]">add</span>
            {f(t, "add_btn", "Add")}
          </button>
        </div>
        <div className="overflow-x-auto">
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
                  <td className="p-2.5">{formatEur(r.amount)}</td>
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

      <SectionCard title={f(t, "smtp_settings", "Email (SMTP)")} icon="outgoing_mail">
        <div className="text-xs">
          <span className={`badge ${smtpConfigured ? "badge-ok" : "badge-archived"}`}>
            {smtpConfigured ? f(t, "configured", "Configured") : f(t, "not_configured", "Not configured")}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
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

      {adding && (
        <Modal title={f(t, "add_license", "Add License")} onClose={() => setAdding(false)}>
          <LicenseForm
            initial={blankLicense}
            submitLabel={f(t, "add_btn", "Add")}
            onSubmit={async (v) => {
              await apiPost("/api/licenses", v);
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
      <div className="grid grid-cols-2 gap-3">
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
          <input
            type="date"
            value={v.purchase_date}
            onChange={(e) => set("purchase_date", e.target.value)}
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
// DATA / DANGER ZONE
// ============================================================================
interface ChargeRow {
  charge_id: number;
  deal_id: string;
  vehicle_id: string;
  make_model: string;
  type: string;
  amount: number;
  occurred_at: string;
}
interface CostRow {
  cost_id: number;
  vehicle_id: string;
  make_model: string;
  type: string;
  amount: number;
  period_date: string;
}
interface ClientRow {
  customer_id: number;
  full_name: string;
  phone: string;
  rental_count: number;
  id_passport?: string;
}

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
          className="max-w-[140px]"
        />
        <button className="btn btn-danger" disabled={!armed || busy} onClick={go}>
          {busy ? "…" : f(t, "reset_btn", "Reset")}
        </button>
      </div>
      {msg && <div className="text-xs text-muted">{msg}</div>}
    </div>
  );
}

function ClientEditForm({
  client,
  onDone,
}: {
  client: ClientRow;
  onDone: () => void;
}) {
  const t = useT();
  const [name, setName] = useState(client.full_name || "");
  const [phone, setPhone] = useState(client.phone || "");
  const [idp, setIdp] = useState(client.id_passport || "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  async function submit() {
    if (!name.trim()) {
      setErr(f(t, "fields_required", "Fields required"));
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await apiPut(`/api/customers/${client.customer_id}`, {
        full_name: name,
        phone,
        id_passport: idp,
      });
      onDone();
    } catch (e: any) {
      setErr(t(e?.key || "error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <Field label={f(t, "full_name", "Full Name")} full>
        <input className="uppercase-input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label={f(t, "phone", "Phone")} full>
        <input className="uppercase-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </Field>
      <Field label={f(t, "id_passport", "ID / Passport")} full>
        <input className="uppercase-input" value={idp} onChange={(e) => setIdp(e.target.value)} />
      </Field>
      {err && <div className="text-sm text-danger">{err}</div>}
      <button className="btn btn-primary w-full" onClick={submit} disabled={busy}>
        {busy ? "…" : f(t, "update_btn", "Save")}
      </button>
    </div>
  );
}

function DataTab() {
  const t = useT();
  const { lang } = useI18n();
  const { user } = useAuth();
  const canDelete = roleLevel(user) >= 2;
  const [income, setIncome] = useState<ChargeRow[]>([]);
  const [expenses, setExpenses] = useState<CostRow[]>([]);
  const [clients, setClients] = useState<ClientRow[]>([]);
  const [editClient, setEditClient] = useState<ClientRow | null>(null);

  const load = useCallback(() => {
    apiGet<{ income: ChargeRow[]; expenses: CostRow[] }>("/api/data/finance-records")
      .then((d) => {
        setIncome(d.income || []);
        setExpenses(d.expenses || []);
      })
      .catch(() => {});
    apiGet<ClientRow[]>("/api/data/clients").then(setClients).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function delClient(c: ClientRow) {
    if (!confirm(`${f(t, "delete_btn", "Delete")}: ${c.full_name}?`)) return;
    try {
      await apiDel(`/api/customers/${c.customer_id}`, { confirm: true });
      load();
    } catch (e: any) {
      alert(t(e?.key || "error"));
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SectionCard title={`${f(t, "income", "Income")} (${income.length})`} icon="trending_up">
          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted border-b border-line">
                  <th className="p-2">{f(t, "col_type", "Type")}</th>
                  <th className="p-2">{f(t, "nav_fleet", "Vehicle")}</th>
                  <th className="p-2 text-right">{f(t, "amount", "Amount")}</th>
                  <th className="p-2">{f(t, "col_date", "Date")}</th>
                </tr>
              </thead>
              <tbody>
                {income.map((r) => (
                  <tr key={r.charge_id} className="border-b border-line last:border-0">
                    <td className="p-2">{r.type}</td>
                    <td className="p-2 text-muted">{r.make_model || r.vehicle_id || "—"}</td>
                    <td className="p-2 text-right">{formatEur(r.amount)}</td>
                    <td className="p-2 text-muted">{fmtDate(r.occurred_at, lang)}</td>
                  </tr>
                ))}
                {income.length === 0 && (
                  <tr>
                    <td className="p-2 text-muted" colSpan={4}>
                      {f(t, "no_results", "None")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>

        <SectionCard title={`${f(t, "expenses", "Expenses")} (${expenses.length})`} icon="trending_down">
          <div className="overflow-x-auto max-h-72">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-left text-muted border-b border-line">
                  <th className="p-2">{f(t, "col_type", "Type")}</th>
                  <th className="p-2">{f(t, "nav_fleet", "Vehicle")}</th>
                  <th className="p-2 text-right">{f(t, "amount", "Amount")}</th>
                  <th className="p-2">{f(t, "col_date", "Date")}</th>
                </tr>
              </thead>
              <tbody>
                {expenses.map((r) => (
                  <tr key={r.cost_id} className="border-b border-line last:border-0">
                    <td className="p-2">{r.type}</td>
                    <td className="p-2 text-muted">{r.make_model || r.vehicle_id || "—"}</td>
                    <td className="p-2 text-right">{formatEur(r.amount)}</td>
                    <td className="p-2 text-muted">{fmtDate(r.period_date, lang)}</td>
                  </tr>
                ))}
                {expenses.length === 0 && (
                  <tr>
                    <td className="p-2 text-muted" colSpan={4}>
                      {f(t, "no_results", "None")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </SectionCard>
      </div>

      <SectionCard title={`${f(t, "nav_customers", "Clients")} (${clients.length})`} icon="group">
        <div className="overflow-x-auto max-h-72">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-muted border-b border-line">
                <th className="p-2">{f(t, "full_name", "Name")}</th>
                <th className="p-2">{f(t, "phone", "Phone")}</th>
                <th className="p-2 text-right">{f(t, "rentals", "Rentals")}</th>
                <th className="p-2 text-right">{f(t, "actions", "Actions")}</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => (
                <tr key={c.customer_id} className="border-b border-line last:border-0">
                  <td className="p-2 font-medium">{c.full_name}</td>
                  <td className="p-2 text-muted">{c.phone || "—"}</td>
                  <td className="p-2 text-right">{c.rental_count}</td>
                  <td className="p-2">
                    <div className="flex items-center gap-1.5 justify-end">
                      <button
                        className="btn !py-1 !px-2 text-xs"
                        title={f(t, "edit", "Edit")}
                        onClick={() => setEditClient(c)}
                      >
                        <span className="msr text-[15px]">edit</span>
                      </button>
                      {canDelete && (
                        <button
                          className="btn btn-danger !py-1 !px-2 text-xs"
                          title={f(t, "delete_btn", "Delete")}
                          onClick={() => delClient(c)}
                        >
                          <span className="msr text-[15px]">delete</span>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {clients.length === 0 && (
                <tr>
                  <td className="p-2 text-muted" colSpan={4}>
                    {f(t, "no_results", "None")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {editClient && (
        <Modal
          title={`${f(t, "edit", "Edit")}: ${editClient.full_name}`}
          onClose={() => setEditClient(null)}
        >
          <ClientEditForm
            client={editClient}
            onDone={() => {
              setEditClient(null);
              load();
            }}
          />
        </Modal>
      )}

      <div className="space-y-2">
        <div className="flex items-center gap-2 text-danger">
          <span className="msr text-[18px]">warning</span>
          <h2 className="text-sm font-semibold">{f(t, "danger_zone", "Danger Zone")}</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ResetButton
            label={f(t, "reset_finance", "Reset Finance Records")}
            path="/api/data/reset/finance"
            onDone={load}
          />
          <ResetButton
            label={f(t, "reset_clients", "Reset Clients")}
            path="/api/data/reset/clients"
            onDone={load}
          />
          <ResetButton
            label={f(t, "reset_fleet", "Reset Fleet")}
            path="/api/data/reset/fleet"
            onDone={load}
          />
        </div>
      </div>
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
  kind: "vehicle" | "rental";
  entity_id: string;
  label: string;
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

  // entity_id → kind, for matching activity rows against undoable items.
  const returnableByEntity = useMemo(() => {
    const m = new Map<string, ReturnableItem["kind"]>();
    for (const it of returnable) m.set(it.entity_id, it.kind);
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
              <th className="p-3">{f(t, "detail", "Detail")}</th>
              <th className="p-3 text-right">{f(t, "actions", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => {
              const kind = r.entity_id ? returnableByEntity.get(r.entity_id) : undefined;
              return (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className="p-3 text-muted whitespace-nowrap font-mono text-xs">{r.ts}</td>
                  <td className="p-3">{maskLabel(r.username)}</td>
                  <td className="p-3">{r.action}</td>
                  <td className="p-3 text-muted">
                    {r.entity}
                    {r.entity_id ? ` · ${r.entity_id}` : ""}
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
                <td className="p-3 text-muted" colSpan={6}>
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
// PAGE — tab shell
// ============================================================================
type TabId = "profile" | "users" | "business" | "license" | "data" | "activity";

export default function SettingsPage() {
  const t = useT();
  const { user } = useAuth();
  const [tab, setTab] = useState<TabId>("profile");

  const tabs = useMemo(() => {
    const list: { id: TabId; label: string; icon: string; show: boolean }[] = [
      { id: "profile", label: f(t, "tab_profile", "Profile"), icon: "person", show: true },
      { id: "users", label: f(t, "tab_users", "Users"), icon: "group", show: can(user, "manage_users") },
      { id: "business", label: f(t, "tab_business", "Business"), icon: "storefront", show: can(user, "manage_users") },
      { id: "license", label: f(t, "tab_license", "License"), icon: "workspace_premium", show: can(user, "edit_business_settings") },
      { id: "data", label: f(t, "tab_data", "Data"), icon: "database", show: can(user, "edit_business_settings") },
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

      <div className="flex flex-wrap gap-1.5 border-b border-line pb-2">
        {tabs.map((x) => (
          <button
            key={x.id}
            className={`btn !py-1.5 !px-3 text-xs ${
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
      {tab === "business" && can(user, "manage_users") && <BusinessTab />}
      {tab === "license" && can(user, "edit_business_settings") && <LicenseTab />}
      {tab === "data" && can(user, "edit_business_settings") && <DataTab />}
      {tab === "activity" && can(user, "manage_users") && <ActivityTab />}
    </div>
  );
}
