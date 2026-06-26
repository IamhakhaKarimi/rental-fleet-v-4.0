"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { apiGet } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useT } from "@/lib/i18n";
import type { BusinessInfo } from "@/lib/types";

export default function LoginPage() {
  const { login, user, loading } = useAuth();
  const t = useT();
  const router = useRouter();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [biz, setBiz] = useState<BusinessInfo | null>(null);

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

          <label className="flex items-center gap-2 text-sm text-muted select-none">
            <input type="checkbox" className="w-auto" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            {t("login_remember")}
          </label>

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
      </div>
    </main>
  );
}
