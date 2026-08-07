"""
Outbound email (password-reset delivery).

SMTP settings live in app_settings (smtp_host / smtp_port / smtp_user / smtp_pass /
smtp_from), editable by a super-admin in Settings. When SMTP is unconfigured
`send_mail` returns sent=False and transmits nothing.

Two different "where does this go" rules live here, and the difference matters:

  * `resolve_recipient` keeps the old owner-address fallback. It is for
    OPERATIONAL mail (an admin recovering a colleague's account) where landing in
    the owner's inbox is a reasonable backstop.
  * `send_password_reset` deliberately does NOT fall back. A reset link grants
    control of an account, so it is only ever sent to the address recorded on that
    account — mailing it to the owner because a user has no address on file would
    hand one person a link into another person's account.
"""

import smtplib
import ssl
from email.message import EmailMessage
from email.utils import formataddr

from data.repositories import app_settings as cfg

# The address recovery mail is sent FROM when smtp_from has not been set in
# Settings. Also the last-resort recipient for operational (non-reset) mail.
DEFAULT_SENDER = "karimihakamaneshkarimi@gmail.com"
FALLBACK_EMAIL = DEFAULT_SENDER

_KEYS = ("smtp_host", "smtp_port", "smtp_user", "smtp_pass", "smtp_from")


def smtp_config() -> dict:
    return {k: cfg.get_setting(k, "") for k in _KEYS}


def is_configured() -> bool:
    c = smtp_config()
    return bool(c["smtp_host"] and (c["smtp_from"] or DEFAULT_SENDER))


def save_smtp_config(host="", port="", user="", password="", sender=""):
    cfg.set_setting("smtp_host", host.strip())
    cfg.set_setting("smtp_port", str(port).strip())
    cfg.set_setting("smtp_user", user.strip())
    cfg.set_setting("smtp_pass", password)          # stored as-is (internal tool)
    cfg.set_setting("smtp_from", (sender or DEFAULT_SENDER).strip())


def sender_address() -> str:
    return (smtp_config().get("smtp_from") or "").strip() or DEFAULT_SENDER


def resolve_recipient(user_email: str = "") -> str:
    """Where OPERATIONAL mail should go (user's address, else the owner default).
    Never use this for reset links — see `send_password_reset`."""
    return (user_email or "").strip() or FALLBACK_EMAIL


def send_mail(to: str, subject: str, body: str, *, allow_fallback: bool = True) -> tuple[bool, str]:
    """Send mail if SMTP is configured. Returns (sent, info). Never raises.

    `allow_fallback=False` disables the owner-address substitution, so a caller
    handling account-sensitive mail fails closed on a blank recipient instead of
    silently redirecting it."""
    to = resolve_recipient(to) if allow_fallback else (to or "").strip()
    if not to:
        return False, "no_recipient"
    if not is_configured():
        return False, "smtp_not_configured"
    c = smtp_config()
    try:
        msg = EmailMessage()
        msg["From"] = formataddr(("Balkan Car Rentals", sender_address()))
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


def send_password_reset(to_email: str, username: str, link: str,
                        ttl_minutes: int) -> tuple[bool, str]:
    """Mail a password-reset link. Strictly no recipient fallback: an empty
    `to_email` returns (False, 'no_recipient') rather than mailing anyone else."""
    to = (to_email or "").strip()
    if not to:
        return False, "no_recipient"
    body = (
        f"Hello,\n\n"
        f"A password reset was requested for the Balkan Car Rentals account "
        f"'{username}'.\n\n"
        f"Open this link to choose a new password:\n{link}\n\n"
        f"The link can be used once and expires in {ttl_minutes} minutes.\n\n"
        f"If you did not request this, you can ignore this email — your password "
        f"has not been changed.\n"
    )
    return send_mail(to, "Balkan Car Rentals — reset your password", body,
                     allow_fallback=False)
