"use client";
import { createContext, useCallback, useContext, useEffect } from "react";
import { apiGet } from "./api";
import { useAuth } from "./auth";

interface ThemeData {
  tokens: Record<string, string>;
  fonts?: string[];
  defaults?: Record<string, string>;
}

const Ctx = createContext<{ refreshTheme: () => void }>({ refreshTheme: () => {} });

/**
 * Apply the stored brand theme to CSS variables. We inject a <style> with :root
 * overrides (not inline on <html>) so the per-session night-mode `.dark` rules —
 * which have higher specificity — still win in dark mode. Maps the 8 stored theme
 * values onto the app's token set (accent=primary, info/accent-hover=secondary,
 * ok=success, warn=warning, danger=alert, archived=disabled, bg=bg) and lazy-loads
 * the chosen Google font.
 */
function applyTheme(t: Record<string, string>) {
  if (!t) return;
  const map: Record<string, string | undefined> = {
    "--bg": t.bg,
    "--accent": t.primary,
    "--accent-hover": t.secondary,
    "--info": t.secondary,
    "--ok": t.success,
    "--warn": t.warning,
    "--danger": t.alert,
    "--archived": t.disabled,
  };
  let css = ":root{";
  for (const [k, v] of Object.entries(map)) if (v) css += `${k}:${v};`;
  if (t.font) {
    css += `--font-display:'${t.font}',system-ui,sans-serif;--font-body:'${t.font}',system-ui,sans-serif;`;
    const fid = "bcr-theme-font";
    let link = document.getElementById(fid) as HTMLLinkElement | null;
    if (!link) {
      link = document.createElement("link");
      link.id = fid;
      link.rel = "stylesheet";
      document.head.appendChild(link);
    }
    link.href = `https://fonts.googleapis.com/css2?family=${t.font.replace(/ /g, "+")}:wght@400;500;600;700;800&display=swap`;
  }
  css += "}";
  const sid = "bcr-theme";
  let style = document.getElementById(sid) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = sid;
    document.head.appendChild(style);
  }
  style.textContent = css;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();

  const refreshTheme = useCallback(() => {
    apiGet<ThemeData>("/api/theme")
      .then((d) => applyTheme(d?.tokens))
      .catch(() => {});
  }, []);

  // Apply on load and whenever the signed-in user changes (theme is global).
  useEffect(() => {
    refreshTheme();
  }, [user?.username, refreshTheme]);

  return <Ctx.Provider value={{ refreshTheme }}>{children}</Ctx.Provider>;
}

export const useTheme = () => useContext(Ctx);
