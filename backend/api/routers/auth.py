"""Auth & session router.

Replaces the Streamlit remember-me cookie + bounded priming-rerun restore with a
stateless JWT in an HttpOnly cookie. Login/recovery reuse ``services/auth_service``
(bcrypt) verbatim. ``GET /api/me`` re-reads the user from the DB so role/perm/profile
changes take effect immediately (no stale-token privilege).
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel

from api.deps import get_current_user
from api.security import clear_auth_cookie, create_access_token, set_auth_cookie
from config.roles import PERMISSION_MIN_LEVEL, ROLE_LABEL_KEY, can
from data.repositories import users as users_repo
from services import auth_service

router = APIRouter(prefix="/api", tags=["auth"])


class LoginIn(BaseModel):
    username: str
    password: str
    remember: bool = True


class ForgotIn(BaseModel):
    username: str


def _permissions(user: dict) -> dict:
    """Mirror of can(user, perm) for every permission — the client's UI gate."""
    return {perm: can(user, perm) for perm in PERMISSION_MIN_LEVEL}


def _me_payload(user: dict) -> dict:
    return {
        "username": user["username"],
        "full_name": user.get("full_name", ""),
        "role": user["role"],
        "role_label_key": ROLE_LABEL_KEY.get(user["role"], "role_visitor"),
        "email": user.get("email", "") or "",
        "lang": user.get("lang", "tr") or "tr",
        "can": _permissions(user),
    }


def _fresh_public_user(username: str) -> dict | None:
    """Re-read the canonical user dict from the DB (post role/profile changes)."""
    u = users_repo.get_user(username)
    if not u or not u["is_active"]:
        return None
    return {
        "username": u["username"],
        "full_name": u["full_name"],
        "role": u["role"],
        "email": u.get("email") or "",
        "lang": u.get("lang") or "tr",
    }


@router.post("/auth/login")
def login(body: LoginIn, response: Response) -> dict:
    user = auth_service.authenticate(body.username, body.password)
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="login_failed")
    token = create_access_token(user, remember=body.remember)
    set_auth_cookie(response, token, remember=body.remember)
    return {"user": _me_payload(user), "token": token}


@router.post("/auth/logout")
def logout(response: Response, user: dict = Depends(get_current_user)) -> dict:
    # Stateless JWT — clearing the cookie ends the session client-side.
    clear_auth_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(get_current_user)) -> dict:
    fresh = _fresh_public_user(user["username"])
    if not fresh:
        # Account deleted or deactivated since the token was issued.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="not_authenticated")
    return _me_payload(fresh)


@router.post("/auth/forgot-password")
def forgot_password(body: ForgotIn) -> dict:
    """Login-screen 'forgot password'. Admin/super-admin only (employees/visitors
    must ask an admin). Delivers to the account's own email; when SMTP is unset the
    new password is returned for on-screen display."""
    ok, msg, info = auth_service.self_recover(body.username)
    if not ok:
        code = (
            status.HTTP_403_FORBIDDEN
            if msg == "recover_admin_only"
            else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(code, detail=msg)
    return {
        "ok": True,
        "sent": info.get("sent", False),
        "recipient": info.get("recipient", ""),
        # Shown on-screen only when SMTP is not configured (sent == False).
        "new_password": info.get("new_password", "") if not info.get("sent") else "",
    }
