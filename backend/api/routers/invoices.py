"""Invoice router — rental invoice as standalone HTML (preview/print) + PDF.

Reuses ui/invoice.build_invoice_html + ui/pdf.build_invoice_pdf verbatim (now
Streamlit-free). Language defaults to the rental's stored invoice_lang; any of the
six LANGUAGES may be requested. Logo/stamp come from app_settings.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from api.deps import require
from config.settings import LANGUAGES
from data.repositories import app_settings as app_cfg
from data.repositories import rentals as rrepo
from ui.invoice import build_invoice_html, build_invoices_batch_html
from ui.pdf import build_invoice_pdf

router = APIRouter(prefix="/api/rentals", tags=["invoices"])


def _ctx(deal_id: str, lang: str):
    deal = rrepo.get_rental_full(deal_id)
    if not deal:
        raise HTTPException(404, detail="not_found")
    charges = rrepo.list_charges_for_deal(deal_id)
    if lang not in LANGUAGES:
        lang = deal.get("invoice_lang") or "tr"
    return deal, charges, app_cfg.get_business_name(), lang, app_cfg.get_logo(), app_cfg.get_stamp()


@router.get("/{deal_id}/invoice-meta")
def invoice_meta(deal_id: str, user: dict = Depends(require("view_management"))) -> dict:
    deal = rrepo.get_rental_full(deal_id)
    if not deal:
        raise HTTPException(404, detail="not_found")
    return {"languages": LANGUAGES, "default_lang": deal.get("invoice_lang") or "tr"}


@router.get("/{deal_id}/invoice.html", response_class=HTMLResponse)
def invoice_html(deal_id: str, lang: str = "",
                 user: dict = Depends(require("view_management"))) -> HTMLResponse:
    deal, charges, biz, lang, logo, stamp = _ctx(deal_id, lang)
    return HTMLResponse(content=build_invoice_html(deal, charges, biz, lang, logo, stamp))


@router.get("/{deal_id}/invoice.pdf")
def invoice_pdf(deal_id: str, lang: str = "",
                user: dict = Depends(require("view_management"))) -> Response:
    deal, charges, biz, lang, logo, stamp = _ctx(deal_id, lang)
    pdf = build_invoice_pdf(deal, charges, biz, lang, logo, stamp)
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="invoice_{deal_id}_{lang}.pdf"'},
    )


class BatchInvoicesIn(BaseModel):
    deal_ids: list[str]
    lang: str = ""


@router.post("/invoices-batch.html", response_class=HTMLResponse)
def invoices_batch_html(body: BatchInvoicesIn,
                        user: dict = Depends(require("view_management"))) -> HTMLResponse:
    """One printable HTML doc with a single OFFICE copy per selected rental — the
    Customers-page "print active invoices" run. Skips any missing deal id and 404s
    only if nothing valid was selected."""
    items = []
    for did in body.deal_ids:
        deal = rrepo.get_rental_full(did)
        if not deal:
            continue
        items.append((deal, rrepo.list_charges_for_deal(did)))
    if not items:
        raise HTTPException(404, detail="not_found")
    lang = body.lang if body.lang in LANGUAGES else "tr"
    html = build_invoices_batch_html(items, app_cfg.get_business_name(), lang,
                                     app_cfg.get_logo(), app_cfg.get_stamp())
    return HTMLResponse(content=html)
