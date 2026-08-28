"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { useToast } from "@/lib/toast";
import { Skeleton } from "@/components/Skeleton";

// English fallback when a key isn't in the dictionary.
const f = (t: (k: string) => string, key: string, fb: string) =>
  t(key) === key ? fb : t(key);

interface InvoiceMeta {
  languages: Record<string, string>;
  default_lang: string;
}

export default function Page({ params }: { params: { dealId: string } }) {
  const { dealId } = params;
  const t = useT();
  const toast = useToast();
  const router = useRouter();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);

  const [langs, setLangs] = useState<Record<string, string>>({});
  const [sel, setSel] = useState<string>("");
  const [html, setHtml] = useState<string>("");
  const [metaLoading, setMetaLoading] = useState(true);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [err, setErr] = useState<string>("");
  const [downloading, setDownloading] = useState(false);

  // Load the invoice's languages + stored default language.
  useEffect(() => {
    let active = true;
    setMetaLoading(true);
    setErr("");
    api<InvoiceMeta>(`/api/rentals/${encodeURIComponent(dealId)}/invoice-meta`)
      .then((m) => {
        if (!active) return;
        setLangs(m.languages || {});
        setSel(m.default_lang || "tr");
      })
      .catch((e: any) => {
        if (!active) return;
        setErr(
          e?.status === 404
            ? f(t, "not_found", "Invoice not found.")
            : t(e?.key || "error")
        );
      })
      .finally(() => active && setMetaLoading(false));
    return () => {
      active = false;
    };
  }, [dealId, t]);

  // (Re)fetch the embedded HTML preview whenever the selected language changes.
  useEffect(() => {
    if (!sel) return;
    let active = true;
    setPreviewLoading(true);
    api<string>(
      `/api/rentals/${encodeURIComponent(dealId)}/invoice.html?lang=${encodeURIComponent(sel)}`
    )
      .then((doc) => active && setHtml(doc))
      .catch((e: any) => {
        if (!active) return;
        setErr(
          e?.status === 404
            ? f(t, "not_found", "Invoice not found.")
            : t(e?.key || "error")
        );
      })
      .finally(() => active && setPreviewLoading(false));
    return () => {
      active = false;
    };
  }, [dealId, sel, t]);

  const download = useCallback(async () => {
    setDownloading(true);
    try {
      const res = await api(
        `/api/rentals/${encodeURIComponent(dealId)}/invoice.pdf?lang=${encodeURIComponent(sel)}`,
        { raw: true }
      );
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `invoice_${dealId}_${sel}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      toast.error(e?.status === 404 ? f(t, "not_found", "Invoice not found.") : t(e?.key || "error"));
    } finally {
      setDownloading(false);
    }
  }, [dealId, sel, t]);

  function printInvoice() {
    iframeRef.current?.contentWindow?.print();
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <button className="btn !py-1.5 !px-3 text-xs" onClick={() => router.back()}>
            <span className="msr text-[16px]">arrow_back</span>
            {f(t, "back", "Back")}
          </button>
          <span className="msr text-[22px]">receipt_long</span>
          <h1 className="text-xl font-bold truncate">
            {f(t, "print_invoice", "Invoice")} · {dealId}
          </h1>
        </div>
      </div>

      {err && !metaLoading ? (
        <div className="card p-6 text-sm text-danger">{err}</div>
      ) : metaLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-1/3" />
        </div>
      ) : (
        <>
          {/* Language selector */}
          <div className="card p-4 space-y-2">
            <div className="text-xs text-muted">{f(t, "invoice_language", "Invoice Language")}</div>
            <div className="flex items-center gap-2 flex-wrap">
              {Object.entries(langs).map(([code, label]) => (
                <label
                  key={code}
                  className={`btn !py-1.5 !px-3 text-xs cursor-pointer ${
                    sel === code ? "btn-primary" : ""
                  }`}
                  title={label}
                >
                  <input
                    type="radio"
                    name="invoice-lang"
                    value={code}
                    checked={sel === code}
                    onChange={() => setSel(code)}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            <button className="btn btn-primary flex-1" onClick={download} disabled={downloading}>
              <span className="msr text-[18px]">download</span>
              {downloading ? "…" : f(t, "download_pdf", "Download PDF")}
            </button>
            <button className="btn !px-4" onClick={printInvoice} disabled={previewLoading || !html}>
              <span className="msr text-[18px]">print</span>
              {f(t, "print", "Print")}
            </button>
          </div>

          {/* Embedded preview */}
          <div className="card p-2 relative">
            {previewLoading && (
              <div className="absolute inset-0 bg-bg/60 z-10 p-4 space-y-2">
                <Skeleton className="h-8 w-2/3" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-5/6" />
                <Skeleton className="h-40 w-full" />
              </div>
            )}
            <iframe
              ref={iframeRef}
              srcDoc={html}
              title="invoice"
              className="w-full rounded-md bg-white"
              style={{ height: 900, border: "0" }}
            />
          </div>
        </>
      )}
    </div>
  );
}
