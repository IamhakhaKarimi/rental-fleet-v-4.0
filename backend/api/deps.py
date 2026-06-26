"""FastAPI dependencies: resolve the current user and enforce permissions.

Mirrors the Streamlit gating model exactly: every privileged route re-checks
``config.roles.can(user, perm)`` server-side. The client gate is advisory.
"""
from __future__ import annotations

from fastapi import Depends, HTTPException, Request, status

from api.security import decode_token, user_from_claims
from api.settings import settings
from config.roles import can, ROLE_LEVEL


def _extract_token(request: Request) -> str | None:
    tok = request.cookies.get(settings.cookie_name)
    if not tok:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            tok = auth[7:].strip()
    return tok or None


def get_current_user(request: Request) -> dict:
    """Require a valid session; raise 401 otherwise."""
    payload = decode_token(_extract_token(request))
    if not payload:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="not_authenticated")
    return user_from_claims(payload)


def get_optional_user(request: Request) -> dict | None:
    """Return the user if authenticated, else None (public/visitor endpoints)."""
    payload = decode_token(_extract_token(request))
    return user_from_claims(payload) if payload else None


def require(permission: str):
    """Dependency factory: 403 unless the user satisfies ``can(user, permission)``."""

    def _dep(user: dict = Depends(get_current_user)) -> dict:
        if not can(user, permission):
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="access_denied")
        return user

    return _dep


def require_level(min_level: int):
    """Dependency factory gating on a raw role level (for OR-of-perms cases)."""

    def _dep(user: dict = Depends(get_current_user)) -> dict:
        if ROLE_LEVEL.get(user.get("role", "visitor"), 0) < min_level:
            raise HTTPException(status.HTTP_403_FORBIDDEN, detail="access_denied")
        return user

    return _dep
