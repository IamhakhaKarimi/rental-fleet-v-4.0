"""
Editable application settings (key/value).

Currently used for the business name, which a super-admin can change in Settings.
Reads fall back to the default from config so the app always has a name to show,
even before anything has been saved.
"""

from sqlalchemy import text
from core.db import get_engine
from config.settings import APP_NAME

BUSINESS_NAME_KEY = "business_name"
LOGO_KEY = "company_logo"
STAMP_KEY = "company_stamp"
# Business contact + invoice-QR settings (feed the invoice "Quick links" QR buttons)
PHONE_KEY = "business_phone"
ADDRESS_KEY = "business_address"
MAPS_KEY = "business_maps_url"
EMAIL_KEY = "business_email"
IBAN_KEY = "business_iban"
PAY_QR_KEY = "pay_qr_enabled"


def get_setting(key: str, default: str = "") -> str:
    try:
        with get_engine().connect() as conn:
            val = conn.execute(
                text("SELECT value FROM app_settings WHERE key = :k"), {"k": key}
            ).scalar()
        return val if val not in (None, "") else default
    except Exception:
        return default


def set_setting(key: str, value: str):
    with get_engine().begin() as conn:
        conn.execute(
            text("""INSERT INTO app_settings (key, value, updated_at)
                    VALUES (:k, :v, datetime('now'))
                    ON CONFLICT(key) DO UPDATE SET value = :v, updated_at = datetime('now')"""),
            {"k": key, "v": value},
        )


def get_business_name() -> str:
    return get_setting(BUSINESS_NAME_KEY, APP_NAME)


def set_business_name(name: str):
    set_setting(BUSINESS_NAME_KEY, (name or "").strip() or APP_NAME)


def get_logo() -> str:
    return get_setting(LOGO_KEY, "")


def set_logo(b64: str):
    set_setting(LOGO_KEY, b64 or "")


def clear_logo():
    set_setting(LOGO_KEY, "")


# Company stamp / seal — base64 PNG, used as the signature seal on invoices.
def get_stamp() -> str:
    return get_setting(STAMP_KEY, "")


def set_stamp(b64: str):
    set_setting(STAMP_KEY, b64 or "")


def clear_stamp():
    set_setting(STAMP_KEY, "")


# ── Business contact + invoice-QR settings ──────────────────────────────────
# Plain key/value strings feeding the invoice "Quick links" QR buttons.
def get_business_phone() -> str:
    return get_setting(PHONE_KEY, "")


def set_business_phone(v: str):
    set_setting(PHONE_KEY, (v or "").strip())


def get_business_address() -> str:
    return get_setting(ADDRESS_KEY, "")


def set_business_address(v: str):
    set_setting(ADDRESS_KEY, (v or "").strip())


def get_business_maps_url() -> str:
    return get_setting(MAPS_KEY, "")


def set_business_maps_url(v: str):
    set_setting(MAPS_KEY, (v or "").strip())


def get_business_email() -> str:
    return get_setting(EMAIL_KEY, "")


def set_business_email(v: str):
    set_setting(EMAIL_KEY, (v or "").strip())


def get_business_iban() -> str:
    return get_setting(IBAN_KEY, "")


def set_business_iban(v: str):
    # store compact (no spaces) so the SEPA QR payload is valid
    set_setting(IBAN_KEY, (v or "").replace(" ", "").strip())


def get_pay_qr_enabled() -> bool:
    return get_setting(PAY_QR_KEY, "") == "1"


def set_pay_qr_enabled(enabled: bool):
    set_setting(PAY_QR_KEY, "1" if enabled else "")


# ── Theme (super-admin customization: font + colour roles) ───────────────────
# Stored as plain key/value strings; empty means "use the built-in default". The
# theme layer (ui/theme.py) passes its token defaults to get_theme() so this repo
# stays config-free.
_THEME_KEYS = {
    "font": "theme_font", "primary": "theme_primary", "secondary": "theme_secondary",
    "success": "theme_success", "warning": "theme_warning", "alert": "theme_alert",
    "disabled": "theme_disabled", "bg": "theme_bg",
}


def get_theme(defaults: dict) -> dict:
    """Stored theme overrides merged onto `defaults` (caller supplies the built-in
    token defaults). Empty/unset values fall back to the default."""
    out = dict(defaults)
    for name, key in _THEME_KEYS.items():
        v = get_setting(key, "")
        if v:
            out[name] = v
    return out


def set_theme(values: dict):
    for name, key in _THEME_KEYS.items():
        if name in values:
            set_setting(key, (values[name] or "").strip())


def reset_theme():
    for key in _THEME_KEYS.values():
        set_setting(key, "")
