"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { Sidebar } from "@/components/Sidebar";
import { BottomNav } from "@/components/BottomNav";
import { Skeleton } from "@/components/Skeleton";

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
      <div className="min-h-screen flex items-center justify-center px-6">
        <div className="w-full max-w-sm space-y-3">
          <Skeleton className="h-6 w-1/2 mx-auto" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>
    );
  }

  return (
    // `100dvh` rather than `100vh`: on mobile Safari the URL bar collapsing
    // mid-scroll changes vh and shifts the layout. Identical on desktop.
    <div className="flex min-h-[100dvh]">
      {/* Tablet + desktop. Below 768px this is display:none and BottomNav takes over. */}
      <Sidebar />
      <main
        className="flex-1 min-w-0 px-4 py-4 md:px-6 md:py-6 lg:px-8 lg:py-7
                   pb-[calc(4rem+env(safe-area-inset-bottom))] md:pb-6 lg:pb-7"
      >
        <div className="min-w-0 max-w-[1200px] mx-auto">{children}</div>
      </main>
      <BottomNav />
    </div>
  );
}
