"use client";
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { apiGet } from "./api";
import { formatMoneyDisplay } from "./money";
import type { BusinessInfo } from "./types";

/** Mirrors DEFAULT_EUR_ALL_RATE in data/repositories/app_settings.py. Only ever
 *  used before /api/business/name has answered. */
export const DEFAULT_EUR_ALL_RATE = 92;

interface CurrencyCtx {
  currency: string;
  exchangeRate: number;
  /** Re-read the setting from the server. Settings calls this after saving, so
   *  the switch takes effect app-wide without a page reload. */
  refresh: () => Promise<void>;
}

const Ctx = createContext<CurrencyCtx>({
  currency: "EUR",
  exchangeRate: DEFAULT_EUR_ALL_RATE,
  refresh: async () => {},
});

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState({ currency: "EUR", exchangeRate: DEFAULT_EUR_ALL_RATE });

  const load = useCallback(async () => {
    try {
      const d = await apiGet<BusinessInfo>("/api/business/name");
      setState({
        currency: d.currency || "EUR",
        exchangeRate: d.exchange_rate || DEFAULT_EUR_ALL_RATE,
      });
    } catch {
      /* keep whatever we already had */
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Ctx.Provider value={{ ...state, refresh: load }}>{children}</Ctx.Provider>
  );
}

export const useCurrency = () => useContext(Ctx);

/**
 * The app-wide money formatter — the frontend twin of
 * ui/components.format_money_display. Every screen that shows money uses this,
 * so the display-currency setting means the same thing everywhere.
 */
export function useMoney(): (cents: number | null | undefined) => string {
  const { currency, exchangeRate } = useCurrency();
  return useCallback(
    (cents: number | null | undefined) => formatMoneyDisplay(cents, currency, exchangeRate),
    [currency, exchangeRate]
  );
}
