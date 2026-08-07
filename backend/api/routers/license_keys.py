"""License-key generator + redeem, and the cap every client reads.

A super-admin generates a signed key for a year; an admin redeems it to unlock that
year's calendar access (extends the licensed year, so booking/cost date pickers reach
that year). The key is an HMAC over the year with the app's JWT_SECRET — deterministic,
offline-verifiable, no DB of keys needed. Both the derivation and the stored cap live
in ``services/licensing_service.py``; this router is transport only.

``GET /api/license/limits`` is readable by *any* signed-in user: every date picker in
the frontend caps itself with it, so an agent never gets offered a day the server is
going to refuse.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import get_current_user, require, require_level
from services import audit_service, licensing_service

router = APIRouter(prefix="/api/license", tags=["license-keys"])


class GenIn(BaseModel):
    year: int


class RedeemIn(BaseModel):
    key: str


@router.get("/limits")
def limits(user: dict = Depends(get_current_user)) -> dict:
    """The licensed cap. Not privileged: knowing the last bookable day tells you
    nothing you couldn't learn by having a booking refused, and every calendar in
    the app needs it."""
    return licensing_service.limits()


@router.post("/generate-key")
def generate_key(body: GenIn, user: dict = Depends(require("edit_business_settings"))) -> dict:
    try:
        key = licensing_service.license_key(int(body.year))
    except (TypeError, ValueError):
        raise HTTPException(400, detail="fields_required")
    audit_service.record(user, "generate_license_key", "license", str(int(body.year)))
    return {"year": int(body.year), "key": key}


@router.post("/redeem")
def redeem(body: RedeemIn, user: dict = Depends(require_level(2))) -> dict:  # admin + super-admin
    year = licensing_service.verify_license_key(body.key)
    if year is None:
        raise HTTPException(400, detail="invalid_key")
    licensed = licensing_service.extend_licensed_year(year)
    audit_service.record(user, "redeem_license", "license", str(year))
    return {"ok": True, "year": year, "licensed_year": licensed}
