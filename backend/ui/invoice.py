"""
Print-ready rental invoice.

The invoice language is chosen at registration (stored on rentals.invoice_lang)
and is independent of the UI language — all labels and the rental terms are
rendered through t_lang(key, lang). The layout is intentionally compact so the
whole document (including the terms & conditions) prints comfortably **within a
single A4 page** rather than spilling onto a second sheet.

The HTML is used for the inline preview and browser print (window.print()); the
download button serves a PDF rendered by ui/pdf.build_invoice_pdf (same content,
deposit deducted), so the saved file is a portable PDF rather than raw HTML.
"""

import html as _html

from config.i18n import t, t_lang
from config.settings import APP_TAGLINE, LANGUAGES
from config.terms import rental_terms
from ui.components import format_money_display, fmt_date, fmt_invoice_no
from ui.pdf import build_invoice_pdf
from ui import invoice_links
from data.repositories import rentals as rentals_repo
from data.repositories import app_settings as app_cfg

_LINE_LABEL = {
    "rental": "invoice_line_rental",
    "overdue_penalty": "late_fee",
    "damage": "damage_charge",
}

# Sentinels wrapping the invoice sheets in the HTML so a batch print can reuse this
# exact template (shared <style>/<head> + print toolbar) and splice several invoices
# into one document without duplicating the CSS.
_SHEETS_START = "<!--BCR_SHEETS_START-->"
_SHEETS_END = "<!--BCR_SHEETS_END-->"


def _esc(value) -> str:
    return _html.escape(str(value if value is not None else ""))


def build_invoice_html(deal: dict, charges: list[dict], business_name: str,
                       lang: str = "tr", logo: str = "", stamp: str = "",
                       copy_kinds: tuple = ("customer", "office")) -> str:
    """Return a complete, standalone, compact HTML invoice in `lang`.

    `copy_kinds` selects which duplicate sheets to render (default: customer +
    office, each on its own A4 page). A batch print passes ("office",) for a single
    office copy per rental."""
    if lang not in LANGUAGES:
        lang = "tr"
    T = lambda k: t_lang(k, lang)

    logo_img = ""
    if logo:
        logo_img = (
            f'<img src="data:image/png;base64,{logo}" '
            f'style="max-height:46px;max-width:170px;margin-bottom:5px;display:block"/>'
        )

    billable = [c for c in charges if c["type"] != "deposit"]
    deposit = sum(c["amount"] for c in charges if c["type"] == "deposit") \
        or int(deal.get("deposit") or 0)
    grand_total = sum(c["amount"] for c in billable) or int(deal.get("total_amount") or 0)

    days = int(deal.get("rental_days") or 0)
    daily_rate = int(deal.get("daily_rate") or 0)

    line_rows = []
    for c in billable:
        ctype = c["type"]
        label = T(_LINE_LABEL.get(ctype, ctype))
        if ctype == "rental":
            qty, unit = str(days), format_money_display(daily_rate)
        else:
            qty, unit = "1", format_money_display(c["amount"])
        line_rows.append(
            f"<tr><td>{_esc(label)}</td><td class='num'>{_esc(qty)}</td>"
            f"<td class='num'>{_esc(unit)}</td>"
            f"<td class='num'>{format_money_display(c['amount'])}</td></tr>"
        )
    if not line_rows:
        line_rows.append(
            f"<tr><td>{_esc(T('invoice_line_rental'))}</td><td class='num'>{days}</td>"
            f"<td class='num'>{format_money_display(daily_rate)}</td>"
            f"<td class='num'>{format_money_display(grand_total)}</td></tr>"
        )

    start = fmt_date(deal.get("start_dt"), lang, with_time=True)
    end = fmt_date(deal.get("end_dt"), lang, with_time=True)
    inv_date = fmt_date(deal.get("created_at"), lang)
    inv_no = fmt_invoice_no(deal.get("deal_id", ""))
    signed = str(deal.get("contract_signed", "No")).lower() in ("yes", "1", "true")
    signed_txt = T("invoice_signed") if signed else T("invoice_unsigned")

    # Employee who registered the rental — name only (role intentionally omitted).
    issued_by = _esc(deal.get("created_by_name") or deal.get("created_by") or "—")

    # The deposit already taken is DEDUCTED from the subtotal, so the grand total
    # shows the exact remaining balance due (no ambiguity for the customer).
    balance_due = grand_total - deposit
    deposit_row = ""
    if deposit > 0:
        deposit_row = (
            f"<tr><td>− {_esc(T('invoice_line_deposit'))}</td>"
            f"<td class='num'>− {format_money_display(deposit)}</td></tr>"
        )

    terms = rental_terms(lang)
    terms_items = "".join(f"<li>{_esc(r)}</li>" for r in terms["rules"])

    # Signature area: customer line + authorized line. The company stamp/seal sits
    # above the authorized line when available (stamp preferred, else the logo).
    seal = stamp or logo
    seal_img = (f'<img class="seal" src="data:image/png;base64,{seal}" alt=""/>'
                if seal else "")
    signature_block = (
        '<div class="sign">'
        '<div class="sign-box"><div class="seal-slot"></div>'
        '<div class="sign-line"></div>'
        f'<div class="sign-cap">{_esc(T("invoice_customer_signature"))}</div></div>'
        f'<div class="sign-box"><div class="seal-slot">{seal_img}</div>'
        '<div class="sign-line"></div>'
        f'<div class="sign-cap">{_esc(T("invoice_authorized_signature"))}</div></div>'
        '</div>'
    )

    # Quick-links: ONE consolidated contact/links vCard QR (+ a separate pay QR when a
    # super-admin enabled it). Scanning the vCard exposes call/message/email/map links
    # as the phone's own buttons. On-screen we also show clickable WhatsApp/map links.
    # Each QR carries its encoded actions (call / WhatsApp / map / pay-into IBAN) as
    # a stack of tappable, labelled buttons directly beneath it — so a digital reader
    # can act on the invoice without scanning, guided by the button text.
    qrs = invoice_links.build_invoice_qrs(deal, business_name, T, balance_due, inv_no)
    links_html = ""
    if qrs:
        def _qr_btn(a: dict) -> str:
            inner = (f'<span class="qlb-label">{_esc(a["label"])}</span>'
                     f'<span class="qlb-val">{_esc(a["value"])}</span>')
            if a.get("href"):
                return (f'<a class="ql-btn ql-btn-link" href="{_esc(a["href"])}" '
                        f'target="_blank" rel="noopener">{inner}</a>')
            return f'<span class="ql-btn ql-btn-info">{inner}</span>'

        def _card(q: dict) -> str:
            acts = list(q.get("actions") or [])
            # Call + WhatsApp share a single row (both driven by the same phone);
            # the remaining actions each stay on their own full-width row.
            call = next((a for a in acts if a.get("key") == "call"), None)
            wa = next((a for a in acts if a.get("key") == "whatsapp"), None)
            parts: list[str] = []
            if call and wa:
                parts.append(f'<div class="ql-btn-row">{_qr_btn(call)}{_qr_btn(wa)}</div>')
            for a in acts:
                if a is call or a is wa:
                    continue
                parts.append(_qr_btn(a))
            btns = "".join(parts)
            btns_block = f'<div class="ql-btns">{btns}</div>' if btns else ""
            return (f'<div class="ql-card">'
                    f'<img class="ql-qr" src="{invoice_links.qr_data_uri(q["payload"], scale=5)}" alt=""/>'
                    f'<div class="ql-label">{_esc(q["label"])}</div>'
                    f'<div class="ql-sub">{_esc(q["caption"])}</div>{btns_block}</div>')

        cards = "".join(_card(q) for q in qrs)
        links_html = (
            f'<div class="quicklinks"><div class="ql-head">'
            f'{_esc(T("invoice_quick_links"))}</div>'
            f'<div class="ql-cards">{cards}</div></div>'
        )

    # The document carries TWO identical copies on their own A4 pages — one for the
    # customer, one for the office — each tagged with a small copy label.
    sheet_inner = f"""
    <div class="top">
      <div class="brand">{logo_img}{_esc(business_name)}<small>{_esc(APP_TAGLINE)}</small></div>
      <div class="inv-title">
        <h1>{_esc(T('invoice_heading'))}</h1>
        <div class="meta">
          <div>{_esc(T('invoice_no'))}: <b>{_esc(inv_no)}</b></div>
          <div>{_esc(T('invoice_date'))}: <b>{_esc(inv_date)}</b></div>
          <div>{_esc(T('invoice_issued_by'))}: <b>{issued_by}</b></div>
        </div>
      </div>
    </div>

    <div class="cols">
      <div class="box">
        <div class="lbl">{_esc(T('bill_to'))}</div>
        <div class="val"><b>{_esc(deal.get('client_name',''))}</b><br>
          {_esc(deal.get('phone','') or '—')} &nbsp; {_esc(deal.get('id_passport','') or '—')}</div>
      </div>
      <div class="box">
        <div class="lbl">{_esc(T('invoice_vehicle'))}</div>
        <div class="val"><b>{_esc(deal.get('vehicle_id',''))}</b> {_esc(deal.get('make_model',''))} ·
          {_esc(deal.get('license_plate','') or '—')}<br>
          <span class="lbl" style="display:inline">{_esc(T('invoice_period'))}:</span>
          {_esc(start)} &rarr; {_esc(end)}</div>
      </div>
    </div>

    <table>
      <thead><tr>
        <th>{_esc(T('invoice_desc'))}</th>
        <th class="num">{_esc(T('invoice_qty'))}</th>
        <th class="num">{_esc(T('invoice_unit'))}</th>
        <th class="num">{_esc(T('invoice_amount'))}</th>
      </tr></thead>
      <tbody>{''.join(line_rows)}</tbody>
    </table>

    <div class="totals"><table>
      <tr><td>{_esc(T('invoice_subtotal'))}</td><td class="num">{format_money_display(grand_total)}</td></tr>
      {deposit_row}
      <tr class="grand"><td>{_esc(T('invoice_total'))}</td>
          <td class="num">{format_money_display(balance_due)}</td></tr>
    </table></div>

    <span class="chip">{_esc(signed_txt)}</span>

    {links_html}

    <div class="terms">
      <h3>{_esc(terms['title'])}</h3>
      <ol>{terms_items}</ol>
    </div>

    {signature_block}

    <div class="foot">{_esc(T('invoice_thanks'))} · {_esc(T('invoice_footer'))}</div>"""

    def _sheet(label: str) -> str:
        return f'<div class="sheet"><div class="copy-label">{label}</div>{sheet_inner}</div>'

    _copy_labels = {"customer": T('invoice_copy_customer'), "office": T('invoice_copy_office')}
    copies = "".join(_sheet(_esc(_copy_labels[c])) for c in copy_kinds if c in _copy_labels)

    return f"""<!DOCTYPE html><html lang="{lang}"><head><meta charset="utf-8"/>
<title>{_esc(T('invoice_heading'))} {_esc(inv_no)}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
  * {{ box-sizing: border-box; }}
  body {{ font-family:'Plus Jakarta Sans',system-ui,sans-serif; color:#211C17; margin:0;
         background:#F2EFE9; padding:16px; }}
  /* Compact sheet — narrower than A4 so it always fits one page */
  .sheet {{ max-width:640px; margin:0 auto; background:#fff; border:1px solid #E7E0D5;
            border-radius:10px; padding:20px 24px; font-size:12px; }}
  .top {{ display:flex; justify-content:space-between; align-items:flex-start;
          border-bottom:2px solid #1A1C1E; padding-bottom:10px; margin-bottom:14px; }}
  .brand {{ font-family:'Plus Jakarta Sans',system-ui,sans-serif; font-weight:700; font-size:17px;
            color:#211C17; line-height:1.1; }}
  .brand small {{ display:block; font-family:'Plus Jakarta Sans'; font-weight:500; font-size:9px;
                  letter-spacing:.12em; text-transform:uppercase; color:#736B60; margin-top:3px; }}
  .inv-title {{ text-align:right; }}
  .inv-title h1 {{ font-family:'Plus Jakarta Sans',system-ui,sans-serif; font-size:20px; margin:0;
                   color:#1A1C1E; letter-spacing:.03em; }}
  .meta {{ font-size:11px; color:#475569; margin-top:4px; line-height:1.5; }}
  .meta b {{ color:#211C17; }}
  .cols {{ display:flex; flex-direction:column; gap:8px; margin-bottom:12px; }}
  .cols .box {{ flex:1; }}
  .lbl {{ font-size:9px; font-weight:600; letter-spacing:.07em; text-transform:uppercase;
          color:#736B60; margin-bottom:3px; }}
  .val {{ font-size:12px; line-height:1.5; }}
  table {{ width:100%; border-collapse:collapse; margin-top:4px; }}
  th {{ text-align:left; font-size:9px; letter-spacing:.05em; text-transform:uppercase;
        color:#736B60; border-bottom:1px solid #E7E0D5; padding:5px 5px; }}
  td {{ font-size:12px; padding:6px 5px; border-bottom:1px solid #F2EFE9; }}
  td.num, th.num {{ text-align:right; }}
  tr.soft td {{ color:#475569; }}
  .totals {{ margin-top:8px; display:flex; justify-content:flex-end; }}
  .totals table {{ width:auto; min-width:220px; }}
  .totals td {{ border:none; padding:3px 5px; }}
  .grand td {{ font-family:'Plus Jakarta Sans',system-ui,sans-serif; font-weight:700; font-size:15px;
               color:#211C17; border-top:2px solid #211C17; padding-top:7px; }}
  .grand td.num {{ color:#1A1C1E; }}
  .chip {{ display:inline-block; font-size:9px; font-weight:600; padding:2px 8px;
           border-radius:999px; background:#EDEDEA; color:#1A1C1E; margin-top:10px; }}
  /* Quick-links — ONE consolidated contact/links QR (+ a pay QR when enabled),
     centred, with clickable WhatsApp/map buttons below for digital readers. */
  .quicklinks {{ margin-top:14px; padding-top:10px; border-top:1px dashed #CBD5E1; }}
  .ql-head {{ font-size:9px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
              color:#736B60; margin-bottom:8px; }}
  .ql-cards {{ display:flex; gap:18px; justify-content:center; flex-wrap:wrap; }}
  .ql-card {{ display:flex; flex-direction:column; align-items:center; gap:3px;
              border:1px solid #211C17; border-radius:10px; padding:8px 12px;
              min-width:172px; }}
  .ql-qr {{ width:92px; height:92px; image-rendering:pixelated; }}
  .ql-label {{ font-size:11px; font-weight:700; }}
  .ql-sub {{ font-size:9px; color:#736B60; }}
  /* Per-QR tappable action buttons (call / WhatsApp / map / IBAN): each guides the
     reader to one task straight from the invoice, no scan required. */
  .ql-btns {{ display:flex; flex-direction:column; gap:4px; width:100%; margin-top:6px; }}
  .ql-btn-row {{ display:flex; gap:4px; width:100%; }}
  .ql-btn-row > .ql-btn {{ flex:1 1 0; min-width:0; }}
  .ql-btn {{ display:flex; flex-direction:column; align-items:flex-start; gap:0;
             padding:4px 8px; border:1px solid #211C17; border-radius:7px;
             text-decoration:none; color:#211C17; break-inside:avoid; }}
  .ql-btn-info {{ background:#F7F5F1; }}
  .qlb-label {{ font-size:7.5px; font-weight:700; letter-spacing:.05em;
                text-transform:uppercase; color:#736B60; }}
  .qlb-val {{ font-size:10px; font-weight:600; word-break:break-word; line-height:1.2; }}
  /* Quick-action pills — up to six info/link buttons below the QR cards (rental
     total, bank/IBAN, return address, balance, call, WhatsApp). Link pills are
     bordered; info pills are tinted. Two tidy rows of three inside the 640px sheet. */
  .qa-row {{ display:flex; gap:6px; justify-content:center; flex-wrap:wrap; margin-top:10px; }}
  .qa-pill {{ display:flex; flex-direction:column; align-items:flex-start; gap:1px;
              min-width:150px; flex:1 1 150px; max-width:200px; border:1px solid #211C17;
              border-radius:8px; padding:5px 10px; text-decoration:none; color:#211C17;
              break-inside:avoid; }}
  .qa-info {{ background:#F7F5F1; }}
  .qa-label {{ font-size:8px; font-weight:700; letter-spacing:.05em; text-transform:uppercase;
               color:#736B60; }}
  .qa-val {{ font-size:11px; font-weight:600; word-break:break-word; line-height:1.25; }}
  /* Terms & conditions — small two-column list so it still fits one A4 page */
  .terms {{ margin-top:14px; padding-top:10px; border-top:1px dashed #CBD5E1; }}
  .terms h3 {{ font-family:'Plus Jakarta Sans',system-ui,sans-serif; font-size:11px; margin:0 0 6px;
               text-transform:uppercase; letter-spacing:.04em; color:#211C17; }}
  .terms ol {{ margin:0; padding-left:16px; columns:2; column-gap:20px;
               font-size:8.2px; line-height:1.35; color:#475569; }}
  .terms li {{ margin-bottom:3px; break-inside:avoid; }}
  /* Signature area — customer + authorized (the latter carries the company seal) */
  .sign {{ display:flex; gap:40px; margin-top:16px; }}
  .sign-box {{ flex:1; text-align:center; }}
  .seal-slot {{ height:46px; display:flex; align-items:flex-end; justify-content:center; }}
  .seal-slot img.seal {{ max-height:46px; max-width:150px; object-fit:contain; opacity:.92; }}
  .sign-line {{ border-top:1px solid #211C17; margin-top:2px; }}
  .sign-cap {{ font-size:9px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
               color:#736B60; margin-top:4px; }}
  .foot {{ margin-top:12px; font-size:9px; color:#736B60; line-height:1.5; }}
  .toolbar {{ max-width:640px; margin:0 auto 10px; text-align:right; }}
  .toolbar button {{ font-family:'Plus Jakarta Sans',sans-serif; font-size:12px; font-weight:600;
           background:#1A1C1E; color:#fff; border:none; border-radius:8px;
           padding:7px 14px; cursor:pointer; }}
  .toolbar button:hover {{ background:#3F3F46; }}
  /* Copy tag (Customer Copy / Office Copy) at the top of each duplicated sheet */
  .copy-label {{ text-align:right; font-size:9px; font-weight:700; letter-spacing:.12em;
           text-transform:uppercase; color:#736B60; margin-bottom:6px; }}
  .sheet {{ margin-bottom:18px; }}
  @media print {{
    @page {{ size: A4; margin: 10mm; }}
    body {{ background:#fff; padding:0; }}
    /* Each copy prints on its own A4 page; the last one doesn't force a blank trailing page. */
    .sheet {{ border:none; border-radius:0; max-width:none; margin-bottom:0; page-break-after: always; }}
    .sheet:last-of-type {{ page-break-after: auto; }}
    .toolbar {{ display:none !important; }}
  }}
</style></head><body>
  <div class="toolbar"><button onclick="window.print()">{_esc(T('invoice_print'))}</button></div>
  {_SHEETS_START}{copies}{_SHEETS_END}
</body></html>"""


def build_invoices_batch_html(items: list, business_name: str,
                              lang: str = "tr", logo: str = "", stamp: str = "") -> str:
    """Combine several rentals into ONE printable HTML document — a single OFFICE
    copy per rental, each on its own A4 page (the .sheet page-break handles it).

    `items` is a list of (deal, charges) pairs. Each invoice uses its own stored
    invoice_lang (falling back to `lang`). Reuses build_invoice_html so every sheet
    is byte-identical to a single print; the shared <style>/<head> + print toolbar
    are emitted once by splicing on the sheet sentinels."""
    head = tail = None
    sheets: list[str] = []
    for deal, charges in items:
        dl = deal.get("invoice_lang") or lang
        html = build_invoice_html(deal, charges, business_name, dl, logo, stamp,
                                  copy_kinds=("office",))
        before, _, rest = html.partition(_SHEETS_START)
        mid, _, after = rest.partition(_SHEETS_END)
        sheets.append(mid)
        if head is None:
            head, tail = before, after
    if head is None:
        return '<!DOCTYPE html><html><body></body></html>'
    return head + "".join(sheets) + tail


def render_invoice(deal_id: str, key_prefix: str = "inv", lang: str | None = None):
    """Inline invoice preview + language switch + print/download controls."""
    import streamlit as st
    import streamlit.components.v1 as components
    deal = rentals_repo.get_rental_full(deal_id)
    if not deal:
        return
    charges = rentals_repo.list_charges_for_deal(deal_id)
    business = app_cfg.get_business_name()
    logo = app_cfg.get_logo()
    stamp = app_cfg.get_stamp()

    opts = list(LANGUAGES)
    default_lang = lang or deal.get("invoice_lang") or "tr"
    chosen = st.radio(
        t("invoice_language"), opts,
        index=opts.index(default_lang) if default_lang in opts else 0,
        format_func=lambda l: LANGUAGES[l],
        horizontal=True, key=f"{key_prefix}_lang_{deal_id}",
    )
    doc = build_invoice_html(deal, charges, business, lang=chosen, logo=logo, stamp=stamp)
    # Two stacked copies (customer + office) → taller preview, scrollable.
    components.html(doc, height=1180, scrolling=True)
    pdf_bytes = build_invoice_pdf(deal, charges, business, lang=chosen, logo=logo, stamp=stamp)
    st.download_button(
        t("invoice_download"), data=pdf_bytes,
        file_name=f"invoice_{deal_id}_{chosen}.pdf", mime="application/pdf",
        key=f"{key_prefix}_dl_{deal_id}", use_container_width=True,
    )
