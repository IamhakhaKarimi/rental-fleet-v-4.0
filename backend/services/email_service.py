"""
Outbound email (password-recovery delivery).

Prepared for future deploys: SMTP settings live in app_settings (smtp_host /
smtp_port / smtp_user / smtp_pass / smtp_from), editable by a super-admin in
Settings. When SMTP is configured, mail is sent for real via smtplib. Until then
(this phase), nothing is actually transmitted — `send_mail` returns sent=False and
the caller falls back to showing the new password on-screen to the authorised
admin and logging it.

For this phase the recipient defaults to the owner's address so that, once SMTP
is wired, recovery mail lands somewhere real.
"""

import smtplib
import ssl
from email.message import EmailMessage

from data.repositories import app_settings as cfg

# Phase default recipient until per-user emails / SMTP are fully configured.
FALLBACK_EMAIL = "hakamaneshkarimi@gmail.com"

_KEYS = ("smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from")


def smtp_config() -> dict:
    return {k: cfg.get_setting(k, "") for k in _KEYS}


def is_configured() -> bool:
    c = smtp_config()
    return bool(c["smtp_host"] and c["smtp_from"])


def save_smtp_config(host="", port="", user="", password="", sender=""):
    cfg.set_setting("smtp_host", host.strip())
    cfg.set_setting("smtp_port", str(port).strip())
    cfg.set_setting("smtp_user", user.strip())
    cfg.set_setting("smtp_pass", password)          # stored as-is (internal tool)
    cfg.set_setting("smtp_from", (sender or FALLBACK_EMAIL).strip())


def resolve_recipient(user_email: str = "") -> str:
    """Where a recovery mail should go (user's address, else the owner default)."""
    return (user_email or "").strip() or FALLBACK_EMAIL


def send_mail(to: str, subject: str, body: str) -> tuple[bool, str]:
    """Send mail if SMTP is configured. Returns (sent, info). Never raises."""
    to = resolve_recipient(to)
    if not is_configured():
        return False, "smtp_not_configured"
    c = smtp_config()
    try:
        msg = EmailMessage()
        msg["From"] = c["smtp_from"]
        msg["To"] = to
        msg["Subject"] = subject
        msg.set_content(body)
        port = int(c["smtp_port"] or 587)
        ctx = ssl.create_default_context()
        with smtplib.SMTP(c["smtp_host"], port, timeout=15) as s:
            s.starttls(context=ctx)
            if c["smtp_user"]:
                s.login(c["smtp_user"], c["smtp_pass"])
            s.send_message(msg)
        return True, to
    except Exception as e:  # never let mail failure break the reset flow
        return False, f"smtp_error: {e}"
