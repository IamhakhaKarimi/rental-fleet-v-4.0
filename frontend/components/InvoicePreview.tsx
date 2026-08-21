"use client";
import { useEffect, useRef, useState } from "react";
import { apiGet } from "@/lib/api";
import { useMoney } from "@/lib/currency";
import { formatDisplay } from "@/lib/dates";
import type { BusinessInfo } from "@/lib/types";

/**
 * Live miniature of the invoice the client will be handed, shown beside the
 * booking form so the operator sees the document take shape as they type.
 *
 * Deliberately a *pure client-side render* of the form state — no PDF build, no
 * `/api/invoices/*` round-trip per keystroke — so typing stays instant. It
 * mirrors the real document's structure from ui/invoice.py (brand header, no/date
 * meta, Bill-To + Vehicle boxes, line table, totals with the deposit deducted),
 * not its exact print CSS: this is a preview, the PDF remains the source of truth.
 */

type Dict = Record<string, string>;

/** Invoice strings come from the *invoice* language, which is chosen per booking
 *  and is independent of the UI language — so the preview reads as the client's
 *  copy will. Dictionaries are cached per language for the page's lifetime. */
const dictCache = new Map<string, Dict>();

function useInvoiceDict(lang: string): (key: string, fallback: string) => string {
  const [, force] = useState(0);
  const langRef = useRef(lang);
  langRef.current = lang;

  useEffect(() => {
    if (!lang || dictCache.has(lang)) return;
    let alive = true;
    apiGet<Dict>(`/api/i18n/${lang}.json`)
      .then((d) => {
        dictCache.set(lang, d);
        if (alive && langRef.current === lang) force((n) => n + 1);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [lang]);

  return (key: string, fallback: string) => dictCache.get(lang)?.[key] || fallback;
}

export interface InvoicePreviewData {
  businessName: string;
  tagline?: string;
  clientName: string;
  phone: string;
  idPassport: string;
  vehicleId: string;
  makeModel: string;
  licensePlate: string;
  startDate: string;
  startTime: string;
  returnDate: string;
  returnTime: string;
  days: number;
  dailyRateEuros: number;
  depositEuros: number;
  invoiceLang: string;
  issuedBy?: string;
}

export function InvoicePreview({ data }: { data: InvoicePreviewData }) {
  const T = useInvoiceDict(data.invoiceLang || "tr");
  const fmt = useMoney();

  const subtotal = Math.max(0, data.days) * Math.max(0, data.dailyRateEuros) * 100;
  const deposit = Math.max(0, data.depositEuros) * 100;
  const balance = subtotal - deposit;

  const period = `${formatDisplay(data.startDate, data.invoiceLang) || "—"} ${data.startTime} → ${
    formatDisplay(data.returnDate, data.invoiceLang) || "—"
  } ${data.returnTime}`;

  const dash = (v: string) => (v || "").trim() || "—";

  return (
    <div className="inv-prev" aria-hidden="true">
      <div className="inv-prev-sheet">
        <div className="inv-prev-top">
          <div className="inv-prev-brand">
            {data.businessName}
            {data.tagline && <small>{data.tagline}</small>}
          </div>
          <div className="inv-prev-title">
            <h4>{T("invoice_heading", "INVOICE")}</h4>
            <div className="inv-prev-meta">
              <div>
                {T("invoice_no", "Invoice No")}: <b>—</b>
              </div>
              <div>
                {T("invoice_date", "Date")}: <b>{formatDisplay(new Date().toISOString().slice(0, 10), data.invoiceLang)}</b>
              </div>
              {data.issuedBy && (
                <div>
                  {T("invoice_issued_by", "Issued by")}: <b>{data.issuedBy}</b>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="inv-prev-cols">
          <div className="inv-prev-box">
            <div className="inv-prev-lbl">{T("bill_to", "Bill To")}</div>
            <div className="inv-prev-val">
              <b>{dash(data.clientName)}</b>
              <br />
              {dash(data.phone)} &nbsp; {dash(data.idPassport)}
            </div>
          </div>
          <div className="inv-prev-box">
            <div className="inv-prev-lbl">{T("invoice_vehicle", "Vehicle")}</div>
            <div className="inv-prev-val">
              <b>{dash(data.vehicleId)}</b> {data.makeModel}
              {data.licensePlate ? ` · ${data.licensePlate}` : ""}
              <br />
              <span className="inv-prev-lbl inline">{T("invoice_period", "Period")}:</span> {period}
            </div>
          </div>
        </div>

        <table className="inv-prev-table">
          <thead>
            <tr>
              <th>{T("invoice_desc", "Description")}</th>
              <th className="num">{T("invoice_qty", "Qty")}</th>
              <th className="num">{T("invoice_unit", "Unit Price")}</th>
              <th className="num">{T("invoice_amount", "Amount")}</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>{T("invoice_line_rental", "Vehicle Rental")}</td>
              <td className="num">{data.days}</td>
              <td className="num">{fmt(data.dailyRateEuros * 100)}</td>
              <td className="num">{fmt(subtotal)}</td>
            </tr>
          </tbody>
        </table>

        <div className="inv-prev-totals">
          <div>
            <span>{T("invoice_subtotal", "Subtotal")}</span>
            <span className="num">{fmt(subtotal)}</span>
          </div>
          {deposit > 0 && (
            <div>
              <span>− {T("invoice_line_deposit", "Deposit")}</span>
              <span className="num">− {fmt(deposit)}</span>
            </div>
          )}
          <div className="grand">
            <span>{T("invoice_total", "Total")}</span>
            <span className="num">{fmt(balance)}</span>
          </div>
        </div>

        <div className="inv-prev-terms">
          <span className="inv-prev-lbl">{T("terms_title", "Rental Terms")}</span>
          <div className="inv-prev-terms-lines">
            <i />
            <i />
            <i />
            <i />
          </div>
        </div>

        <div className="inv-prev-foot">{T("invoice_thanks", "Thank you for your business.")}</div>
      </div>
    </div>
  );
}

/** Small helper so callers don't have to duplicate the business-name fetch. */
export function useBusinessBrand(): BusinessInfo | null {
  const [biz, setBiz] = useState<BusinessInfo | null>(null);
  useEffect(() => {
    apiGet<BusinessInfo>("/api/business/name").then(setBiz).catch(() => {});
  }, []);
  return biz;
}
