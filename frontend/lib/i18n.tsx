"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { apiGet } from "./api";

type Dict = Record<string, string>;

interface I18nCtx {
  t: (key: string) => string;
  lang: string;
  setLang: (lang: string) => void;
  ready: boolean;
}

const Ctx = createContext<I18nCtx>({
  t: (k) => k,
  lang: "tr",
  setLang: () => {},
  ready: false,
});

function initialLang(): string {
  if (typeof window !== "undefined") {
    return window.localStorage.getItem("bcr_lang") || "tr";
  }
  return "tr";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<string>("tr");
  const [dict, setDict] = useState<Dict>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setLangState(initialLang());
  }, []);

  useEffect(() => {
    let active = true;
    setReady(false);
    apiGet<Dict>(`/api/i18n/${lang}.json`)
      .then((d) => {
        if (active) {
          setDict(d);
          setReady(true);
        }
      })
      .catch(() => active && setReady(true));
    return () => {
      active = false;
    };
  }, [lang]);

  const t = useCallback((key: string) => dict[key] ?? key, [dict]);
  const setLang = useCallback((l: string) => {
    setLangState(l);
    if (typeof window !== "undefined") window.localStorage.setItem("bcr_lang", l);
  }, []);

  return <Ctx.Provider value={{ t, lang, setLang, ready }}>{children}</Ctx.Provider>;
}

export const useI18n = () => useContext(Ctx);
export const useT = () => useContext(Ctx).t;
