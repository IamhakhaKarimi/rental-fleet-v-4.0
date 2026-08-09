"""Fleet occupancy timeline — PDF export.

Mirrors the Streamlit Reservations export modal: the chosen range forces the
PDF's time axis. Reuses ``ui.pdf.build_timeline_pdf`` (landscape-A4 Gantt with the
per-day number grid) over the same fleet + active-rental data as the on-screen
timeline, so the download matches the calendar 1:1. Gated like the timeline
itself (``view_management``).

Ranges:
  * ``week``       — the current Mon→Sun week (one page).
  * ``month``      — the current calendar month (one page).
  * ``two_month``  — the current month + the next, on a single page.
  * ``all_months`` — every month spanned by the active rentals, each rendered on
                     its **own separate page** (``build_timeline_pdf`` starts a
                     fresh page per window).
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Query, Response

from api.concurrency import heavy_slot
from api.deps import require
from config.i18n import month_name, t_lang
from config.settings import LANGUAGES
from data.repositories import app_settings as app_cfg
from data.repositories import rentals as rrepo
from data.repositories import vehicles as vrepo
from ui.pdf import build_timeline_pdf

router = APIRouter(prefix="/api/timeline", tags=["timeline"])

_RANGES = ("week", "month", "two_month", "all_months", "year")
# Safety cap so a stray far-future rental can't spawn hundreds of pages.
_MAX_MONTH_PAGES = 36


def _add_months(year: int, month: int, n: int) -> tuple[int, int]:
    idx = year * 12 + (month - 1) + n
    return idx // 12, idx % 12 + 1


def _parse(value) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value).replace(" ", "T"))
    except Exception:
        return None


def _month_label(year: int, month: int, lang: str) -> str:
    return f"{month_name(month, lang)} {year}"


def _windows(mode: str, now: datetime, lang: str, active: list[dict]):
    """Build the (start, end, label) window list + a filename for a range mode.
    week/month/two_month produce a single window; all_months produces one window
    per month across the active-rental span (each → its own PDF page)."""
    if mode == "week":
        ws = datetime(now.year, now.month, now.day) - timedelta(days=now.weekday())
        return [(ws, ws + timedelta(days=7), t_lang("tl_range_week", lang))], "timeline_week"

    if mode == "month":
        ws = datetime(now.year, now.month, 1)
        ny, nm = _add_months(now.year, now.month, 1)
        return [(ws, datetime(ny, nm, 1), _month_label(now.year, now.month, lang))], "timeline_month"

    if mode == "two_month":
        ws = datetime(now.year, now.month, 1)
        m2y, m2m = _add_months(now.year, now.month, 1)   # the 2nd month
        ey, em = _add_months(now.year, now.month, 2)     # exclusive end
        if m2y == now.year:
            label = f"{month_name(now.month, lang)} – {month_name(m2m, lang)} {now.year}"
        else:
            label = f"{_month_label(now.year, now.month, lang)} – {_month_label(m2y, m2m, lang)}"
        return [(ws, datetime(ey, em, 1), label)], "timeline_two_month"

    if mode == "all_months":
        starts = [s for r in active if (s := _parse(r.get("start_dt")))]
        ends = [e for r in active if (e := _parse(r.get("end_dt")))]
        if starts and ends:
            first_y, first_m = min(starts).year, min(starts).month
            le = max(ends)
            last_y, last_m = le.year, le.month
        else:
            first_y = last_y = now.year
            first_m = last_m = now.month
        windows = []
        y, m = first_y, first_m
        while (y, m) <= (last_y, last_m) and len(windows) < _MAX_MONTH_PAGES:
            ny, nm = _add_months(y, m, 1)
            windows.append((datetime(y, m, 1), datetime(ny, nm, 1), _month_label(y, m, lang)))
            y, m = ny, nm
        return windows, "timeline_all_months"

    # year — Jan 1 → next Jan 1, the full-year calendar on one page
    ws = datetime(now.year, 1, 1)
    return [(ws, datetime(now.year + 1, 1, 1), str(now.year))], "timeline_year"


@router.get("/pdf")
def timeline_pdf(
    range: str = Query("week", alias="range"),
    lang: str = "tr",
    user: dict = Depends(require("view_management")),
    # `all_months` can render up to _MAX_MONTH_PAGES pages of Gantt grid. Rate
    # limiting cannot bound how many run AT ONCE — only this can. See §8.4.
    _slot: dict = Depends(heavy_slot),
) -> Response:
    if range not in _RANGES:
        raise HTTPException(404, detail="not_found")
    if lang not in LANGUAGES:
        lang = "tr"
    now = datetime.now()
    fleet = vrepo.list_vehicles()
    active = rrepo.list_active_rentals_with_vehicle()
    windows, fname = _windows(range, now, lang, active)
    pdf = build_timeline_pdf(
        fleet, active, business_name=app_cfg.get_business_name(),
        lang=lang, logo=app_cfg.get_logo() or "", now=now, windows=windows,
    )
    return Response(
        content=bytes(pdf), media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{fname}.pdf"'},
    )
