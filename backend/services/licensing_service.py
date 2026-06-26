"""
Annual licensing.

The app is licensed up to a particular calendar year. All date pickers are
capped at 31 Dec of that year, so staff cannot book or record anything in a
not-yet-licensed year. Only a super-admin may unlock further years (e.g. after
renewing/extending the purchase). The licensed year is stored in app_settings.
"""

from datetime import date, datetime

from data.repositories import app_settings as cfg

LICENSED_YEAR_KEY = "licensed_until_year"


def current_year() -> int:
    return datetime.now().year


def licensed_year() -> int:
    """The last fully-licensed calendar year (defaults to the current year)."""
    raw = cfg.get_setting(LICENSED_YEAR_KEY, "")
    try:
        y = int(raw)
    except (TypeError, ValueError):
        y = 0
    # Never below the current year — a stored value can only extend access.
    return max(y, current_year())


def set_licensed_year(year: int):
    cfg.set_setting(LICENSED_YEAR_KEY, str(int(year)))


def extend_licensed_year(year: int):
    """Raise the licensed-year cap to `year` if it is later than the current one."""
    if int(year) > licensed_year():
        set_licensed_year(int(year))


def max_date() -> date:
    """Latest selectable date for any calendar widget."""
    return date(licensed_year(), 12, 31)


def is_unlockable_next_year() -> int:
    """The next year a super-admin could unlock."""
    return licensed_year() + 1


# Renewal reminder window (days before the licensed-year deadline).
RENEWAL_NOTICE_DAYS = 60


def days_until_deadline() -> int:
    """Whole days from today until the license deadline (31 Dec of the licensed
    year). Always >= 0 because the licensed year can never fall below the current
    year."""
    return (max_date() - datetime.now().date()).days


def renewal_due(within_days: int = RENEWAL_NOTICE_DAYS) -> bool:
    """True when the license deadline is `within_days` or fewer away — the cue to
    nudge an admin to renew/extend before staff get locked out of the next year."""
    return days_until_deadline() <= within_days
