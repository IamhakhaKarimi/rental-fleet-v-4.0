"""Customer report downloads — a rental timeline PDF, a paginated table PDF, and a
flat CSV.

The timeline PDF reuses ui/pdf.build_timeline_pdf in "customer-row" mode: one row
per customer, each rental drawn as a bar on a shared monthly day axis. The TABLE
PDF (build_paged_table_pdf) is the plain client list: the caller picks which
columns to print and in which order, which months of rentals to include, how to
sort, and how many rows fit on a page — every page carries the column header and a
numbered footer.
The CSV is the same column selection in spreadsheet form. Both draw from one
column registry (_COLUMNS) so a column added there shows up in both reports.

All three cover active AND closed rentals and are gated view_management (same as
the Customers page). Money is INTEGER CENTS; formatted at the edge via format_money_display,
so the report honours the business display currency like every other surface.
"""
from __future__ import annotations

import csv
import io
from datetime import datetime

from fastapi import APIRouter, Depends, Response
from pydantic import BaseModel

from api.concurrency import heavy_slot
from api.deps import require
from config.i18n import t_lang
from config.settings import LANGUAGES
from data.repositories import app_settings as app_cfg
from data.repositories import rentals as rrepo
from ui.components import format_money_display
from ui.pdf import build_paged_table_pdf, build_timeline_pdf

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


def _split_dt(value: object) -> tuple[str, str]:
    """ISO timestamp → ("YYYY-MM-DD", "HH:MM"). Date-only values get an empty time."""
    txt = str(value or "").strip().replace("T", " ")
    if not txt:
        return "", ""
    date, _, rest = txt.partition(" ")
    return date, rest.strip()[:5]


def _label(key: str, fallback: str, lang: str) -> str:
    """Translated column header, falling back to English. t_lang echoes the key
    back when a language has no entry for it."""
    got = t_lang(key, lang)
    return fallback if got == key else got


# ── Column registry ──────────────────────────────────────────────────────────
# key -> (i18n key, English fallback, value(rental) -> str, relative PDF width).
# The declaration order here is the order columns are emitted in, whatever order
# the caller ticked them in — a report reads better with a stable column layout.
_COLUMNS: dict[str, tuple[str, str, object, float]] = {
    "month":       ("col_month", "Month",       lambda r: _split_dt(r.get("start_dt"))[0][:7], 1.1),
    "customer":    ("client_name", "Customer",  lambda r: str(r.get("client_name") or ""), 2.4),
    "phone":       ("client_phone", "Phone",    lambda r: str(r.get("phone") or ""), 1.6),
    "id_passport": ("client_id", "ID / Passport", lambda r: str(r.get("id_passport") or ""), 1.6),
    "vehicle_id":  ("col_vehicle_id", "Car ID", lambda r: str(r.get("vehicle_id") or ""), 0.9),
    "make_model":  ("invoice_vehicle", "Vehicle", lambda r: str(r.get("make_model") or ""), 2.0),
    "plate":       ("col_plate", "Plate",       lambda r: str(r.get("license_plate") or ""), 1.4),
    "color":       ("col_colour", "Colour",     lambda r: str(r.get("color") or ""), 1.0),
    "status":      ("col_status", "Status",     lambda r: str(r.get("status") or ""), 1.0),
    "start_date":  ("start_date", "Start Date", lambda r: _split_dt(r.get("start_dt"))[0], 1.4),
    "start_time":  ("col_start_time", "Start Time", lambda r: _split_dt(r.get("start_dt"))[1], 1.0),
    "end_date":    ("return_date", "End Date",  lambda r: _split_dt(r.get("end_dt"))[0], 1.4),
    "end_time":    ("col_end_time", "End Time", lambda r: _split_dt(r.get("end_dt"))[1], 1.0),
    "days":        ("days", "Days",             lambda r: str(r.get("rental_days") or ""), 0.7),
    "daily_rate":  ("negotiated_rate", "Daily Rate",
                    lambda r: format_money_display(int(r.get("daily_rate") or 0)), 1.1),
    "total":       ("live_total", "Total",
                    lambda r: format_money_display(int(r.get("total_amount") or 0)), 1.2),
}

# What a report contains when the caller names no columns — the full set, which
# keeps the plain GET /customers.csv byte-compatible with what it returned before
# column picking existed.
_DEFAULT_COLUMNS = list(_COLUMNS)


def _pick_columns(columns: list[str] | None) -> list[str]:
    """Validate a requested column list, KEEPING THE CALLER'S ORDER — the report
    modal lets the user drag the columns into the layout they want, so the request
    order is the print order. Unknown keys and repeats are dropped; an empty or
    fully-invalid request falls back to every column in registry order."""
    if not columns:
        return list(_DEFAULT_COLUMNS)
    chosen: list[str] = []
    for key in columns:
        if key in _COLUMNS and key not in chosen:
            chosen.append(key)
    return chosen or list(_DEFAULT_COLUMNS)


def _sort_rentals(rentals: list[dict], sort_by: str) -> list[dict]:
    """A–Z by client, by reservation (start) date, or by the car's Make/Model
    starting letter. Every ordering breaks ties on the start date then the deal id
    so the output is stable between identical requests."""
    def _tie(r: dict) -> tuple:
        return (str(r.get("start_dt") or ""), str(r.get("deal_id") or ""))

    if sort_by == "vehicle":
        return sorted(rentals, key=lambda r: (str(r.get("make_model") or "").strip().upper(), *_tie(r)))
    if sort_by == "date":
        return sorted(rentals, key=_tie)
    return sorted(rentals, key=lambda r: (str(r.get("client_name") or "").strip().upper(), *_tie(r)))


def _select(deal_ids: list[str] | None, months: list[str] | None,
            sort_by: str = "name") -> list[dict]:
    """The report's row set: every rental, narrowed to the picked deal ids and/or
    the months the rental STARTED in ("YYYY-MM"), then ordered."""
    rentals = [dict(r) for r in rrepo.list_all_rentals_with_vehicle()]
    if deal_ids:
        wanted = set(deal_ids)
        rentals = [r for r in rentals if str(r.get("deal_id")) in wanted]
    if months:
        keep = set(months)
        rentals = [r for r in rentals if _split_dt(r.get("start_dt"))[0][:7] in keep]
    return _sort_rentals(rentals, sort_by)


class CustomersReportIn(BaseModel):
    """Report selection. Empty deal_ids/months mean "no filter on that axis";
    ``columns`` is ordered — it prints left-to-right exactly as given."""
    deal_ids: list[str] = []
    months: list[str] = []
    columns: list[str] = []
    sort_by: str = "name"          # name | date | vehicle
    numbered: bool = True          # prepend a running "#" column
    page_size: int = 25            # PDF rows per A4 page
    lang: str = ""


@router.get("/columns")
def report_columns(lang: str = "",
                   user: dict = Depends(require("view_management"))) -> list[dict]:
    """Column keys + translated labels, so the report modal can render its
    checkboxes from the same registry the reports are built from."""
    lang = lang if lang in LANGUAGES else "tr"
    return [{"key": k, "label": _label(spec[0], spec[1], lang)}
            for k, spec in _COLUMNS.items()]


@router.get("/customers-rentals")
def customers_rentals(user: dict = Depends(require("view_management"))) -> list[dict]:
    """Lite rental list (active AND closed) that feeds the report modal's
    per-customer / per-month selection."""
    return [
        {"deal_id": r.get("deal_id"), "client_name": r.get("client_name"),
         "phone": r.get("phone"), "make_model": r.get("make_model"),
         "license_plate": r.get("license_plate"), "start_dt": r.get("start_dt"),
         "end_dt": r.get("end_dt"), "status": r.get("status")}
        for r in rrepo.list_all_rentals_with_vehicle()
    ]


def _customers_csv(body: CustomersReportIn) -> Response:
    lang = body.lang if body.lang in LANGUAGES else "tr"
    keys = _pick_columns(body.columns)
    rentals = _select(body.deal_ids, body.months, body.sort_by)

    buf = io.StringIO()
    w = csv.writer(buf)
    head = [_label(_COLUMNS[k][0], _COLUMNS[k][1], lang) for k in keys]
    w.writerow((["#"] if body.numbered else []) + head)
    for n, r in enumerate(rentals, start=1):
        cells = [_COLUMNS[k][2](r) for k in keys]
        w.writerow(([str(n)] if body.numbered else []) + cells)
    body_txt = "﻿" + buf.getvalue()  # BOM so Excel reads UTF-8 (€ glyph)
    return Response(content=body_txt, media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="customers-report.csv"'})


@router.get("/customers.csv")
def customers_report_csv(user: dict = Depends(require("view_management")),
                         _slot: dict = Depends(heavy_slot)) -> Response:
    """Every rental, every column — the no-options download."""
    return _customers_csv(CustomersReportIn())


@router.post("/customers.csv")
def customers_report_csv_selected(body: CustomersReportIn,
                                  user: dict = Depends(require("view_management")),
                                  _slot: dict = Depends(heavy_slot)) -> Response:
    """Same CSV narrowed to the months / columns picked in the report modal."""
    return _customers_csv(body)


@router.post("/customers-table.pdf")
def customers_table_pdf(body: CustomersReportIn,
                        user: dict = Depends(require("view_management")),
                        _slot: dict = Depends(heavy_slot)) -> Response:
    """The client list as a paginated A4 table: chosen columns, rentals limited to
    the chosen start months, sorted A–Z / by reservation date / by Make-Model, with
    25–30 rows per page and a numbered footer."""
    lang = body.lang if body.lang in LANGUAGES else "tr"
    keys = _pick_columns(body.columns)
    rentals = _select(body.deal_ids, body.months, body.sort_by)

    headers = [_label(_COLUMNS[k][0], _COLUMNS[k][1], lang) for k in keys]
    weights = [_COLUMNS[k][3] for k in keys]
    rows = [[_COLUMNS[k][2](r) for k in keys] for r in rentals]
    if body.numbered:
        headers = ["#"] + headers
        weights = [0.5] + weights
        rows = [[str(n)] + row for n, row in enumerate(rows, start=1)]

    sort_name = {"date": _label("start_date", "Start Date", lang),
                 "vehicle": _label("invoice_vehicle", "Vehicle", lang)}.get(
                     body.sort_by, _label("client_name", "Customer", lang))
    months = sorted(set(body.months))
    total_amount = sum(int(r.get("total_amount") or 0) for r in rentals)
    meta = [
        (_label("generated", "Generated", lang), datetime.now().strftime("%Y-%m-%d %H:%M")),
        (_label("select_month", "Months", lang),
         ", ".join(months) if months else _label("all_months", "All months", lang)),
        (_label("sorted_by", "Sorted by", lang), sort_name),
        (_label("customers_count", "Customers", lang), str(len(rows))),
        (_label("total_revenue", "Total Revenue", lang), format_money_display(total_amount)),
    ]

    pdf = build_paged_table_pdf(
        _label("customers_report", "Customer Report", lang),
        headers, rows,
        business_name=app_cfg.get_business_name(), logo=app_cfg.get_logo(),
        meta=meta, page_size=max(10, min(40, int(body.page_size or 25))),
        col_weights=weights,
        page_label=_label("page", "Page", lang), of_label=_label("of", "of", lang),
    )
    return Response(content=pdf, media_type="application/pdf",
                    headers={"Content-Disposition": 'attachment; filename="customers-report.pdf"'})


@router.get("/customers-timeline.pdf")
def customers_timeline_pdf(lang: str = "",
                           user: dict = Depends(require("view_management")),
                           _slot: dict = Depends(heavy_slot)) -> Response:
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
