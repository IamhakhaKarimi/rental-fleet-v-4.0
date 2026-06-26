"""
Software license / purchase invoice (super-admin only).

Generates a compact, print-ready invoice recording the purchase of an annual
software license — separate from the customer rental invoices. The super-admin
enters the period, amount and date in a popup; the same HTML is previewed,
printable (window.print()) and downloadable.
"""

import html as _html

import streamlit as st
import streamlit.components.v1 as components

from config.i18n import t
from config.settings import APP_NAME, APP_TAGLINE, APP_VERSION, CURRENCY_SYMBOL
from ui.components import format_eur
from ui.pdf import build_license_invoice_pdf
from data.repositories import app_settings as app_cfg


def _esc(v) -> str:
    return _html.escape(str(v if v is not None else ""))


def build_license_invoice_html(d: dict) -> str:
    logo = app_cfg.get_logo()
    logo_img = ""
    if logo:
        logo_img = (
            f'<img src="data:image/png;base64,{logo}" '
            f'style="max-height:46px;max-width:170px;margin-bottom:5px;display:block"/>'
        )
    # Signature seal: company stamp preferred, else the logo (shown if available).
    seal = app_cfg.get_stamp() or logo
    seal_img = (f'<img class="seal" src="data:image/png;base64,{seal}" alt=""/>'
                if seal else "")
    signature_block = (
        '<div class="sign">'
        '<div class="sign-box"><div class="seal-slot"></div>'
        '<div class="sign-line"></div>'
        f'<div class="sign-cap">{_esc(t("invoice_customer_signature"))}</div></div>'
        f'<div class="sign-box"><div class="seal-slot">{seal_img}</div>'
        '<div class="sign-line"></div>'
        f'<div class="sign-cap">{_esc(t("invoice_authorized_signature"))}</div></div>'
        '</div>'
    )
    amount = int(d.get("amount_cents") or 0)
    period = f'{d.get("start_year")} – {d.get("end_year")}'
    rows = [
        (t("license_product"), f'{APP_NAME} · {APP_TAGLINE} v{APP_VERSION}'),
        (t("license_period"), period),
        (t("license_years"), str(d.get("years") or 1)),
        (t("license_purchase_date"), d.get("date") or ""),
    ]
    rows_html = "".join(
        f"<tr><td class='k'>{_esc(k)}</td><td>{_esc(v)}</td></tr>" for k, v in rows
    )
    return f"""<!DOCTYPE html><html><head><meta charset="utf-8"/>
<title>{_esc(t('license_invoice_title'))} {_esc(d.get('invoice_no',''))}</title>
<style>
  @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
  *{{box-sizing:border-box}}
  body{{font-family:'Plus Jakarta Sans',system-ui,sans-serif;color:#211C17;margin:0;background:#F2EFE9;padding:16px}}
  .sheet{{max-width:600px;margin:0 auto;background:#fff;border:1px solid #E7E0D5;border-radius:10px;padding:22px 26px;font-size:13px}}
  .top{{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #1A1C1E;padding-bottom:10px;margin-bottom:14px}}
  .brand{{font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-weight:700;font-size:18px}}
  .brand small{{display:block;font-size:9px;letter-spacing:.12em;text-transform:uppercase;color:#736B60;margin-top:3px}}
  h1{{font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-size:19px;margin:0;color:#1A1C1E;text-align:right}}
  .meta{{font-size:11px;color:#475569;text-align:right;margin-top:4px;line-height:1.5}}
  .meta b{{color:#211C17}}
  .lbl{{font-size:9px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;color:#736B60;margin:10px 0 3px}}
  table{{width:100%;border-collapse:collapse;margin-top:6px}}
  td{{font-size:12.5px;padding:7px 5px;border-bottom:1px solid #F2EFE9}}
  td.k{{color:#736B60;width:45%}}
  .total{{display:flex;justify-content:space-between;margin-top:14px;padding-top:10px;border-top:2px solid #211C17;
          font-family:'Plus Jakarta Sans',system-ui,sans-serif;font-weight:700;font-size:17px}}
  .total .amt{{color:#1A1C1E}}
  .sign{{display:flex;gap:36px;margin-top:18px}}
  .sign-box{{flex:1;text-align:center}}
  .seal-slot{{height:46px;display:flex;align-items:flex-end;justify-content:center}}
  .seal-slot img.seal{{max-height:46px;max-width:150px;object-fit:contain;opacity:.92}}
  .sign-line{{border-top:1px solid #211C17;margin-top:2px}}
  .sign-cap{{font-size:9px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:#736B60;margin-top:4px}}
  .foot{{margin-top:16px;font-size:10px;color:#736B60;line-height:1.5}}
  .toolbar{{max-width:600px;margin:0 auto 10px;text-align:right}}
  .toolbar button{{font-size:12px;font-weight:600;background:#1A1C1E;color:#fff;border:none;border-radius:8px;padding:7px 14px;cursor:pointer}}
  @media print{{ @page{{size:A4;margin:12mm}} body{{background:#fff;padding:0}} .sheet{{border:none}} .toolbar{{display:none!important}} }}
</style></head><body>
  <div class="toolbar"><button onclick="window.print()">{_esc(t('invoice_print'))}</button></div>
  <div class="sheet">
    <div class="top">
      <div class="brand">{logo_img}{_esc(APP_NAME)}<small>{_esc(APP_TAGLINE)}</small></div>
      <div>
        <h1>{_esc(t('license_invoice_title'))}</h1>
        <div class="meta">
          <div>{_esc(t('invoice_no'))}: <b>{_esc(d.get('invoice_no',''))}</b></div>
          <div>{_esc(t('invoice_date'))}: <b>{_esc(d.get('date',''))}</b></div>
        </div>
      </div>
    </div>
    <div class="lbl">{_esc(t('license_licensee'))}</div>
    <div><b>{_esc(d.get('licensee',''))}</b></div>
    <table>{rows_html}</table>
    <div class="total"><span>{_esc(t('invoice_total'))}</span>
      <span class="amt">{format_eur(amount)}</span></div>
    {signature_block}
    <div class="foot">{_esc(t('invoice_thanks'))} · {_esc(t('invoice_footer'))}</div>
  </div>
</body></html>"""


def render_license_invoice(d: dict, key: str = "lic"):
    doc = build_license_invoice_html(d)
    components.html(doc, height=560, scrolling=True)
    pdf_bytes = build_license_invoice_pdf(d)
    st.download_button(
        t("invoice_download"), data=pdf_bytes,
        file_name=f"license_invoice_{d.get('invoice_no','')}.pdf", mime="application/pdf",
        key=f"{key}_dl", use_container_width=True,
    )
