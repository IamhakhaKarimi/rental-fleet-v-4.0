"use client";
import { useEffect, useState } from "react";
import { useT } from "@/lib/i18n";

export function NightModeToggle() {
  const t = useT();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("bcr_dark", next ? "1" : "0");
    } catch {}
  }

  const label = dark ? t("day_mode") : t("night_mode");
  return (
    <button onClick={toggle} className="btn !p-2.5" aria-label={label} title={label}>
      <span className="msr text-[20px]">{dark ? "light_mode" : "dark_mode"}</span>
    </button>
  );
}
