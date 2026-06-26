"""
PDF rendering for the two invoices (rental + software license).

fpdf2 is pure-Python (no native deps — installs cleanly on Windows), so it is the
download format for both invoices. A Unicode TrueType font is registered when one
is found on disk (Arial on Windows, DejaVu on Linux) so Turkish/Albanian/German
glyphs and the € sign render correctly; if none is found we fall back to the
latin-1 core font. The on-screen *preview* stays HTML (see ui/invoice.py and
ui/license_invoice.py) — only the download button serves these PDF bytes.
"""

import base64
import io
import os
from datetime import datetime, timedelta

from fpdf import FPDF
from fpdf.enums import XPos, YPos

from config.i18n import t, t_lang
from config.settings import (APP_NAME, APP_TAGLINE, APP_VERSION, BASE_DIR,
                             CURRENCY_SYMBOL, LANGUAGES)
from config.terms import rental_terms
from services.scheduling_service import return_state
from ui.components import fmt_date, fmt_invoice_no
from ui import invoice_links

# First existing (regular, bold) pair wins. The DejaVu pair BUNDLED with the repo
# (assets/fonts) is tried first so the invoices render Turkish/Albanian/German
# glyphs + the € sign on ANY host — including Linux/Mac deploy targets (Streamlit
# Cloud, Render, HF Spaces…) that ship no Arial/DejaVu system font. Without a bundled
# font, fpdf2 falls back to its latin-1 core "Helvetica", which then raises
# FPDFUnicodeEncodingException on the first Turkish character (e.g. "ş"). System
# fonts follow as a secondary fallback. DejaVu is redistributable (Bitstream Vera /
# public-domain-style license), so shipping it in the repo is fine.
_BUNDLED_FONTS = BASE_DIR / "assets" / "fonts"
_FONT_CANDIDATES = [
    (str(_BUNDLED_FONTS / "DejaVuSans.ttf"), str(_BUNDLED_FONTS / "DejaVuSans-Bold.ttf")),
    (r"C:\Windows\Fonts\arial.ttf", r"C:\Windows\Fonts\arialbd.ttf"),
    ("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
     "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"),
    ("/Library/Fonts/Arial.ttf", "/Library/Fonts/Arial Bold.ttf"),
]

# Last-resort transliteration: if NO Unicode font can be loaded (bundled font
# deleted AND no system font), the core "Helvetica" face is latin-1-only and would
# crash on Turkish/Albanian glyphs. We then fold those characters to ASCII so the
# PDF still renders (degraded) instead of throwing. In practice the bundled font is
# always present, so this path is defensive only.
_LATIN1_FOLD = {
    "ş": "s", "Ş": "S", "ı": "i", "İ": "I", "ğ": "g", "Ğ": "G",
    "ç": "c", "Ç": "C", "ö": "o", "Ö": "O", "ü": "u", "Ü": "U",
    "ë": "e", "Ë": "E", "â": "a", "î": "i", "û": "u", "€": "EUR",
}


def _fold_latin1(s: str) -> str:
    out = "".join(_LATIN1_FOLD.get(ch, ch) for ch in s)
    return out.encode("latin-1", "ignore").decode("latin-1")


class _PDF(FPDF):
    """FPDF whose cell/multi_cell sanitize text when no Unicode font is active, so a
    missing font degrades gracefully instead of raising FPDFUnicodeEncodingException.
    ``_uni`` is set True by _new_pdf when a TrueType font was registered."""
    _uni = True

    def cell(self, *args, **kwargs):
        if not self._uni and isinstance(kwargs.get("text"), str):
            kwargs["text"] = _fold_latin1(kwargs["text"])
        return super().cell(*args, **kwargs)

    def multi_cell(self, *args, **kwargs):
        if not self._uni and isinstance(kwargs.get("text"), str):
            kwargs["text"] = _fold_latin1(kwargs["text"])
        return super().multi_cell(*args, **kwargs)

_ACCENT = (26, 28, 30)     # ink (#1A1C1E) — monochrome brand, matches ui/theme.py
_TEXT = (33, 28, 23)       # warm ink #211C17
_MUTED = (115, 107, 96)    # warm taupe #736B60
_LIGHT = (242, 239, 233)   # warm surface #F2EFE9

_LINE_LABEL = {
    "rental": "invoice_line_rental",
    "overdue_penalty": "late_fee",
    "damage": "damage_charge",
}


def _eur(cents) -> str:
    """Integer cents -> '€30' / '€30.50' (mirrors ui.components.format_eur)."""
    cents = int(cents or 0)
    whole, rem = divmod(abs(cents), 100)
    sign = "-" if cents < 0 else ""
    body = f"{whole:,}" if rem == 0 else f"{whole:,}.{rem:02d}"
    return f"{sign}{CURRENCY_SYMBOL}{body}"


def _new_pdf(orientation: str = "P"):
    """A fresh A4 page with a Unicode font registered (family name returned).
    `orientation` is 'P' (portrait, the invoice default) or 'L' (landscape, the
    occupancy-timeline Gantt)."""
    pdf = _PDF(orientation=orientation, format="A4", unit="mm")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.set_margins(15, 14, 15)
    pdf.add_page()
    family = "Helvetica"
    for regular, bold in _FONT_CANDIDATES:
        if os.path.exists(regular):
            try:
                pdf.add_font("Uni", "", regular)
                pdf.add_font("Uni", "B", bold if os.path.exists(bold) else regular)
                family = "Uni"
                break
            except Exception:
                continue          # unreadable font file → try the next candidate
    pdf._uni = (family == "Uni")  # core "Helvetica" is latin-1 only → fold text
    pdf.set_font(family, size=10)
    return pdf, family


def _logo_stream(logo: str):
    """Return a BytesIO of the base64 logo, or None if absent/undecodable."""
    if not logo:
        return None
    try:
        return io.BytesIO(base64.b64decode(logo))
    except Exception:
        return None


def _txt(value) -> str:
    return "" if value is None else str(value)


# ──────────────────────────────────────────────────────────────────────────────
# Rental invoice
# ──────────────────────────────────────────────────────────────────────────────
def build_invoice_pdf(deal: dict, charges: list[dict], business_name: str,
                      lang: str = "tr", logo: str = "", stamp: str = "") -> bytes:
    """Return the rental invoice as PDF bytes, in `lang` (validated). The document
    holds TWO copies on their own A4 pages — one for the customer, one for the
    office — each tagged with a copy label (so a single print/download yields both
    sheets to hand over and to file)."""
    if lang not in LANGUAGES:
        lang = "tr"
    T = lambda k: t_lang(k, lang)

    pdf, F = _new_pdf()
    L, R = 15, 195            # left / right page edges (usable width 180mm)
    right_x = 120

    billable = [c for c in charges if c["type"] != "deposit"]
    deposit = sum(c["amount"] for c in charges if c["type"] == "deposit") \
        or int(deal.get("deposit") or 0)
    grand_total = sum(c["amount"] for c in billable) or int(deal.get("total_amount") or 0)
    balance_due = grand_total - deposit
    days = int(deal.get("rental_days") or 0)
    daily_rate = int(deal.get("daily_rate") or 0)
    # Dates spelled out with the month name; the invoice number's YYYYMM split.
    inv_no = fmt_invoice_no(deal.get("deal_id", ""))
    inv_date = fmt_date(deal.get("created_at"), lang)
    start = fmt_date(deal.get("start_dt"), lang, with_time=True)
    end = fmt_date(deal.get("end_dt"), lang, with_time=True)
    signed = str(deal.get("contract_signed", "No")).lower() in ("yes", "1", "true")

    # Employee who registered the rental — name only (role intentionally omitted).
    issued_by = deal.get("created_by_name") or deal.get("created_by") or "—"
    seal = stamp or logo        # signature seal: stamp preferred, else the logo

    # Consolidated quick-links QR(s): one contact/links vCard QR (+ a pay QR when a
    # super-admin enabled it). Render the PNGs once and reuse across both copies.
    qrs = invoice_links.build_invoice_qrs(deal, business_name, T, balance_due, inv_no)
    qr_cache = {q["key"]: invoice_links.qr_png_bytes(q["payload"], scale=5) for q in qrs}

    def _draw(copy_label: str):
        # ── copy tag (Customer Copy / Office Copy), small, top-right ──────────
        pdf.set_xy(L, 8)
        pdf.set_font(F, "B", 7)
        pdf.set_text_color(*_MUTED)
        pdf.cell(R - L, 4, text=copy_label, align="R")

        # ── header: brand (left) + invoice meta (right) ──────────────────────
        top = 14
        y = top
        stream = _logo_stream(logo)
        if stream is not None:
            try:
                pdf.image(stream, x=L, y=y, w=38)
                y += 17
            except Exception:
                pass
        pdf.set_xy(L, y)
        pdf.set_font(F, "B", 15)
        pdf.set_text_color(*_TEXT)
        pdf.cell(95, 7, text=_txt(business_name), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_x(L)
        pdf.set_font(F, "", 8)
        pdf.set_text_color(*_MUTED)
        pdf.cell(95, 4, text=APP_TAGLINE.upper(), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        left_bottom = pdf.get_y()

        meta = [
            (T("invoice_no"), inv_no),
            (T("invoice_date"), inv_date),
            (T("invoice_issued_by"), issued_by),
        ]
        pdf.set_xy(right_x, top)
        pdf.set_font(F, "B", 22)
        pdf.set_text_color(*_ACCENT)
        pdf.cell(R - right_x, 11, text=T("invoice_heading"), align="R",
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_font(F, "", 9)
        pdf.set_text_color(*_MUTED)
        for label, val in meta:
            pdf.set_x(right_x)
            pdf.cell(R - right_x, 5, text=f"{label}: {val}", align="R",
                     new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        right_bottom = pdf.get_y()

        y = max(left_bottom, right_bottom) + 2
        pdf.set_draw_color(*_ACCENT)
        pdf.set_line_width(0.6)
        pdf.line(L, y, R, y)
        y += 5

        # ── bill-to / vehicle ────────────────────────────────────────────────
        pdf.set_xy(L, y)
        pdf.set_font(F, "B", 8)
        pdf.set_text_color(*_MUTED)
        pdf.cell(90, 5, text=T("bill_to").upper(), new_x=XPos.RIGHT, new_y=YPos.TOP)
        pdf.cell(85, 5, text=T("invoice_vehicle").upper(), new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        row_y = pdf.get_y()
        pdf.set_xy(L, row_y)
        pdf.set_font(F, "B", 10)
        pdf.set_text_color(*_TEXT)
        pdf.cell(90, 5, text=_txt(deal.get("client_name", "")), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_x(L)
        pdf.set_font(F, "", 9)
        pdf.set_text_color(*_MUTED)
        pdf.cell(90, 5, text=f'{T("col_phone")}: {deal.get("phone", "") or "—"}',
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_x(L)
        pdf.cell(90, 5, text=f'{T("col_idno")}: {deal.get("id_passport", "") or "—"}',
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        veh_line = f'{deal.get("vehicle_id", "")}  {deal.get("make_model", "")}'
        pdf.set_xy(right_x - 10, row_y)
        pdf.set_font(F, "B", 10)
        pdf.set_text_color(*_TEXT)
        pdf.cell(R - (right_x - 10), 5, text=veh_line, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_x(right_x - 10)
        pdf.set_font(F, "", 9)
        pdf.set_text_color(*_MUTED)
        pdf.cell(R - (right_x - 10), 5, text=_txt(deal.get("license_plate", "") or "—"),
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_x(right_x - 10)
        pdf.cell(R - (right_x - 10), 5, text=f'{T("invoice_period")}: {start} -> {end}',
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        y = pdf.get_y() + 4

        # ── line items ────────────────────────────────────────────────────────
        w_desc, w_qty, w_unit, w_amt = 90, 25, 32, 33
        pdf.set_xy(L, y)
        pdf.set_font(F, "B", 8)
        pdf.set_text_color(*_MUTED)
        pdf.set_fill_color(*_LIGHT)
        pdf.cell(w_desc, 7, text=T("invoice_desc").upper(), border=0, fill=True)
        pdf.cell(w_qty, 7, text=T("invoice_qty").upper(), align="R", border=0, fill=True)
        pdf.cell(w_unit, 7, text=T("invoice_unit").upper(), align="R", border=0, fill=True)
        pdf.cell(w_amt, 7, text=T("invoice_amount").upper(), align="R", border=0, fill=True,
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        pdf.set_font(F, "", 10)
        pdf.set_text_color(*_TEXT)

        def _item(label, qty, unit, amount):
            pdf.set_x(L)
            pdf.cell(w_desc, 7, text=label, border="B")
            pdf.cell(w_qty, 7, text=qty, align="R", border="B")
            pdf.cell(w_unit, 7, text=unit, align="R", border="B")
            pdf.cell(w_amt, 7, text=_eur(amount), align="R", border="B",
                     new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        pdf.set_draw_color(*_LIGHT)
        if billable:
            for c in billable:
                ctype = c["type"]
                label = T(_LINE_LABEL.get(ctype, ctype))
                if ctype == "rental":
                    _item(label, str(days), _eur(daily_rate), c["amount"])
                else:
                    _item(label, "1", _eur(c["amount"]), c["amount"])
        else:
            _item(T("invoice_line_rental"), str(days), _eur(daily_rate), grand_total)

        # ── totals (right aligned) ──────────────────────────────────────────────
        y2 = pdf.get_y() + 3
        tot_x = 120
        tot_lbl, tot_val = 45, 30
        pdf.set_xy(tot_x, y2)
        pdf.set_font(F, "", 10)
        pdf.set_text_color(*_TEXT)
        pdf.cell(tot_lbl, 6, text=T("invoice_subtotal"))
        pdf.cell(tot_val, 6, text=_eur(grand_total), align="R",
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        if deposit > 0:
            pdf.set_x(tot_x)
            pdf.set_text_color(*_MUTED)
            pdf.cell(tot_lbl, 6, text=f'- {T("invoice_line_deposit")}')
            pdf.cell(tot_val, 6, text=f'- {_eur(deposit)}', align="R",
                     new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_x(tot_x)
        pdf.set_draw_color(*_TEXT)
        pdf.set_line_width(0.4)
        yy = pdf.get_y()
        pdf.line(tot_x, yy, tot_x + tot_lbl + tot_val, yy)
        pdf.set_font(F, "B", 13)
        pdf.set_text_color(*_TEXT)
        pdf.cell(tot_lbl, 9, text=T("invoice_total"))
        pdf.set_text_color(*_ACCENT)
        pdf.cell(tot_val, 9, text=_eur(balance_due), align="R",
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        # signed / unsigned
        pdf.set_xy(L, max(pdf.get_y(), y2) + 2)
        pdf.set_font(F, "B", 9)
        pdf.set_text_color(*_ACCENT)
        pdf.cell(0, 6, text=T("invoice_signed") if signed else T("invoice_unsigned"),
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        # ── quick-links QR(s): one contact/links vCard QR (+ a pay QR if enabled) ──
        if qrs:
            pdf.ln(2)
            pdf.set_x(L)
            pdf.set_font(F, "B", 7)
            pdf.set_text_color(*_MUTED)
            pdf.cell(0, 4, text=T("invoice_quick_links").upper(),
                     new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            qy = pdf.get_y() + 1
            qsz, cellw = 22, 48
            for i, q in enumerate(qrs):
                cx = L + i * cellw
                try:
                    pdf.image(io.BytesIO(qr_cache[q["key"]]),
                              x=cx + (cellw - qsz) / 2, y=qy, w=qsz, h=qsz)
                except Exception:
                    pass
                pdf.set_xy(cx, qy + qsz + 0.5)
                pdf.set_font(F, "B", 6)
                pdf.set_text_color(*_TEXT)
                pdf.cell(cellw, 3, text=q["label"], align="C",
                         new_x=XPos.LMARGIN, new_y=YPos.NEXT)
                pdf.set_x(cx)
                pdf.set_font(F, "", 5.5)
                pdf.set_text_color(*_MUTED)
                pdf.cell(cellw, 3, text=q["caption"], align="C")
            pdf.set_y(qy + qsz + 9)

        # ── terms & conditions ──────────────────────────────────────────────────
        terms = rental_terms(lang)
        pdf.ln(2)
        pdf.set_x(L)
        pdf.set_font(F, "B", 9)
        pdf.set_text_color(*_TEXT)
        pdf.multi_cell(0, 5, text=_txt(terms.get("title", "")),
                       new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.set_font(F, "", 7.5)
        pdf.set_text_color(*_MUTED)
        for i, rule in enumerate(terms.get("rules", []), start=1):
            pdf.set_x(L)
            pdf.multi_cell(0, 3.8, text=f"{i}. {rule}", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        # ── signatures (customer + authorized; seal above the authorized line) ──
        pdf.ln(5)
        sy = pdf.get_y()
        gap = 18
        col_w = (R - L - gap) / 2
        cust_x, auth_x = L, L + col_w + gap
        line_y = sy + 15                     # headroom for the stamp/seal
        seal_stream = _logo_stream(seal)
        if seal_stream is not None:
            try:
                sw = 22
                pdf.image(seal_stream, x=auth_x + (col_w - sw) / 2, y=sy, w=sw)
            except Exception:
                pass
        pdf.set_draw_color(*_MUTED)
        pdf.set_line_width(0.3)
        pdf.line(cust_x, line_y, cust_x + col_w, line_y)
        pdf.line(auth_x, line_y, auth_x + col_w, line_y)
        pdf.set_font(F, "", 8)
        pdf.set_text_color(*_MUTED)
        pdf.set_xy(cust_x, line_y + 1)
        pdf.cell(col_w, 4, text=T("invoice_customer_signature"), align="C")
        pdf.set_xy(auth_x, line_y + 1)
        pdf.cell(col_w, 4, text=T("invoice_authorized_signature"), align="C",
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)

        # ── footer ──────────────────────────────────────────────────────────────
        pdf.ln(2)
        pdf.set_x(L)
        pdf.set_font(F, "", 8)
        pdf.set_text_color(*_MUTED)
        pdf.multi_cell(0, 4, text=f'{T("invoice_thanks")}  -  {T("invoice_footer")}',
                       new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    _draw(T("invoice_copy_customer"))
    pdf.add_page()
    _draw(T("invoice_copy_office"))
    return bytes(pdf.output())


# ──────────────────────────────────────────────────────────────────────────────
# Generic finance report (any tabular data → branded PDF)
# ──────────────────────────────────────────────────────────────────────────────
def _fit(pdf, value, width: float) -> str:
    """Trim a cell string with an ellipsis so it never overflows its column."""
    s = _txt(value)
    if pdf.get_string_width(s) <= width - 2:
        return s
    while s and pdf.get_string_width(s + "…") > width - 2:
        s = s[:-1]
    return (s + "…") if s else ""


def build_report_pdf(title: str, headers: list[str], rows: list[list],
                     business_name: str = "", logo: str = "",
                     meta: list = None, total_row: list = None) -> bytes:
    """Branded A4 report: business header + title + optional metadata block + a
    bordered table, optionally closed by a bold TOTAL row. All cell values must
    already be display strings (amounts pre-formatted to euros). `meta` is a list
    of (label, value) pairs rendered under the title; `total_row` is a pre-built
    list of cells (same column count) emphasised at the foot. Used by every
    Finance tab's PDF download button."""
    pdf, F = _new_pdf()
    L, R = 15, 195            # usable width 180mm

    top = 14
    y = top
    stream = _logo_stream(logo)
    if stream is not None:
        try:
            pdf.image(stream, x=L, y=y, w=34)
            y += 15
        except Exception:
            pass
    pdf.set_xy(L, y)
    pdf.set_font(F, "B", 14)
    pdf.set_text_color(*_TEXT)
    pdf.cell(0, 7, text=_txt(business_name) or APP_NAME, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(L)
    pdf.set_font(F, "B", 11)
    pdf.set_text_color(*_ACCENT)
    pdf.cell(0, 7, text=_txt(title), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(1)
    yy = pdf.get_y()
    pdf.set_draw_color(*_ACCENT)
    pdf.set_line_width(0.5)
    pdf.line(L, yy, R, yy)
    pdf.ln(3)

    # ── metadata block (business / generated / period …) ──────────────────────
    if meta:
        pdf.set_font(F, "", 8)
        for label, value in meta:
            pdf.set_x(L)
            pdf.set_text_color(*_MUTED)
            pdf.cell(34, 4.6, text=f"{_txt(label)}:")
            pdf.set_text_color(*_TEXT)
            pdf.cell(0, 4.6, text=_txt(value), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
        pdf.ln(2)

    ncol = max(1, len(headers))
    w = (R - L) / ncol

    def _header_row():
        pdf.set_x(L)
        pdf.set_font(F, "B", 8)
        pdf.set_text_color(*_MUTED)
        pdf.set_fill_color(*_LIGHT)
        for h in headers:
            pdf.cell(w, 7, text=_fit(pdf, h, w), border=0, fill=True)
        pdf.ln(7)

    _header_row()
    pdf.set_font(F, "", 9)
    pdf.set_text_color(*_TEXT)
    pdf.set_draw_color(*_LIGHT)
    for row in rows:
        if pdf.get_y() > 272:                    # near page foot → new page + header
            pdf.add_page()
            _header_row()
            pdf.set_font(F, "", 9)
            pdf.set_text_color(*_TEXT)
        pdf.set_x(L)
        for i in range(ncol):
            cell = row[i] if i < len(row) else ""
            pdf.cell(w, 6.5, text=_fit(pdf, cell, w), border="B")
        pdf.ln(6.5)

    # ── totals row (bold, shaded, top-ruled) ──────────────────────────────────
    if total_row:
        if pdf.get_y() > 272:
            pdf.add_page()
            _header_row()
        pdf.set_x(L)
        pdf.set_font(F, "B", 9)
        pdf.set_text_color(*_TEXT)
        pdf.set_fill_color(*_LIGHT)
        pdf.set_draw_color(*_ACCENT)
        for i in range(ncol):
            cell = total_row[i] if i < len(total_row) else ""
            pdf.cell(w, 7, text=_fit(pdf, cell, w), border="T", fill=True)
        pdf.ln(7)

    return bytes(pdf.output())


# ──────────────────────────────────────────────────────────────────────────────
# Software-license invoice
# ──────────────────────────────────────────────────────────────────────────────
def build_license_invoice_pdf(d: dict) -> bytes:
    """Return the software-license invoice as PDF bytes (UI-language labels)."""
    pdf, F = _new_pdf()
    L, R = 15, 195
    right_x = 120
    from data.repositories import app_settings as app_cfg
    logo = app_cfg.get_logo()
    seal = app_cfg.get_stamp() or logo   # signature seal: stamp preferred, else logo

    top = 14
    y = top
    stream = _logo_stream(logo)
    if stream is not None:
        try:
            pdf.image(stream, x=L, y=y, w=38)
            y += 17
        except Exception:
            pass
    pdf.set_xy(L, y)
    pdf.set_font(F, "B", 15)
    pdf.set_text_color(*_TEXT)
    pdf.cell(95, 7, text=APP_NAME, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(L)
    pdf.set_font(F, "", 8)
    pdf.set_text_color(*_MUTED)
    pdf.cell(95, 4, text=APP_TAGLINE.upper(), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    left_bottom = pdf.get_y()

    pdf.set_xy(right_x, top)
    pdf.set_font(F, "B", 20)
    pdf.set_text_color(*_ACCENT)
    pdf.cell(R - right_x, 11, text=t("license_invoice_title"), align="R",
             new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_font(F, "", 9)
    pdf.set_text_color(*_MUTED)
    for label, val in [(t("invoice_no"), _txt(d.get("invoice_no", ""))),
                       (t("invoice_date"), _txt(d.get("date", "")))]:
        pdf.set_x(right_x)
        pdf.cell(R - right_x, 5, text=f"{label}: {val}", align="R",
                 new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    right_bottom = pdf.get_y()

    y = max(left_bottom, right_bottom) + 2
    pdf.set_draw_color(*_ACCENT)
    pdf.set_line_width(0.6)
    pdf.line(L, y, R, y)
    y += 5

    pdf.set_xy(L, y)
    pdf.set_font(F, "B", 8)
    pdf.set_text_color(*_MUTED)
    pdf.cell(0, 5, text=t("license_licensee").upper(), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.set_x(L)
    pdf.set_font(F, "B", 11)
    pdf.set_text_color(*_TEXT)
    pdf.cell(0, 6, text=_txt(d.get("licensee", "")), new_x=XPos.LMARGIN, new_y=YPos.NEXT)
    pdf.ln(2)

    period = f'{d.get("start_year")} - {d.get("end_year")}'
    rows = [
        (t("license_product"), f"{APP_NAME} · {APP_TAGLINE} v{APP_VERSION}"),
        (t("license_period"), period),
        (t("license_years"), str(d.get("years") or 1)),
        (t("license_purchase_date"), _txt(d.get("date", ""))),
    ]
    pdf.set_font(F, "", 10)
    for k, v in rows:
        pdf.set_x(L)
        pdf.set_text_color(*_MUTED)
        pdf.cell(70, 7, text=k, border="B")
        pdf.set_text_color(*_TEXT)
        pdf.cell(110, 7, text=_txt(v), border="B", new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.ln(4)
    pdf.set_x(L)
    pdf.set_draw_color(*_TEXT)
    pdf.set_line_width(0.4)
    yy = pdf.get_y()
    pdf.line(L, yy, R, yy)
    pdf.set_font(F, "B", 14)
    pdf.set_text_color(*_TEXT)
    pdf.cell(120, 10, text=t("invoice_total"))
    pdf.set_text_color(*_ACCENT)
    pdf.cell(60, 10, text=_eur(int(d.get("amount_cents") or 0)), align="R",
             new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    # ── signatures (licensee + authorized; seal above the authorized line) ──
    pdf.ln(8)
    sy = pdf.get_y()
    gap = 18
    col_w = (R - L - gap) / 2
    cust_x, auth_x = L, L + col_w + gap
    line_y = sy + 15
    seal_stream = _logo_stream(seal)
    if seal_stream is not None:
        try:
            sw = 22
            pdf.image(seal_stream, x=auth_x + (col_w - sw) / 2, y=sy, w=sw)
        except Exception:
            pass
    pdf.set_draw_color(*_MUTED)
    pdf.set_line_width(0.3)
    pdf.line(cust_x, line_y, cust_x + col_w, line_y)
    pdf.line(auth_x, line_y, auth_x + col_w, line_y)
    pdf.set_font(F, "", 8)
    pdf.set_text_color(*_MUTED)
    pdf.set_xy(cust_x, line_y + 1)
    pdf.cell(col_w, 4, text=t("invoice_customer_signature"), align="C")
    pdf.set_xy(auth_x, line_y + 1)
    pdf.cell(col_w, 4, text=t("invoice_authorized_signature"), align="C",
             new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    pdf.ln(3)
    pdf.set_x(L)
    pdf.set_font(F, "", 8)
    pdf.set_text_color(*_MUTED)
    pdf.multi_cell(0, 4, text=f'{t("invoice_thanks")}  -  {t("invoice_footer")}',
                   new_x=XPos.LMARGIN, new_y=YPos.NEXT)

    return bytes(pdf.output())


# ──────────────────────────────────────────────────────────────────────────────
# Fleet occupancy timeline (Gantt)
# ──────────────────────────────────────────────────────────────────────────────
# Bar fill per return-state — mirrors the on-screen colour ramp in ui/timeline.py
# (calm grey while safe → amber within 24h → red once overdue).
# legend entries: (translation key, state) — reuses existing status/alert labels.
# The legend swatch now mirrors the bar (status tint + ink border), not a solid fill.
_TL_LEGEND = (("Rented", "ok"), ("due_soon_badge", "due_soon"),
              ("overdue_badge", "overdue"))

# Day/month separator colours mirror the on-screen timeline (ui/timeline.py): the
# minor day gridlines and the darker week/month separators + day-number labels use
# the same greys as the on-screen calendar grid.
_GRID = (216, 213, 206)        # minor day gridlines   (on-screen #D8D5CE)
_GRID_MAJOR = (169, 163, 153)  # week/month separators (on-screen #A9A399)
_AXIS_TXT = (75, 85, 99)       # minor day-number label (on-screen #4B5563)
_ROW  = (150, 143, 132)        # vehicle row separators

# Bars mirror the on-screen card aesthetic: a light status tint + a full near-black
# (ink) border (no side-stripe), with ink (dark-on-light) text.
_TL_TINT = {"ok": (255, 255, 255), "due_soon": (255, 247, 237), "overdue": (254, 242, 242)}
_CARD_BORDER = (26, 28, 30)    # ink — matches the on-screen card's near-black border
_ALERT_TEXT = (127, 29, 29)   # dark red, for overdue bar text


def _parse_dt(value):
    try:
        return datetime.fromisoformat(str(value))
    except Exception:
        return None


def build_timeline_pdf(vehicles: list[dict], rentals: list[dict],
                       business_name: str = "", lang: str = "tr",
                       logo: str = "", now: datetime | None = None,
                       windows: list | None = None) -> bytes:
    """Landscape-A4 Gantt of fleet occupancy: one row per vehicle, each Active
    rental drawn as a bar on a shared day axis, coloured by return-state
    (grey/amber/red) exactly like the on-screen timeline (ui/timeline.py).

    If `windows` is given — a list of (start, end, label) tuples — each window is
    rendered as its own section starting on a fresh page, showing only the
    rentals overlapping it and forcing the axis to that span (used by the
    Reservations export modal: this week / this month / a two-month range / every
    month on its own page). With windows=None the axis auto-fits every rental +
    'now' (the default full-timeline export). Paginates when the fleet is taller
    than one page."""
    if lang not in LANGUAGES:
        lang = "tr"
    T = lambda k: t_lang(k, lang)
    if now is None:
        now = datetime.now()

    pdf, F = _new_pdf(orientation="L")
    L, R = 12, 285                       # usable width 273mm (A4 landscape)
    bottom = 198                         # page foot (210 - 12)
    label_w = 58                         # left vehicle-label column
    chart_x = L + label_w
    chart_w = R - chart_x
    row_h = 7.0

    def _overlaps(r, a, b) -> bool:
        s, e = _parse_dt(r.get("start_dt")), _parse_dt(r.get("end_dt"))
        return bool(s and e and max(s, a) < min(e, b))

    def _render_window(forced_start, forced_end, label, is_first):
        """Render one time-window section (its own page; paginated by fleet)."""
        if not is_first:
            pdf.add_page()

        # Which rentals + the time span this section covers.
        if forced_start and forced_end:
            wr = [r for r in rentals if _overlaps(r, forced_start, forced_end)]
            t_min_raw, t_max_raw = forced_start, forced_end
        else:
            wr = rentals
            spans = [(s, e) for r in wr
                     if (s := _parse_dt(r.get("start_dt"))) and (e := _parse_dt(r.get("end_dt")))]
            if spans:
                t_min_raw = min(min(s for s, _ in spans), now)
                t_max_raw = max(max(e for _, e in spans), now)
            else:
                t_min_raw, t_max_raw = now - timedelta(days=3), now + timedelta(days=21)
        # snap to midnight and add half a day of breathing space on each edge
        t_min = datetime(t_min_raw.year, t_min_raw.month, t_min_raw.day) - timedelta(hours=12)
        t_max = datetime(t_max_raw.year, t_max_raw.month, t_max_raw.day) + timedelta(days=1, hours=12)
        total_secs = (t_max - t_min).total_seconds() or 1.0

        def x_of(dt):
            frac = (dt - t_min).total_seconds() / total_secs
            return chart_x + min(max(frac, 0.0), 1.0) * chart_w

        # gridline cadence: pick the smallest day step giving <= 12 ticks
        span_days = max((t_max - t_min).days, 1)
        step = next(d for d in (1, 2, 3, 7, 14, 30, 60, 90, 180, 365)
                    if span_days / d <= 12)

        by_vehicle = {}
        for r in wr:
            by_vehicle.setdefault(r.get("vehicle_id"), []).append(r)

        def _veh_label(v):
            lab = _txt(v.get("make_model"))
            plate = (v.get("license_plate") or "").strip()
            if plate:
                lab += f" · {plate}"
            return f'{v.get("vehicle_id")} · {lab}'

        # ── header geometry (constant across this section's pages) ────────────
        top = 12
        logo_h = 13 if _logo_stream(logo) is not None else 0
        left_bottom = top + logo_h + 12                # business name (6) + title (6)
        header_bottom = max(left_bottom, top + 14)
        day_w = chart_w / max(span_days, 1)
        show_nums = day_w >= 3.6                        # room for a 2-digit day number
        if show_nums:
            ddmm_y, daynum_y, axis_y = header_bottom + 1, header_bottom + 5, header_bottom + 9
        else:
            ddmm_y, daynum_y, axis_y = header_bottom + 2, None, header_bottom + 7
        rows_top = axis_y + 1
        rows_per_page = max(1, int((bottom - rows_top) / row_h))

        first = datetime(t_min.year, t_min.month, t_min.day)
        if first < t_min:
            first += timedelta(days=1)

        title_txt = T("timeline_title") + (f" — {label}" if label else "")

        def _frame(grid_bottom):
            y = top
            stream = _logo_stream(logo)
            if stream is not None:
                try:
                    pdf.image(stream, x=L, y=y, w=30)
                    y += 13
                except Exception:
                    pass
            pdf.set_xy(L, y)
            pdf.set_font(F, "B", 13)
            pdf.set_text_color(*_TEXT)
            pdf.cell(0, 6, text=_txt(business_name) or APP_NAME,
                     new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            pdf.set_x(L)
            pdf.set_font(F, "B", 11)
            pdf.set_text_color(*_ACCENT)
            pdf.cell(0, 6, text=title_txt, new_x=XPos.LMARGIN, new_y=YPos.NEXT)

            # generated timestamp (top-right)
            pdf.set_xy(L, top)
            pdf.set_font(F, "", 9)
            pdf.set_text_color(*_MUTED)
            pdf.cell(R - L, 5, text=now.strftime("%d.%m.%Y %H:%M"), align="R",
                     new_x=XPos.LMARGIN, new_y=YPos.NEXT)

            # legend (top-right, second line), right-aligned to R
            parts = [(T(k), s) for k, s in _TL_LEGEND]
            sq, gap = 3.2, 7.0
            pdf.set_font(F, "", 8)
            total = sum(sq + 1.5 + pdf.get_string_width(lbl) + gap for lbl, _ in parts) - gap
            x = R - total
            ly = top + 7
            for lbl, stt in parts:
                pdf.set_fill_color(*_TL_TINT.get(stt, (255, 255, 255)))
                pdf.set_draw_color(*_CARD_BORDER)
                pdf.set_line_width(0.2)
                pdf.rect(x, ly, sq, sq, style="DF")
                pdf.set_text_color(*_MUTED)
                pdf.set_xy(x + sq + 1.5, ly - 1.2)
                tw = pdf.get_string_width(lbl)
                pdf.cell(tw + 1, 5, text=lbl)
                x += sq + 1.5 + tw + gap

            pdf.set_draw_color(*_ACCENT)
            pdf.set_line_width(0.4)
            pdf.line(L, axis_y, R, axis_y)

            d = first
            while d <= t_max:
                gx = x_of(d)
                is_major = ((d - first).days % step == 0)
                pdf.set_draw_color(*(_GRID_MAJOR if is_major else _GRID))
                pdf.set_line_width(0.3 if is_major else 0.15)
                pdf.line(gx, rows_top, gx, grid_bottom)
                if daynum_y is not None:
                    cx = x_of(d + timedelta(hours=12))
                    pdf.set_font(F, "B" if is_major else "", 6 if is_major else 5.5)
                    pdf.set_text_color(*(_TEXT if is_major else _AXIS_TXT))
                    pdf.set_xy(cx - 6, daynum_y)
                    pdf.cell(12, 3.5, text=d.strftime("%d"), align="C")
                if is_major:
                    pdf.set_font(F, "B", 7)
                    pdf.set_text_color(*_MUTED)
                    pdf.set_xy(gx - 10, ddmm_y)
                    pdf.cell(20, 4, text=d.strftime("%d.%m"), align="C")
                d += timedelta(days=1)

            pdf.set_xy(L, ddmm_y)
            pdf.set_font(F, "B", 8)
            pdf.set_text_color(*_MUTED)
            pdf.cell(label_w, 4, text=T("col_id"))

            if t_min <= now <= t_max:
                nx = x_of(now)
                pdf.set_draw_color(*_ACCENT)
                pdf.set_line_width(0.6)
                pdf.line(nx, rows_top, nx, grid_bottom)
                pdf.set_font(F, "B", 6.5)
                lbl = T("now_label")
                w = pdf.get_string_width(lbl) + 3
                pdf.set_fill_color(*_ACCENT)
                pdf.rect(nx - w / 2, rows_top, w, 4, style="F")
                pdf.set_text_color(255, 255, 255)
                pdf.set_xy(nx - w / 2, rows_top)
                pdf.cell(w, 4, text=lbl, align="C")
            return rows_top + 1

        if not vehicles:
            _frame(rows_top + row_h)
            pdf.set_xy(L, rows_top + 5)
            pdf.set_font(F, "", 10)
            pdf.set_text_color(*_MUTED)
            pdf.cell(0, 6, text=T("timeline_empty"))
            return

        pages = [vehicles[i:i + rows_per_page] for i in range(0, len(vehicles), rows_per_page)]
        for pi, chunk in enumerate(pages):
            if pi > 0:
                pdf.add_page()
            row_y = _frame(rows_top + len(chunk) * row_h)
            for v in chunk:
                pdf.set_draw_color(*_ROW)
                pdf.set_line_width(0.2)
                pdf.line(L, row_y + row_h, R, row_y + row_h)
                pdf.set_font(F, "", 8)
                pdf.set_text_color(*_TEXT)
                pdf.set_xy(L, row_y + 1.5)
                pdf.cell(label_w - 2, row_h - 3, text=_fit(pdf, _veh_label(v), label_w - 2))
                for r in by_vehicle.get(v.get("vehicle_id"), []):
                    s, e = _parse_dt(r.get("start_dt")), _parse_dt(r.get("end_dt"))
                    if not (s and e):
                        continue
                    state, _ = return_state(r.get("end_dt"), now)
                    x1, x2 = x_of(s), x_of(e)
                    bw = max(x2 - x1, 1.5)
                    # card mirrors the on-screen bar: status tint + a full near-black
                    # (ink) border, no side-stripe (status reads from tint + text).
                    pdf.set_fill_color(*_TL_TINT.get(state, (255, 255, 255)))
                    pdf.set_draw_color(*_CARD_BORDER)
                    pdf.set_line_width(0.3)
                    pdf.rect(x1, row_y + 1.3, bw, row_h - 2.6, style="DF")
                    nm = _txt(r.get("client_name"))
                    if bw > 13 and nm:
                        pdf.set_font(F, "B", 7)
                        pdf.set_text_color(*(_ALERT_TEXT if state == "overdue" else _TEXT))
                        pdf.set_xy(x1 + 2.6, row_y + 1.8)
                        pdf.cell(bw - 3.8, row_h - 3.6, text=_fit(pdf, nm, bw - 3.8))
                row_y += row_h

    sections = windows if windows else [(None, None, None)]
    for i, (ws, we, label) in enumerate(sections):
        _render_window(ws, we, label, is_first=(i == 0))

    return bytes(pdf.output())
