"""FastAPI dependencies: resolve the current user and enforce permissions.

Mirrors the Streamlit gating model exactly: every privileged route re-checks
``config.roles.can(user, perm)`` server-side. The client gate is advisory.
"""
from __future__ import annotations

import datetime as _dt

from fastapi import Depends, HTTPException, Request, status

from api.security import decode_token, user_from_claims
from api.settings import settings
from config.roles import can, ROLE_LEVEL
from data.repositories import users as users_repo


def _extract_token(request: Request) -> str | None:
    tok = request.cookies.get(settings.cookie_name)
    if not tok:
        auth = request.headers.get("Authorization", "")
        if auth.startswith("Bearer "):
            tok = auth[7:].strip()
    return tok or None


def _resolve(payload: dict | None) -> dict | None:
    """Turn verified JWT claims into a live user.

    The token's signature proves it was issued by us, but not that it still
    reflects reality, so the account row is re-read on every request. That closes
    three gaps a purely stateless check leaves open:

      * a revoked session (logout / logout-all) is rejected even though the JWT
        itself is still validly signed and unexpired;
      * a token issued before the account's last password change is rejected, so
        a password reset genuinely terminates other sessions;
      * role, name and active-flag come from the DB, so a demotion or a
        deactivation takes effect immediately instead of lingering until the
        token expires.

    The session check is folded into the same query as the user re-read
    (``get_user_with_session``), so this costs no extra round-trip over the
    pre-revocation version. Tokens minted before the ``jti`` claim existed have
    no session row and are rejected outright — one forced re-login, once.
    """
    if not payload:
        return None
    jti = payload.get("jti")
    if not jti:
        return None
    claims = user_from_claims(payload)
    row = users_repo.get_user_with_session(claims["username"], jti)
    if not row or not row["is_active"]:
        return None

    changed_at = (row.get("password_changed_at") or "").strip()
    if changed_at:
        try:
            # Stored UTC (see users_repo.update_password); `iat` is UTC too.
            changed = _dt.datetime.fromisoformat(changed_at).replace(tzinfo=_dt.timezone.utc)
            issued = _dt.datetime.fromtimestamp(int(payload.get("iat", 0)), _dt.timezone.utc)
            # 1s of slack: iat is whole seconds, the stamp is truncated to seconds,
            # so a login in the same second as its own password change is genuine.
            if issued < changed - _dt.timedelta(seconds=1):
                return None
        except Exception:
            pass  # unparseable stamp must not lock everyone out

    return {
        "username": row["username"],
        "full_name": row["full_name"],
        "role": row["role"],
        "email": row.get("email") or "",
        "lang": row.get("lang") or "tr",
    }


def get_current_user(request: Request) -> dict:
    """Require a valid session; raise 401 otherwise."""
    user = _resolve(decode_token(_extract_token(request)))
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="not_authenticated")
    return user


def get_optional_user(request: Request) -> dict | None:
    """Return the user if authenticated, else None (public/visitor endpoints)."""
    return _resolve(decode_token(_extract_token(request)))


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
