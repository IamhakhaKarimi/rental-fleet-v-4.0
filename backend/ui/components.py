"""
Small reusable UI building blocks used across pages.

- format_eur(cents): the one place money becomes a human string.
- page_header / section_header: titles with an info dot that shows help on hover.
- status_badge: a coloured status pill.
- kpi_tile: a single headline metric.
"""

import html
import re
from datetime import datetime

from config.settings import CURRENCY_SYMBOL, STATUS_TOKEN, DEFAULT_LANG
from config.i18n import t, month_name


def format_eur(cents: int) -> str:
    """Integer cents -> '€30' or '€30.50'. Whole amounts drop the decimals."""
    cents = int(cents or 0)
    whole, rem = divmod(abs(cents), 100)
    sign = "-" if cents < 0 else ""
    body = f"{whole:,}" if rem == 0 else f"{whole:,}.{rem:02d}"
    return f"{sign}{CURRENCY_SYMBOL}{body}"


def fmt_date(iso, lang: str = None, with_time: bool = False) -> str:
    """ISO date/datetime text -> a human date with the month spelled out, e.g.
    '23 June 2026' (+ ' 18:30' when with_time). `lang` defaults to the session
    language. Falls back to the plain ISO slice if the value can't be parsed."""
    if not iso:
        return ""
    s = str(iso)
    if not lang:
        import streamlit as st
        lang = st.session_state.get("lang", DEFAULT_LANG)
    try:
        dt = datetime.fromisoformat(s)
        out = f"{dt.day} {month_name(dt.month, lang)} {dt.year}"
        if with_time:
            out += f" {dt.hour:02d}:{dt.minute:02d}"
        return out
    except Exception:
        return s[:16].replace("T", " ") if with_time else s[:10]


def fmt_invoice_no(deal_id: str) -> str:
    """Display form of a rental id: split the joined YYYYMM block so the date
    reads clearly, e.g. 'RENT-202606-025' -> 'RENT-2026-06-025'. The stored deal
    id is unchanged; this is display-only. Non-matching ids pass through as-is."""
    m = re.match(r"^(RENT-)(\d{4})(\d{2})(-.+)$", deal_id or "")
    return f"{m.group(1)}{m.group(2)}-{m.group(3)}{m.group(4)}" if m else (deal_id or "")


def _info_dot(help_text: str) -> str:
    if not help_text:
        return ""
    return f'<span class="info-dot" data-tip="{html.escape(help_text)}">i</span>'


def page_header(title_key: str, help_key: str = ""):
    import streamlit as st
    title = t(title_key)
    tip = t(help_key) if help_key else ""
    st.markdown(
        f'<div class="page-head"><span class="page-title">{html.escape(title)}</span>'
        f'{_info_dot(tip)}</div>',
        unsafe_allow_html=True,
    )


def section_header(title_key: str, help_key: str = ""):
    import streamlit as st
    title = t(title_key)
    tip = t(help_key) if help_key else ""
    st.markdown(
        f'<div class="section-title">{html.escape(title)}{_info_dot(tip)}</div>',
        unsafe_allow_html=True,
    )


def status_badge(status: str) -> str:
    """Return badge HTML for a vehicle/rental status (translated label)."""
    token = STATUS_TOKEN.get(status, "archived")
    label = t(status) if status in ("Available", "Rented", "In Garage", "Maintenance", "DELETED") else status
    return f'<span class="badge {token}">{html.escape(label)}</span>'


def kpi_tile(label_key: str, value, accent: bool = False, icon: str = ""):
    """A single headline metric: an uppercase label (with an optional leading
    icon chip aligned right) above a large, tabular-figure value."""
    import streamlit as st
    cls = "kpi accent" if accent else "kpi"
    chip = f'<span class="kpi-chip"><span class="msym">{html.escape(icon)}</span></span>' if icon else ""
    st.markdown(
        f'<div class="{cls}">'
        f'<div class="kpi-head"><span class="kpi-label">{html.escape(t(label_key))}</span>{chip}</div>'
        f'<div class="kpi-value">{value}</div></div>',
        unsafe_allow_html=True,
    )
