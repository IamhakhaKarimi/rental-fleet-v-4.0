"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Sidebar } from "@/components/Sidebar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { setLang } = useI18n();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [user, loading, router]);

  // Adopt the user's stored UI language on login/restore.
  useEffect(() => {
    if (user?.lang) setLang(user.lang);
  }, [user?.lang, setLang]);

  if (loading || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted">…</div>
    );
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      <main className="flex-1 min-w-0 px-5 py-6 md:px-8 md:py-7">
        <div className="max-w-[1200px] mx-auto">{children}</div>
      </main>
    </div>
  );
}
