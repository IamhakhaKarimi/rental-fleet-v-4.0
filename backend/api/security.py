"""JWT issue/verify + auth-cookie helpers.

Replaces the Streamlit remember-me cookie + ``sessions`` table round-trip. The
access token is a stateless JWT carrying the same user claims the rest of the app
relies on: ``{username, full_name, role, email, lang}``. Password hashing/checking
stays in ``services/auth_service.py`` (bcrypt) — unchanged.
"""
from __future__ import annotations

import datetime as _dt

import jwt
from fastapi import Response

from api.settings import settings


def create_access_token(user: dict, remember: bool = True) -> str:
    """Encode the user dict into a signed JWT."""
    now = _dt.datetime.now(_dt.timezone.utc)
    ttl_days = settings.jwt_ttl_days if remember else settings.jwt_ttl_days_short
    payload = {
        "sub": user["username"],
        "full_name": user.get("full_name", ""),
        "role": user.get("role", "visitor"),
        "email": user.get("email", ""),
        "lang": user.get("lang", "tr"),
        "iat": now,
        "exp": now + _dt.timedelta(days=ttl_days),
    }
    return jwt.encode(payload, settings.jwt_secret, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict | None:
    """Return the JWT claims, or None if missing/invalid/expired."""
    if not token:
        return None
    try:
        return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm])
    except Exception:
        return None


def user_from_claims(payload: dict) -> dict:
    """Normalize JWT claims into the canonical user dict used everywhere."""
    return {
        "username": payload.get("sub", ""),
        "full_name": payload.get("full_name", ""),
        "role": payload.get("role", "visitor"),
        "email": payload.get("email", ""),
        "lang": payload.get("lang", "tr"),
    }


def set_auth_cookie(response: Response, token: str, remember: bool = True) -> None:
    ttl_days = settings.jwt_ttl_days if remember else settings.jwt_ttl_days_short
    response.set_cookie(
        key=settings.cookie_name,
        value=token,
        max_age=ttl_days * 24 * 3600,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
        domain=settings.cookie_domain or None,
        path="/",
    )


def clear_auth_cookie(response: Response) -> None:
    response.delete_cookie(
        key=settings.cookie_name,
        domain=settings.cookie_domain or None,
        path="/",
    )
