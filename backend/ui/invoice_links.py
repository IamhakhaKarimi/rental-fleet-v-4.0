"""
Invoice "Quick links" — the stacked QR buttons rendered in the invoice section.

Each enabled item becomes one button (a label + a scannable QR): pay-the-balance
(SEPA bank-transfer QR, **only** when a super-admin enabled it and set an IBAN),
WhatsApp click-to-chat, a contact vCard, a map/return-location link, and a plain
rental summary. The same list feeds both the HTML invoice (QR as a data-URI, the
row clickable when the payload is a URL) and the PDF invoice (QR as PNG bytes).

Pure module (no Streamlit) — payload building + QR rendering only; the caller
(`ui/invoice.py`, `ui/pdf.py`) handles layout. Items appear only when their data
exists, so an unconfigured business simply shows fewer buttons.
"""

import base64
import io
import urllib.parse

import segno

from config.settings import CURRENCY_SYMBOL
from data.repositories import app_settings as app_cfg


def _eur(cents) -> str:
    """Integer cents -> '€30' / '€30.50' (mirrors ui.components.format_eur, but this
    module stays Streamlit-free)."""
    cents = int(cents or 0)
    whole, rem = divmod(abs(cents), 100)
    sign = "-" if cents < 0 else ""
    body = f"{whole:,}" if rem == 0 else f"{whole:,}.{rem:02d}"
    return f"{sign}{CURRENCY_SYMBOL}{body}"


def qr_png_bytes(payload: str, scale: int = 4, border: int = 2) -> bytes:
    """Render `payload` to QR PNG bytes (for the PDF invoice)."""
    buf = io.BytesIO()
    segno.make(payload, error="m").save(buf, kind="png", scale=scale, border=border)
    return buf.getvalue()


def qr_data_uri(payload: str, scale: int = 4, border: int = 2) -> str:
    """Render `payload` to a base64 PNG data-URI (for the HTML invoice)."""
    return "data:image/png;base64," + base64.b64encode(
        qr_png_bytes(payload, scale, border)).decode("ascii")


def _digits(s: str) -> str:
    return "".join(ch for ch in (s or "") if ch.isdigit())


def _sepa_payload(name: str, iban: str, amount_cents: int, ref: str) -> str:
    """EPC069-12 ("GiroCode") SEPA credit-transfer payload — banking apps read it and
    pre-fill a transfer with the IBAN, EUR amount and remittance reference."""
    amt = max(int(amount_cents or 0), 0)
    euro = f"EUR{amt // 100}.{amt % 100:02d}"
    return "\n".join([
        "BCD", "002", "1", "SCT", "",
        (name or "")[:70], iban or "", euro, "", "", (ref or "")[:140], "",
    ])


def _vcard_payload(name: str, phone: str, email: str, address: str,
                   urls=None, note: str = "") -> str:
    """vCard 3.0 — phones turn TEL/EMAIL/ADR/URL into their own tappable buttons when
    the card is scanned, so one QR exposes call / message / email / map / web links."""
    lines = ["BEGIN:VCARD", "VERSION:3.0", f"FN:{name}", f"ORG:{name}"]
    if phone:
        lines.append(f"TEL;TYPE=CELL:{phone}")
    if email:
        lines.append(f"EMAIL:{email}")
    if address:
        lines.append(f"ADR;TYPE=WORK:;;{address};;;;")
    for u in (urls or []):
        lines.append(f"URL:{u}")
    if note:
        lines.append("NOTE:" + note.replace("\\", "\\\\").replace("\n", "\\n"))
    lines.append("END:VCARD")
    return "\n".join(lines)


def _wa_url(phone: str, text: str) -> str:
    return f"https://wa.me/{_digits(phone)}?text={urllib.parse.quote(text)}"


def _maps_url(maps_url: str, address: str) -> str:
    if maps_url:
        return maps_url
    return "https://www.google.com/maps/search/?api=1&query=" + urllib.parse.quote(address)


def _summary_payload(business_name, inv_no, deal, balance_cents) -> str:
    veh = f'{deal.get("vehicle_id", "")} {deal.get("make_model", "")} ' \
          f'{deal.get("license_plate", "") or ""}'.strip()
    period = f'{(deal.get("start_dt") or "")[:16].replace("T", " ")} -> ' \
             f'{(deal.get("end_dt") or "")[:16].replace("T", " ")}'
    parts = [business_name, f"Invoice {inv_no}", deal.get("client_name", ""),
             veh, period, f"Balance: {_eur(balance_cents)}"]
    return "\n".join(p for p in parts if p and p.strip())


def build_invoice_qrs(deal: dict, business_name: str, T, balance_cents: int,
                      inv_no: str) -> list[dict]:
    """Consolidated invoice QR codes — kept to ≤2 so the invoice stays tidy:

      • one **contact & links vCard QR** — saving it in a single scan exposes the
        business phone (call/message), email, address and map/WhatsApp links as the
        phone's own tappable buttons, with the rental summary in the note; shown when
        any contact field is configured.
      • a separate **SEPA pay-the-balance QR** — only when a super-admin enabled it,
        an IBAN is set and the balance is > 0 (a bank-transfer QR can't live inside a
        vCard, so it stays its own code).

    Returns a list of ``{key, label, caption, payload}`` (0–2 items)."""
    phone = app_cfg.get_business_phone()
    address = app_cfg.get_business_address()
    maps_url = app_cfg.get_business_maps_url()
    email = app_cfg.get_business_email()
    iban = app_cfg.get_business_iban()
    pay_on = app_cfg.get_pay_qr_enabled()

    qrs: list[dict] = []
    if phone or email or address or maps_url:
        urls = []
        if maps_url or address:
            urls.append(_maps_url(maps_url, address))
        if phone:
            urls.append(_wa_url(phone, f"{business_name}: {inv_no}"))
        vcard = _vcard_payload(
            business_name, phone, email, address, urls=urls,
            note=_summary_payload(business_name, inv_no, deal, balance_cents))
        qrs.append({"key": "contact", "label": T("qr_contact"),
                    "caption": T("qr_scan_hint"), "payload": vcard})

    if pay_on and iban and int(balance_cents or 0) > 0:
        qrs.append({"key": "pay", "label": T("qr_pay"), "caption": _eur(balance_cents),
                    "payload": _sepa_payload(business_name, iban, balance_cents, inv_no)})

    return qrs


def build_link_buttons(business_name: str, inv_no: str) -> list[tuple]:
    """Clickable link buttons for the on-screen invoice (digital readers click them
    directly instead of scanning the QR). Returns ``(label_key, href)`` tuples for
    the URL-openable actions that have data — WhatsApp and the map/return link."""
    phone = app_cfg.get_business_phone()
    address = app_cfg.get_business_address()
    maps_url = app_cfg.get_business_maps_url()
    btns = []
    if phone:
        btns.append(("qr_whatsapp", _wa_url(phone, f"{business_name}: {inv_no}")))
    if maps_url or address:
        btns.append(("qr_location", _maps_url(maps_url, address)))
    return btns
