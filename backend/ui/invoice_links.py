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

from data.repositories import app_settings as app_cfg
from ui.components import format_money_display as _eur


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
    # Only honour an admin-set map link when it is a real http(s) URL — otherwise a
    # 'javascript:'/'data:' value would survive html.escape and become a clickable
    # link on the invoice. Anything else falls back to a Google Maps address search.
    if maps_url and maps_url.strip().lower().startswith(("http://", "https://")):
        return maps_url.strip()
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
        # The vCard's embedded links, surfaced as tappable buttons beneath the QR so a
        # digital reader can act without scanning (each guides to one task).
        contact_actions: list[dict] = []
        if _tel_href(phone):
            contact_actions.append({"key": "call", "label": T("qa_call"),
                                    "value": (phone or "").strip(),
                                    "href": _tel_href(phone)})
        if _digits(phone):
            contact_actions.append({"key": "whatsapp", "label": T("qr_whatsapp"),
                                    "value": "WhatsApp",
                                    "href": _wa_url(phone, f"{business_name}: {inv_no}")})
        if maps_url or address:
            contact_actions.append({"key": "location", "label": T("qr_location"),
                                    "value": (address or T("qr_location")),
                                    "href": _maps_url(maps_url, address)})
        if email:
            contact_actions.append({"key": "email", "label": "Email", "value": email,
                                    "href": f"mailto:{email}"})
        qrs.append({"key": "contact", "label": T("qr_contact"),
                    "caption": T("qr_scan_hint"), "payload": vcard,
                    "actions": contact_actions})

    if pay_on and iban and int(balance_cents or 0) > 0:
        qrs.append({"key": "pay", "label": T("qr_pay"), "caption": _eur(balance_cents),
                    "payload": _sepa_payload(business_name, iban, balance_cents, inv_no),
                    # The account to transfer to, shown as a guiding info button.
                    "actions": [{"label": T("qa_iban"), "value": _group_iban(iban), "href": ""}]})

    # Fallback: when no contact vCard could be built (business contact details not yet
    # configured in Settings), emit a scannable invoice-summary QR built purely from the
    # deal itself — so every invoice always carries at least one QR out of the box. Kept
    # as the leftmost card and only added in the contact QR's absence, so the count still
    # never exceeds two (summary + pay, or contact + pay) and the single-A4 layout holds.
    if not any(q["key"] == "contact" for q in qrs):
        qrs.insert(0, {"key": "summary", "label": T("qr_summary"),
                       "caption": T("qr_scan_hint"),
                       "payload": _summary_payload(business_name, inv_no, deal, balance_cents),
                       "actions": []})

    return qrs


def _group_iban(iban: str) -> str:
    """Uppercase, strip all whitespace, then regroup into blocks of four so a long
    IBAN reads cleanly on the invoice (e.g. 'DE89 3704 0044 0532 0130 00')."""
    compact = "".join((iban or "").split()).upper()
    return " ".join(compact[i:i + 4] for i in range(0, len(compact), 4))


def _tel_href(phone: str) -> str:
    """'tel:+<digits>' — keeps a leading '+' when the entered number had one. Empty
    string when the phone has no digits (caller then skips the button)."""
    d = _digits(phone)
    if not d:
        return ""
    plus = "+" if (phone or "").lstrip().startswith("+") else ""
    return f"tel:{plus}{d}"


def build_quick_actions(deal: dict, business_name: str, T, grand_total_cents: int,
                        balance_cents: int, inv_no: str) -> list[dict]:
    """Up to SIX invoice "quick-action" pills, rendered as a row below the QR cards
    by both the HTML invoice (ui/invoice.py) and the PDF invoice (ui/pdf.py).

    A mix of clickable links and plain info values, in a fixed order:
      1. rental total   (info — always shown, so the row is never empty)
      2. bank / IBAN    (info — the account number to pay into; when an IBAN is set)
      3. return address (link — map to the return location; when address/map is set)
      4. balance due    (info — only when a balance is still owed)
      5. call us        (link — tel:; when a phone is set)
      6. WhatsApp us     (link — https wa.me; when a phone is set)

    Each item is ``{key, label, value, href}`` (``href`` is '' for info pills). Items
    appear only when their data exists, so an unconfigured business shows fewer.
    Reads settings once and returns a plain list (call it once per document and reuse
    across the customer/office copies)."""
    phone = app_cfg.get_business_phone()
    address = app_cfg.get_business_address()
    maps_url = app_cfg.get_business_maps_url()
    iban = (app_cfg.get_business_iban() or "").strip()

    acts: list[dict] = []
    # 1) Rental total — the full rental cost (before the deposit is deducted). Always
    #    present, so the block never renders empty.
    acts.append({"key": "qa_total", "label": T("qa_total"),
                 "value": _eur(grand_total_cents), "href": ""})
    # 2) Bank / IBAN — the account number to transfer to (not a link; the SEPA pay-QR
    #    card stays the scannable pay path).
    if iban:
        acts.append({"key": "qa_iban", "label": T("qa_iban"),
                     "value": _group_iban(iban), "href": ""})
    # 3) Return address — a clickable map link to where the car is handed back.
    if address or maps_url:
        loc = address or T("qr_location")
        if len(loc) > 60:
            loc = loc[:59] + "…"
        acts.append({"key": "qa_return", "label": T("qa_return"),
                     "value": loc, "href": _maps_url(maps_url, address)})
    # 4) Balance due — the remaining amount after the deposit; hidden when nothing is
    #    owed (avoids a confusing '€0' pill).
    if int(balance_cents or 0) > 0:
        acts.append({"key": "qa_balance", "label": T("qa_balance"),
                     "value": _eur(balance_cents), "href": ""})
    # 5+6) Call + WhatsApp — both driven by the business phone.
    if _digits(phone):
        acts.append({"key": "qa_call", "label": T("qa_call"),
                     "value": (phone or "").strip(), "href": _tel_href(phone)})
        acts.append({"key": "qa_whatsapp", "label": T("qr_whatsapp"),
                     "value": "WhatsApp", "href": _wa_url(phone, f"{business_name}: {inv_no}")})
    return acts
