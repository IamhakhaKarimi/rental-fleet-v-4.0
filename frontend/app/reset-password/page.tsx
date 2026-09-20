"use client";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api, apiGet, apiPost } from "@/lib/api";
import { useT } from "@/lib/i18n";
import type { BusinessInfo } from "@/lib/types";
import { Skeleton } from "@/components/Skeleton";

interface PasswordPolicy {
  min_length: number;
  min_classes: number;
  classes: string[];
}

// Mirrors services/auth_service.validate_password so the user sees the verdict as
// they type. The server re-checks — this is guidance, never the gate.
function checkStrength(pw: string, policy: PasswordPolicy | null) {
  const min = policy?.min_length ?? 10;
  const classes =
    (/[a-z]/.test(pw) ? 1 : 0) +
    (/[A-Z]/.test(pw) ? 1 : 0) +
    (/[0-9]/.test(pw) ? 1 : 0) +
    (/[^A-Za-z0-9]/.test(pw) ? 1 : 0);
  const longEnough = pw.length >= min;
  return { classes, longEnough, ok: longEnough && classes >= (policy?.min_classes ?? 3), min };
}

function ResetPasswordInner() {
  const t = useT();
  const tf = (k: string, f: string) => (t(k) === k ? f : t(k));
  const router = useRouter();
  const params = useSearchParams();
  const token = params.get("token") || "";

  const [biz, setBiz] = useState<BusinessInfo | null>(null);
  const [policy, setPolicy] = useState<PasswordPolicy | null>(null);
  // null = still checking whether the link is redeemable.
  const [valid, setValid] = useState<boolean | null>(null);
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    apiGet<BusinessInfo>("/api/business/name").then(setBiz).catch(() => {});
    apiGet<PasswordPolicy>("/api/auth/password-policy").then(setPolicy).catch(() => {});
  }, []);

  // Check the link up front so an expired one says so before anything is typed.
  useEffect(() => {
    if (!token) {
      setValid(false);
      return;
    }
    api<{ valid: boolean }>(`/api/auth/reset-password?token=${encodeURIComponent(token)}`)
      .then((r) => setValid(!!r.valid))
      .catch(() => setValid(false));
  }, [token]);

  const strength = useMemo(() => checkStrength(pw, policy), [pw, policy]);
  const matches = pw.length > 0 && pw === confirm;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr("");
    if (!matches) {
      setErr(tf("passwords_no_match", "Passwords do not match."));
      return;
    }
    setBusy(true);
    try {
      await apiPost("/api/auth/reset-password", { token, new_password: pw });
      setDone(true);
    } catch (ex: any) {
      const key = ex?.key || "error";
      setErr(
        t(key) === key
          ? tf("reset_token_invalid", "This reset link is invalid or has already been used.")
          : t(key)
      );
      // A dead token can't be retried — flip to the expired view.
      if (key === "reset_token_invalid" || key === "reset_token_expired") setValid(false);
    } finally {
      setBusy(false);
    }
  }

  const rule = (ok: boolean, label: string) => (
    <div className={`flex items-center gap-1.5 text-xs ${ok ? "text-ok" : "text-muted"}`}>
      <span className="msr text-[15px]">{ok ? "check_circle" : "radio_button_unchecked"}</span>
      {label}
    </div>
  );

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-bg">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <div className="w-10 h-10 rounded-[10px] bg-accent text-bg flex items-center justify-center font-bold text-lg">
            {biz?.initial || "B"}
          </div>
          <div>
            <div className="font-bold text-ink leading-tight">
              {biz?.business_name || "Balkan Car Rentals"}
            </div>
            <div className="text-[0.6rem] tracking-[0.14em] uppercase text-muted">
              {biz?.tagline || "Fleet Console"}
            </div>
          </div>
        </div>

        <div className="card p-6 space-y-4">
          <h1 className="text-lg font-semibold flex items-center gap-2">
            <span className="msr text-[20px]">password</span>
            {tf("reset_password_title", "Set a new password")}
          </h1>

          {done ? (
            <div className="space-y-4">
              <div className="text-sm text-ink flex items-start gap-2">
                <span className="msr text-[18px] text-ok">check_circle</span>
                {tf("password_reset_done", "Your password has been updated. You can sign in now.")}
              </div>
              <button className="btn btn-primary w-full" onClick={() => router.replace("/login")}>
                {tf("back_to_login", "Back to sign in")}
              </button>
            </div>
          ) : valid === null ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : !valid ? (
            <div className="space-y-4">
              <div className="text-sm text-danger flex items-start gap-2">
                <span className="msr text-[18px]">error</span>
                {tf("reset_token_expired", "This reset link has expired. Please request a new one.")}
              </div>
              <button className="btn w-full" onClick={() => router.replace("/login")}>
                {tf("back_to_login", "Back to sign in")}
              </button>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs text-muted">{tf("new_password", "New password")}</label>
                <div className="flex items-center gap-2">
                  <input
                    type={show ? "text" : "password"}
                    value={pw}
                    onChange={(e) => setPw(e.target.value)}
                    autoFocus
                    autoComplete="new-password"
                    className="flex-1 min-w-0"
                  />
                  <button
                    type="button"
                    className="btn !p-2"
                    onClick={() => setShow((v) => !v)}
                    aria-label={show ? "hide password" : "show password"}
                  >
                    <span className="msr text-[16px]">{show ? "visibility_off" : "visibility"}</span>
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                {rule(
                  strength.longEnough,
                  tf("password_min_chars", `At least ${strength.min} characters`)
                )}
                {rule(
                  strength.classes >= (policy?.min_classes ?? 3),
                  tf(
                    "password_mix_hint",
                    "Mix at least three of: lowercase, uppercase, digits, symbols"
                  )
                )}
              </div>

              <div className="space-y-1.5">
                <label className="text-xs text-muted">
                  {tf("confirm_password", "Confirm password")}
                </label>
                <input
                  type={show ? "text" : "password"}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                />
                {confirm.length > 0 && !matches && (
                  <div className="text-xs text-danger">
                    {tf("passwords_no_match", "Passwords do not match.")}
                  </div>
                )}
              </div>

              {err && (
                <div className="text-sm text-danger flex items-center gap-1.5">
                  <span className="msr text-[18px]">error</span>
                  {err}
                </div>
              )}

              <button
                type="submit"
                className="btn btn-primary w-full"
                disabled={busy || !strength.ok || !matches}
              >
                {busy ? "…" : tf("reset_btn", "Update password")}
              </button>
            </form>
          )}
        </div>
      </div>
    </main>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary under the App Router.
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}
