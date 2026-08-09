"""Auth & session router.

Replaces the Streamlit remember-me cookie + bounded priming-rerun restore with a
stateless JWT in an HttpOnly cookie. Login/recovery reuse ``services/auth_service``
(bcrypt) verbatim. ``GET /api/me`` re-reads the user from the DB so role/perm/profile
changes take effect immediately (no stale-token privilege).
"""
from __future__ import annotations

import time

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel

from api.deps import _extract_token, get_current_user
from api.middleware import client_ip
from api.security import clear_auth_cookie, create_access_token, decode_token, set_auth_cookie
from api.settings import settings
from config.roles import PERMISSION_MIN_LEVEL, ROLE_LABEL_KEY, can
from data.repositories import users as users_repo
from services import audit_service, auth_service

router = APIRouter(prefix="/api", tags=["auth"])


class LoginIn(BaseModel):
    username: str
    password: str
    remember: bool = True


class ForgotIn(BaseModel):
    # Username OR email address — the flow accepts whichever the user remembers.
    username: str


class ResetIn(BaseModel):
    token: str
    new_password: str


def _client_ip(request: Request) -> str:
    # Delegates to the proxy-aware helper middleware.py already uses for the L1
    # rate limiter, so lockout and rate limiting agree on who the caller is —
    # a request.client.host read here would report Nginx's address in
    # production and collapse every staff member into one IP (§8.2 M2).
    return client_ip(request.scope)


def _is_local_dev(request: Request) -> bool:
    """True only for a request that genuinely originated on this machine, in a
    development configuration.

    The forwarding-header check matters: behind a reverse proxy every request
    arrives from 127.0.0.1, so a loopback test alone would call the whole internet
    "local". Presence of any proxy header means the peer is not the real client.
    """
    if any(h in request.headers for h in
           ("x-forwarded-for", "x-real-ip", "forwarded", "x-forwarded-host")):
        return False
    return _client_ip(request) in {"127.0.0.1", "::1", "localhost"}


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
def login(body: LoginIn, response: Response, request: Request) -> dict:
    """Password login, throttled per account.

    The lock is keyed on (username, ip) with exponential backoff, so an attacker
    hammering a known username can only ever lock out their own IP's attempts
    against that name — never the genuine user logging in from their usual
    network. It is checked BEFORE the password is verified so a locked pair
    costs an attacker a request without giving them a bcrypt comparison to time.
    A separate global-per-username counter adds a small delay (never a lock)
    once failures pile up across many IPs, as friction against a distributed
    guessing spread."""
    username = (body.username or "").strip()
    ip = _client_ip(request)
    locked = auth_service.lockout_remaining(username, ip)
    if locked > 0:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail="account_locked",
            headers={"Retry-After": str(locked)},
        )

    delay = auth_service.global_login_delay_seconds(username)
    if delay:
        time.sleep(delay)

    user = auth_service.authenticate(username, body.password)
    if not user:
        lock_secs = auth_service.register_login_failure(username, ip)
        audit_service.record({"username": username or "?"}, "login_failed", "auth",
                             username, f"ip={ip}")
        if lock_secs:
            raise HTTPException(
                status.HTTP_429_TOO_MANY_REQUESTS,
                detail="account_locked",
                headers={"Retry-After": str(lock_secs)},
            )
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="login_failed")

    auth_service.clear_login_failures(username, ip)
    token, jti, expires_at = create_access_token(user, remember=body.remember)
    users_repo.insert_session(jti, user["username"], expires_at.replace(tzinfo=None))
    set_auth_cookie(response, token, remember=body.remember)
    return {"user": _me_payload(user), "token": token}


@router.post("/auth/logout")
def logout(request: Request, response: Response, user: dict = Depends(get_current_user)) -> dict:
    payload = decode_token(_extract_token(request))
    jti = (payload or {}).get("jti")
    if jti:
        users_repo.delete_session(jti)
    clear_auth_cookie(response)
    return {"ok": True}


@router.post("/auth/logout-all")
def logout_all(response: Response, user: dict = Depends(get_current_user)) -> dict:
    """Revoke every session for this account, including the one making the call."""
    users_repo.delete_sessions_for_user(user["username"])
    clear_auth_cookie(response)
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(get_current_user)) -> dict:
    fresh = _fresh_public_user(user["username"])
    if not fresh:
        # Account deleted or deactivated since the token was issued.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, detail="not_authenticated")
    return _me_payload(fresh)


@router.get("/auth/password-policy")
def password_policy() -> dict:
    """Rules the reset / change-password screens display and pre-validate against.
    Public: it describes the policy, not any account."""
    return auth_service.password_policy()


@router.post("/auth/forgot-password")
def forgot_password(body: ForgotIn, request: Request) -> dict:
    """Login-screen 'forgot password'. Accepts a username or an email address and
    mails a single-use reset link to the address on that account.

    The response is deliberately constant: no indication of whether the account
    exists, is active, or has an email on file. Nothing about the account changes
    here — in particular the password is NOT reset — so this endpoint cannot be
    used to lock someone out or to enumerate usernames.
    """
    info = auth_service.request_password_reset(body.username, _client_ip(request))
    if info["issued"]:
        audit_service.record({"username": "?"}, "password_reset_requested", "auth", "",
                             f"sent={info['sent']} ip={_client_ip(request)}")
    out = {"ok": True}
    # Local development convenience only: with SMTP unconfigured there is no way
    # to receive the link, so it is handed back — but ONLY to a loopback caller,
    # never over a network, so a deployed instance cannot leak it.
    if info["debug_link"] and _is_local_dev(request) and not settings.cookie_secure:
        out["debug_link"] = info["debug_link"]
    return out


@router.get("/auth/reset-password")
def check_reset_token(token: str = "") -> dict:
    """Is this link still redeemable? Lets the reset page show 'expired' up front
    instead of after the user has typed a new password."""
    return {"valid": auth_service.peek_reset_token(token)}


@router.post("/auth/reset-password")
def reset_password(body: ResetIn, request: Request) -> dict:
    """Redeem a reset link and set the new password. Consuming the token also
    invalidates every existing session for that account."""
    ok, msg = auth_service.reset_password_with_token(body.token, body.new_password)
    if not ok:
        code = (status.HTTP_410_GONE
                if msg in {"reset_token_invalid", "reset_token_expired"}
                else status.HTTP_400_BAD_REQUEST)
        raise HTTPException(code, detail=msg)
    audit_service.record({"username": msg}, "password_reset_completed", "auth", msg,
                         f"ip={_client_ip(request)}")
    return {"ok": True}
