"""
Annual licensing — the year cap, its tamper-evident storage, and the one guard
every date-writing endpoint calls.

The app is licensed up to a particular calendar year. Nothing may be booked,
rescheduled or recorded past 31 Dec of that year: the date pickers are capped
there, and — because a picker is only a suggestion — every API route that writes
a date re-checks the cap server-side through ``assert_allowed()``. Only a
super-admin may unlock further years, by issuing a license key (see
``license_key`` / ``verify_license_key``) that an admin redeems.

Tamper resistance
-----------------
The licensed year lives in ``app_settings``, which is a plain table an admin can
reach through the backup/restore endpoints. So the stored value is not a bare
number: it is *sealed* with an HMAC over the year, keyed by ``JWT_SECRET``, which
never lives in the database. A value that is missing, edited by hand, or carried
in from a foreign backup fails verification and is treated as "no extension" —
the cap falls back to the current year rather than to whatever the row claims.
``data/repositories/admin_ops.py`` additionally refuses to import these keys, so
restoring a doctored backup cannot move the cap either.

Installations that predate the seal store a bare integer. ``migrate_legacy_seal()``
(called once at startup) upgrades such a value in place and stamps
``licensed_until_year_sealed_at``. Once that stamp exists a bare integer is never
trusted again, so the migration cannot be replayed to smuggle a year in.
"""

from __future__ import annotations

import hashlib
import hmac
import logging
from datetime import date, datetime

from api.settings import settings
from data.repositories import app_settings as cfg

log = logging.getLogger(__name__)

LICENSED_YEAR_KEY = "licensed_until_year"
SEALED_AT_KEY = "licensed_until_year_sealed_at"

#: Settings keys that carry license state. Never exported or imported — see
#: ``data/repositories/admin_ops.py``.
PROTECTED_SETTING_KEYS = frozenset({LICENSED_YEAR_KEY, SEALED_AT_KEY})

# Sanity bounds for any year this module will accept from anywhere.
MIN_LICENSE_YEAR = 2020
MAX_LICENSE_YEAR = 2100

_SEAL_PREFIX = "v1"


class LicenseLimitError(Exception):
    """A date fell outside the licensed period.

    Raised by :func:`assert_allowed`. ``api/main.py`` installs a handler that
    turns it into ``403 {"detail": "license_year_locked", ...}``; the extra
    fields let the UI say exactly which day was rejected and until when the
    installation is licensed.
    """

    def __init__(self, value: str = "", field: str = ""):
        self.value = value
        self.field = field
        self.licensed_year = licensed_year()
        self.max_date = max_date().isoformat()
        self.next_year = self.licensed_year + 1
        super().__init__("license_year_locked")


# ── Year helpers ─────────────────────────────────────────────────────────────
def current_year() -> int:
    return datetime.now().year


def _valid_year(value) -> int | None:
    try:
        y = int(value)
    except (TypeError, ValueError):
        return None
    return y if MIN_LICENSE_YEAR <= y <= MAX_LICENSE_YEAR else None


# ── Sealing (HMAC over the year, keyed by JWT_SECRET) ────────────────────────
def _digest(message: str) -> str:
    return hmac.new(settings.jwt_secret.encode(), message.encode(), hashlib.sha256).hexdigest().upper()


def _seal(year: int) -> str:
    """The storable representation of `year`: ``v1:<year>:<32 hex>``."""
    return f"{_SEAL_PREFIX}:{int(year)}:{_digest(f'BCR-LICENSE-SEAL-v1-{int(year)}')[:32]}"


def _unseal(raw: str) -> int | None:
    """The year a stored value proves, or None if it proves nothing.

    None covers every untrusted case identically — empty, legacy bare integer,
    hand-edited, restored from another installation's backup, or out of bounds.
    """
    parts = (raw or "").strip().split(":")
    if len(parts) != 3 or parts[0] != _SEAL_PREFIX:
        return None
    year = _valid_year(parts[1])
    if year is None:
        return None
    return year if hmac.compare_digest(_seal(year), f"{_SEAL_PREFIX}:{year}:{parts[2]}") else None


def licensed_year() -> int:
    """The last fully-licensed calendar year.

    Falls back to the current year whenever the stored seal is absent or does not
    verify: an unreadable license must degrade to "this year only", never to
    "any year" and never to a locked-out app.
    """
    raw = cfg.get_setting(LICENSED_YEAR_KEY, "")
    year = _unseal(raw)
    if year is None and raw:
        log.warning("Licensed-year value failed verification; falling back to the current year.")
    # A stored value can only ever extend access, never revoke the current year.
    return max(year or 0, current_year())


def set_licensed_year(year: int) -> int:
    """Set the cap to `year` (sealed). Returns the effective licensed year."""
    y = _valid_year(year)
    if y is None:
        raise ValueError("year_out_of_range")
    cfg.set_setting(LICENSED_YEAR_KEY, _seal(y))
    cfg.set_setting(SEALED_AT_KEY, datetime.now().isoformat(timespec="seconds"))
    return licensed_year()


def extend_licensed_year(year: int) -> int:
    """Raise the cap to `year` if that is later than the current one."""
    y = _valid_year(year)
    if y is None:
        raise ValueError("year_out_of_range")
    if y > licensed_year():
        return set_licensed_year(y)
    return licensed_year()


def migrate_legacy_seal() -> bool:
    """One-shot upgrade of a pre-seal bare-integer value. Returns True if it ran.

    Guarded by ``SEALED_AT_KEY``: once anything has been sealed on this
    installation, a bare integer is permanently untrusted, so re-inserting one
    (via a doctored backup, say) and restarting cannot unlock a year.
    """
    raw = (cfg.get_setting(LICENSED_YEAR_KEY, "") or "").strip()
    if not raw or _unseal(raw) is not None:
        return False
    if cfg.get_setting(SEALED_AT_KEY, ""):
        log.warning("Ignoring unsealed licensed-year value %r — this install already uses sealed values.", raw)
        return False
    year = _valid_year(raw)
    if year is None:
        log.warning("Ignoring unrecognised licensed-year value %r.", raw)
        return False
    set_licensed_year(year)
    log.info("Migrated legacy licensed-year %s to a sealed value.", year)
    return True


# ── License keys (super-admin issues, admin redeems) ─────────────────────────
def license_key(year: int) -> str:
    """The activation key for `year` — deterministic, offline-verifiable, keyed
    by JWT_SECRET, so no key database is needed. Format ``BCR-2027-AAAA-BBBB-CCCC``."""
    y = _valid_year(year)
    if y is None:
        raise ValueError("year_out_of_range")
    s = _digest(f"BCR-LICENSE-{y}")[:12]
    return f"BCR-{y}-{s[0:4]}-{s[4:8]}-{s[8:12]}"


def verify_license_key(raw: str) -> int | None:
    """The year a key unlocks, or None if it is not a key this install issued."""
    cleaned = (raw or "").strip().upper().replace(" ", "")
    parts = cleaned.split("-")
    if len(parts) < 2 or parts[0] != "BCR":
        return None
    year = _valid_year(parts[1]) if parts[1].isdigit() else None
    if year is None:
        return None
    # Constant-time compare of the whole key, separators ignored.
    return year if hmac.compare_digest(license_key(year).replace("-", ""), cleaned.replace("-", "")) else None


# ── The cap, and the guard every write goes through ──────────────────────────
def max_date() -> date:
    """Latest selectable/persistable day for any calendar widget or endpoint."""
    return date(licensed_year(), 12, 31)


def _as_day(value) -> date | None:
    """Coerce a date/datetime/ISO string to a day, or None if unparseable."""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    text = str(value or "").strip()
    if len(text) < 10:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def is_allowed(value) -> bool:
    """True when `value` falls on or before the licensed cap.

    Unparseable input is *not* rejected here — the caller's own date parsing owns
    that error, and swallowing it would turn a malformed date into a misleading
    "renew your license" message.
    """
    day = _as_day(value)
    return day is None or day <= max_date()


def assert_allowed(*values, field: str = "") -> None:
    """Raise :class:`LicenseLimitError` if any value falls past the licensed cap.

    This is the single server-side gate. Call it in the router for every date a
    request would persist — including dates the server *derives*, such as a
    return date computed from a start date plus a day count.
    """
    for value in values:
        if not is_allowed(value):
            day = _as_day(value)
            raise LicenseLimitError(value=day.isoformat() if day else str(value), field=field)


def limits() -> dict:
    """The cap as the frontend needs it — every date picker in the app reads this."""
    y = licensed_year()
    return {
        "licensed_year": y,
        "current_year": current_year(),
        "max_date": max_date().isoformat(),
        "next_year": y + 1,
        "days_left": days_until_deadline(),
        "renewal_due": renewal_due(),
    }


# ── Renewal reminder window (days before the licensed-year deadline) ─────────
RENEWAL_NOTICE_DAYS = 60


def is_unlockable_next_year() -> int:
    """The next year a super-admin could unlock."""
    return licensed_year() + 1


def days_until_deadline() -> int:
    """Whole days from today until the license deadline (31 Dec of the licensed
    year). Always >= 0 because the licensed year can never fall below the current
    year."""
    return (max_date() - datetime.now().date()).days


def renewal_due(within_days: int = RENEWAL_NOTICE_DAYS) -> bool:
    """True when the license deadline is `within_days` or fewer away — the cue to
    nudge an admin to renew/extend before staff get locked out of the next year."""
    return days_until_deadline() <= within_days
