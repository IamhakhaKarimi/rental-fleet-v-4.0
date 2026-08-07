"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet, apiPost } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import { Modal } from "@/components/Modal";
import type { BusinessInfo } from "@/lib/types";

// Forgot-password dialog. The backend answers identically whether or not the
// account exists, so this shows one unconditional confirmation and never reports
// "no such user" — that would hand an attacker a username oracle.
function ForgotPasswordModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));
  const [identifier, setIdentifier] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [devLink, setDevLink] = useState("");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!identifier.trim()) return;
    setBusy(true);
    try {
      const res = await apiPost<{ ok: boolean; debug_link?: string }>(
        "/api/auth/forgot-password",
        { username: identifier.trim() }
      );
      // Only ever present for a loopback caller with SMTP unconfigured.
      setDevLink(res?.debug_link || "");
    } catch {
      /* Deliberately ignored: failing loudly here would leak whether the
         account exists. The confirmation below is shown either way. */
    } finally {
      setBusy(false);
      setDone(true);
    }
  }

  return (
    <Modal title={tf("forgot_password", "Forgot password")} onClose={onClose}>
      {done ? (
        <div className="space-y-4">
          <div className="text-sm text-ink flex items-start gap-2">
            <span className="msr text-[18px] text-ok">mark_email_read</span>
            {tf(
              "recover_sent_generic",
              "If an account matches, a password reset link has been sent to its email address."
            )}
          </div>
          {devLink && (
            <div className="card p-3 space-y-1.5 bg-[rgba(17,24,39,0.03)]">
              <div className="text-xs text-muted">
                {tf("smtp_not_configured", "SMTP is not configured — development link:")}
              </div>
              <a href={devLink} className="text-xs text-accent break-all underline">
                {devLink}
              </a>
            </div>
          )}
          <button className="btn w-full" onClick={onClose}>
            {tf("back_to_login", "Back to sign in")}
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="text-xs text-muted">
            {tf(
              "recover_help",
              "Enter your username or email address. If an account matches, a reset link will be sent to it."
            )}
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted">
              {tf("login_username", "Username")} / {tf("email", "Email")}
            </label>
            <input
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              autoFocus
              autoComplete="username"
            />
          </div>
          <button type="submit" className="btn btn-primary w-full" disabled={busy || !identifier.trim()}>
            <span className="msr text-[18px]">send</span>
            {busy ? "…" : tf("recover_btn", "Send reset link")}
          </button>
        </form>
      )}
    </Modal>
  );
}

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const t = useT();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [biz, setBiz] = useState<BusinessInfo | null>(null);
  const [forgot, setForgot] = useState(false);

  useEffect(() => {
    apiGet<BusinessInfo>("/api/business/name").then(setBiz).catch(() => {});
  }, []);

  useEffect(() => {
    if (!loading && user) router.replace("/");
  }, [user, loading, router]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await login(username.trim(), password, remember);
      router.replace("/");
    } catch (ex: any) {
      setErr(t(ex?.key || "login_failed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-bg">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <div className="w-10 h-10 rounded-[10px] bg-accent text-bg flex items-center justify-center font-bold text-lg">
            {biz?.initial || "B"}
          </div>
          <div>
            <div className="font-bold text-ink leading-tight">{biz?.business_name || "Balkan Car Rentals"}</div>
            <div className="text-[0.6rem] tracking-[0.14em] uppercase text-muted">{biz?.tagline || "Fleet Console"}</div>
          </div>
        </div>

        <form onSubmit={submit} className="card p-6 space-y-4">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <span className="msr text-[20px]">lock</span>
            {t("login_title")}
          </h1>

          <div className="space-y-1.5">
            <label className="text-xs text-muted">{t("login_username")}</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus autoComplete="username" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted">{t("login_password")}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
          </div>

          <div className="flex items-center justify-between gap-2">
            <label className="flex items-center gap-2 text-sm text-muted select-none">
              <input type="checkbox" className="w-auto" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
              {t("login_remember")}
            </label>
            <button
              type="button"
              className="text-xs text-accent hover:underline"
              onClick={() => setForgot(true)}
            >
              {tf("forgot_password", "Forgot password")}
            </button>
          </div>

          {err && (
            <div className="text-sm text-danger flex items-center gap-1.5">
              <span className="msr text-[18px]">error</span>
              {err}
            </div>
          )}

          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {busy ? "…" : t("login_btn")}
          </button>
        </form>

        {forgot && <ForgotPasswordModal onClose={() => setForgot(false)} />}
      </div>
    </main>
  );
}
