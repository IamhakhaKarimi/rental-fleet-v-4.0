"""Meta router — public brand info + the gated top-nav item list.

Mirrors ui/nav.py: the section rows are Home / Reservations / Fleet / Customers /
Finance, each gated by ``can()``. Settings is NOT a nav row (it lives in the account
popover), so it is intentionally excluded here.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from api.deps import get_current_user
from config.roles import can
from config.settings import APP_TAGLINE, APP_VERSION
from data.repositories import app_settings as app_cfg

router = APIRouter(prefix="/api", tags=["meta"])


@router.get("/business/name")
def business_name() -> dict:
    """Public brand header data (name, single-letter avatar initial, tagline)."""
    name = app_cfg.get_business_name()
    initial = (name.strip()[:1] or "B").upper()
    return {
        "business_name": name,
        "initial": initial,
        "tagline": APP_TAGLINE,
        "version": APP_VERSION,
    }


# key, i18n label key, Material Symbols icon, permission gate (None = always)
_NAV = [
    ("dashboard", "nav_dashboard", "home", None),
    ("reservations", "nav_reservations", "calendar_month", "view_management"),
    ("fleet", "nav_fleet", "directions_car", "view_management"),
    ("customers", "nav_customers", "group", "view_management"),
    ("finance", "nav_finance", "payments", "view_finance"),
    # The Admin Panel (staff accounts + the role/permission matrix) is not a nav
    # entry: it lives in Settings -> Roles, alongside the other admin screens.
]


@router.get("/nav")
def nav(user: dict = Depends(get_current_user)) -> list[dict]:
    return [
        {"key": key, "label_key": lk, "icon": icon}
        for key, lk, icon, perm in _NAV
        if perm is None or can(user, perm)
    ]
