"""Customer report downloads — a rental timeline PDF + a flat CSV.

The PDF reuses ui/pdf.build_timeline_pdf in "customer-row" mode: one row per
customer, each rental drawn as a bar on a shared monthly day axis and labelled
with the car + its metadata (id · plate · colour). The CSV is one row per rental
with the customer and the car's metadata, for opening in Excel/Sheets. Both cover
active AND closed rentals and are gated view_management (same as the Customers
page). Money is INTEGER CENTS; formatted at the edge via format_eur.
"""
from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, Response

from api.deps import require
from config.i18n import t_lang
from config.settings import LANGUAGES
from data.repositories import app_settings as app_cfg
from data.repositories import rentals as rrepo
from ui.components import format_eur
from ui.pdf import build_timeline_pdf

router = APIRouter(prefix="/api/reports", tags=["customer-reports"])


def _car_label(r: dict) -> str:
    """Bar text for the timeline: the car plus the metadata that fits."""
    meta = " · ".join(
        b for b in [str(r.get("vehicle_id") or ""),
                    (r.get("license_plate") or "").strip(),
                    (r.get("color") or "").strip()]
        if b
    )
    car = r.get("make_model") or r.get("vehicle_id") or "—"
    return f"{car} · {meta}" if meta else str(car)


def _cust_key(r: dict) -> str:
    """A stable per-customer key: prefer the ID/passport, fall back to the name."""
    return ((r.get("id_passport") or "").strip()
            or (r.get("client_name") or "").strip()
            or str(r.get("deal_id")))


@router.get("/customers.csv")
def customers_report_csv(user: dict = Depends(require("view_management"))) -> Response:
    rentals = rrepo.list_all_rentals_with_vehicle()
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["Customer", "Phone", "ID/Passport", "Vehicle", "Model", "Plate",
                "Colour", "Status", "Start", "End", "Days", "Daily Rate", "Total"])
    for r in rentals:
        w.writerow([
            r.get("client_name", ""), r.get("phone", ""), r.get("id_passport", ""),
            r.get("vehicle_id", ""), r.get("make_model", ""), r.get("license_plate", ""),
            r.get("color", ""), r.get("status", ""), r.get("start_dt", ""), r.get("end_dt", ""),
            r.get("rental_days", ""), format_eur(int(r.get("daily_rate") or 0)),
            format_eur(int(r.get("total_amount") or 0)),
        ])
    body = "﻿" + buf.getvalue()  # BOM so Excel reads UTF-8 (€ glyph)
    return Response(content=body, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="customers-report.csv"'})


@router.get("/customers-timeline.pdf")
def customers_timeline_pdf(lang: str = "",
                           user: dict = Depends(require("view_management"))) -> Response:
    lang = lang if lang in LANGUAGES else "tr"
    rentals = [dict(r) for r in rrepo.list_all_rentals_with_vehicle()]

    # One ordered row per distinct customer; tag each rental with its customer key
    # and the car label the bar will show.
    rows: list[dict] = []
    seen: set[str] = set()
    for r in rentals:
        key = _cust_key(r)
        r["cust_key"] = key
        r["car_label"] = _car_label(r)
        if key not in seen:
            seen.add(key)
            rows.append({"cust_key": key, "client_name": r.get("client_name"),
                         "phone": r.get("phone")})

    header = t_lang("col_customer", lang)
    if header == "col_customer":  # t_lang echoes the key when a translation is missing
        header = "Customer"

    def _row_label(c: dict) -> str:
        nm = c.get("client_name") or "—"
        return f"{nm} · {c.get('phone')}" if c.get("phone") else nm

    pdf = build_timeline_pdf(
        rows, rentals,
        business_name=app_cfg.get_business_name(), lang=lang, logo=app_cfg.get_logo(),
        row_key="cust_key", row_label=_row_label, bar_label_key="car_label",
        header_label=header, bar_state=lambda r, now: "ok",  # neutral tint (history view)
    )
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="customers-timeline.pdf"'})
