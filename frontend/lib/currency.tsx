"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { apiGet } from "./api";
import type { BusinessInfo } from "./types";

interface CurrencyCtx {
  currency: string;
  exchangeRate: number;
}

const Ctx = createContext<CurrencyCtx>({ currency: "EUR", exchangeRate: 92 });

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<CurrencyCtx>({ currency: "EUR", exchangeRate: 92 });

  useEffect(() => {
    let active = true;
    apiGet<BusinessInfo>("/api/business/name")
      .then((d) => {
        if (active) {
          setState({
            currency: d.currency || "EUR",
            exchangeRate: d.exchange_rate || 92,
          });
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  return <Ctx.Provider value={state}>{children}</Ctx.Provider>;
}

export const useCurrency = () => useContext(Ctx);
