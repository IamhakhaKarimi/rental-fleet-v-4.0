"""Finance report downloads — CSV + PDF for every Finance tab.

Builds (title, headers, rows, total_row) from finance_service / vehicle_costs and
serves it as CSV (utf-8-sig for Excel) or PDF (ui/pdf.build_report_pdf, bundled
DejaVu font). All money is formatted at the edge via format_eur. Gated view_finance.
"""
from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, HTTPException, Response

from api.concurrency import heavy_slot
from api.deps import require
from data.repositories import app_settings as app_cfg
from data.repositories import vehicle_costs as costs_repo
from services import finance_service as fin
from ui.components import format_eur
from ui.pdf import build_report_pdf

router = APIRouter(prefix="/api/finance/report", tags=["finance-reports"])

_SLUGS = {"overview", "monthly", "yearly", "by_vehicle", "by_customer", "expenses"}


def _eur(cents) -> str:
    return format_eur(int(cents or 0))


def _report(slug: str):
    """Return (title, headers, rows, total_row) for a report slug."""
    if slug == "overview":
        s = fin.pnl_summary()
        rev = fin.revenue_summary()
        rows = [
            ["Total Revenue", _eur(rev["total"])],
            ["  Rental", _eur(rev["rental"])],
            ["  Overdue Penalty", _eur(rev["penalty"])],
            ["  Damage", _eur(rev["damage"])],
            ["Total Cost", _eur(s["cost"])],
        ]
        for c in fin.cost_by_type():
            rows.append([f"  {str(c['type']).title()}", _eur(c["amount"])])
        rows += [
            ["Net Profit", _eur(s["net"])],
            ["Profit Margin", f"{s['margin']:.0f}%"],
        ]
        return "Profit & Loss — Overview", ["Item", "Amount"], rows, None

    if slug in ("monthly", "yearly"):
        data = fin.pnl_by_month() if slug == "monthly" else fin.pnl_by_year()
        rows = [[d["period"], _eur(d["income"]), _eur(d["cost"]), _eur(d["net"])] for d in data]
        total = ["TOTAL", _eur(sum(d["income"] for d in data)),
                 _eur(sum(d["cost"] for d in data)), _eur(sum(d["net"] for d in data))]
        title = "Monthly Profit & Loss" if slug == "monthly" else "Yearly Profit & Loss"
        return title, ["Period", "Income", "Cost", "Net"], rows, total

    if slug == "by_vehicle":
        data = fin.profit_by_vehicle()
        rows = [[d["vehicle_id"], d["make_model"], _eur(d["income"]), _eur(d["cost"]), _eur(d["net"])] for d in data]
        total = ["TOTAL", "", _eur(sum(d["income"] for d in data)),
                 _eur(sum(d["cost"] for d in data)), _eur(sum(d["net"] for d in data))]
        return "Profit by Vehicle", ["Vehicle", "Model", "Income", "Cost", "Net"], rows, total

    if slug == "by_customer":
        data = fin.revenue_by_customer()
        rows = [[d["full_name"], d.get("phone", ""), str(d["rentals"]),
                 _eur(d["revenue"]), _eur(d["damage"]), _eur(d["penalty"])] for d in data]
        total = ["TOTAL", "", str(sum(d["rentals"] for d in data)),
                 _eur(sum(d["revenue"] for d in data)), _eur(sum(d["damage"] for d in data)),
                 _eur(sum(d["penalty"] for d in data))]
        return "Revenue by Customer", ["Customer", "Phone", "Rentals", "Revenue", "Damage", "Penalty"], rows, total

    if slug == "expenses":
        data = costs_repo.list_costs(1000)
        rows = [[d.get("period_date", ""), d.get("make_model") or d.get("vehicle_id", ""),
                 str(d.get("type", "")), _eur(d["amount"]), d.get("note", "")] for d in data]
        total = ["TOTAL", "", "", _eur(sum(d["amount"] for d in data)), ""]
        return "Company Expenses", ["Date", "Vehicle", "Type", "Amount", "Note"], rows, total

    raise HTTPException(404, detail="not_found")


@router.get("/{slug}.csv")
def report_csv(slug: str, user: dict = Depends(require("view_finance")),
               _slot: dict = Depends(heavy_slot)) -> Response:
    if slug not in _SLUGS:
        raise HTTPException(404, detail="not_found")
    title, headers, rows, total = _report(slug)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow([title])
    w.writerow([])
    w.writerow(headers)
    for r in rows:
        w.writerow(r)
    if total:
        w.writerow(total)
    body = "﻿" + buf.getvalue()  # BOM so Excel reads UTF-8 (€ glyph)
    return Response(content=body, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": f'attachment; filename="{slug}.csv"'})


@router.get("/{slug}.pdf")
def report_pdf(slug: str, user: dict = Depends(require("view_finance")),
               _slot: dict = Depends(heavy_slot)) -> Response:
    if slug not in _SLUGS:
        raise HTTPException(404, detail="not_found")
    title, headers, rows, total = _report(slug)
    pdf = build_report_pdf(title, headers, rows,
                           business_name=app_cfg.get_business_name(),
                           logo=app_cfg.get_logo(), total_row=total)
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": f'attachment; filename="{slug}.pdf"'})
