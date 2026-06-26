"""License-key generator + redeem.

A super-admin generates a signed key for a year; an admin redeems it to unlock that
year's calendar access (extends the licensed year, so booking/cost date pickers reach
that year). The key is an HMAC over the year with the app's JWT_SECRET — deterministic,
offline-verifiable, no DB of keys needed.
"""
from __future__ import annotations

import hashlib
import hmac

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import require, require_level
from api.settings import settings
from services import audit_service, licensing_service

router = APIRouter(prefix="/api/license", tags=["license-keys"])


def _sig(year: int) -> str:
    msg = f"BCR-LICENSE-{year}".encode()
    return hmac.new(settings.jwt_secret.encode(), msg, hashlib.sha256).hexdigest()[:12].upper()


def _key(year: int) -> str:
    s = _sig(year)
    return f"BCR-{year}-{s[0:4]}-{s[4:8]}-{s[8:12]}"


class GenIn(BaseModel):
    year: int


class RedeemIn(BaseModel):
    key: str


@router.post("/generate-key")
def generate_key(body: GenIn, user: dict = Depends(require("edit_business_settings"))) -> dict:
    y = int(body.year)
    if y < 2020 or y > 2100:
        raise HTTPException(400, detail="fields_required")
    audit_service.record(user, "generate_license_key", "license", str(y))
    return {"year": y, "key": _key(y)}


@router.post("/redeem")
def redeem(body: RedeemIn, user: dict = Depends(require_level(2))) -> dict:  # admin + super-admin
    raw = (body.key or "").strip().upper().replace(" ", "")
    parts = raw.split("-")
    if len(parts) < 2 or parts[0] != "BCR" or not parts[1].isdigit():
        raise HTTPException(400, detail="invalid_key")
    year = int(parts[1])
    # Re-derive the key for that year and compare (constant-time).
    if not hmac.compare_digest(_key(year).replace("-", ""), raw.replace("-", "")):
        raise HTTPException(400, detail="invalid_key")
    licensing_service.extend_licensed_year(year)
    audit_service.record(user, "redeem_license", "license", str(year))
    return {"ok": True, "year": year, "licensed_year": licensing_service.licensed_year()}
