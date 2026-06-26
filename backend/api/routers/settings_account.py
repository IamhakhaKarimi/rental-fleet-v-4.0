"""Settings — account router: Profile (self-service) + Users management (admin+).

Thin wrappers over services/auth_service.py (which holds the scope/role guards and
returns (ok, msg) / (ok, msg, info) tuples) and data/repositories/users.py. Every
mutation re-checks permissions server-side (via the deps) and audits. Mirrors the
Streamlit Settings → Profile / Users tabs.

Conventions:
  - Profile routes act on **self** (Depends(get_current_user)); auth_service's
    set_user_* helpers do no internal scope check, so we only ever pass the caller's
    own username.
  - Users routes are gated by require("manage_users") (admin+). The scope checks
    (assignable_roles, last-super-admin guard, self-delete guard) live inside
    auth_service and surface as the (ok, msg) tuple — on failure we raise 400 with
    the msg as the i18n key.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status as http
from pydantic import BaseModel

from api.deps import get_current_user, require
from config.roles import assignable_roles, ROLE_LABEL_KEY, ROLE_LEVEL
from config.settings import LANGUAGES, STAFF_ONLY_LANGS
from data.repositories import users as users_repo
from services import audit_service, auth_service

router = APIRouter(prefix="/api", tags=["settings-account"])


# ── Request bodies ───────────────────────────────────────────────────────────
class FullNameIn(BaseModel):
    full_name: str = ""


class EmailIn(BaseModel):
    email: str = ""


class PasswordIn(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str


class LanguageIn(BaseModel):
    lang: str


class UserCreateIn(BaseModel):
    username: str
    password: str
    full_name: str = ""
    role: str
    email: str = ""


class RoleIn(BaseModel):
    role: str


class ActiveIn(BaseModel):
    active: bool


class UsernameIn(BaseModel):
    new_username: str


# ── Profile (self) ───────────────────────────────────────────────────────────
@router.get("/profile")
def get_profile(user: dict = Depends(get_current_user)) -> dict:
    fresh = users_repo.get_user(user["username"]) or {}
    return {
        "username": fresh.get("username", user["username"]),
        "full_name": fresh.get("full_name", "") or "",
        "email": fresh.get("email", "") or "",
        "role": fresh.get("role", user.get("role", "")),
    }


@router.put("/profile/full-name")
def set_profile_full_name(body: FullNameIn,
                          user: dict = Depends(get_current_user)) -> dict:
    auth_service.set_user_full_name(user["username"], body.full_name)
    audit_service.record(user, "edit_profile", "user", user["username"])
    return {"ok": True}


@router.put("/profile/email")
def set_profile_email(body: EmailIn, user: dict = Depends(get_current_user)) -> dict:
    auth_service.set_user_email(user["username"], body.email)
    audit_service.record(user, "edit_profile", "user", user["username"])
    return {"ok": True}


@router.put("/profile/password")
def set_profile_password(body: PasswordIn,
                         user: dict = Depends(get_current_user)) -> dict:
    if body.new_password != body.confirm_password:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, detail="pw_mismatch")
    ok, msg = auth_service.change_password(
        user["username"], body.current_password, body.new_password)
    if not ok:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, detail=msg)
    audit_service.record(user, "change_password", "user", user["username"])
    return {"ok": True}


@router.get("/profile/languages")
def profile_languages(user: dict = Depends(get_current_user)) -> dict:
    staff = ROLE_LEVEL.get(user.get("role", "visitor"), 0) >= 1
    options = [
        {"code": code, "label": label}
        for code, label in LANGUAGES.items()
        if staff or code not in STAFF_ONLY_LANGS
    ]
    return {"options": options, "current": user.get("lang") or "tr"}


@router.put("/profile/language")
def set_profile_language(body: LanguageIn,
                         user: dict = Depends(get_current_user)) -> dict:
    if body.lang not in LANGUAGES:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, detail="fields_required")
    auth_service.set_user_lang(user["username"], body.lang)
    audit_service.record(user, "edit_profile", "user", user["username"], body.lang)
    return {"ok": True}


# ── Users (manage_users, admin+) ─────────────────────────────────────────────
@router.get("/users")
def list_users(actor: dict = Depends(require("manage_users"))) -> list[dict]:
    actor_level = ROLE_LEVEL.get(actor.get("role", "visitor"), 0)
    grantable = assignable_roles(actor)
    me = actor.get("username")
    out: list[dict] = []
    for row in auth_service.all_users():
        is_me = row["username"] == me
        # Pragmatic masking: hide users ranked strictly above the actor, but
        # always include the actor's own account.
        if ROLE_LEVEL.get(row.get("role", "visitor"), 0) > actor_level and not is_me:
            continue
        out.append({
            **row,
            "is_me": is_me,
            "in_scope": row.get("role") in grantable,
            "locked": auth_service.is_last_active_super_admin(row["username"]),
            "role_label_key": ROLE_LABEL_KEY.get(row.get("role", ""), ""),
        })
    return out


@router.get("/users/assignable-roles")
def assignable_roles_list(actor: dict = Depends(require("manage_users"))) -> list[dict]:
    return [{"role": r, "label_key": ROLE_LABEL_KEY.get(r, "")}
            for r in assignable_roles(actor)]


@router.post("/users", status_code=201)
def create_user(body: UserCreateIn,
                actor: dict = Depends(require("manage_users"))) -> dict:
    ok, msg = auth_service.create_user(
        actor, body.username, body.password, body.full_name, body.role, body.email)
    if not ok:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, detail=msg)
    audit_service.record(actor, "create_user", "user", body.username.strip(), body.role)
    return {"ok": True}


@router.put("/users/{username}/role")
def set_user_role(username: str, body: RoleIn,
                  actor: dict = Depends(require("manage_users"))) -> dict:
    ok, msg = auth_service.set_user_role(actor, username, body.role)
    if not ok:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, detail=msg)
    audit_service.record(actor, "set_user_role", "user", username, body.role)
    return {"ok": True}


@router.put("/users/{username}/active")
def set_user_active(username: str, body: ActiveIn,
                    actor: dict = Depends(require("manage_users"))) -> dict:
    ok, msg = auth_service.set_user_active(actor, username, body.active)
    if not ok:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, detail=msg)
    audit_service.record(actor, "set_user_active", "user", username,
                         "active" if body.active else "inactive")
    return {"ok": True}


@router.delete("/users/{username}")
def delete_user(username: str,
                actor: dict = Depends(require("manage_users"))) -> dict:
    ok, msg = auth_service.delete_user(actor, username)
    if not ok:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, detail=msg)
    audit_service.record(actor, "delete_user", "user", username)
    return {"ok": True}


@router.put("/users/{username}/username")
def change_username(username: str, body: UsernameIn,
                    actor: dict = Depends(require("manage_users"))) -> dict:
    ok, msg = auth_service.change_username(actor, username, body.new_username)
    if not ok:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, detail=msg)
    audit_service.record(actor, "change_username", "user", body.new_username.strip(),
                         username)
    return {"ok": True}


@router.post("/users/{username}/reset-password")
def reset_password(username: str,
                   actor: dict = Depends(require("manage_users"))) -> dict:
    ok, msg, info = auth_service.admin_recover_child(actor, username)
    if not ok:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, detail=msg)
    audit_service.record(actor, "reset_password", "user", username)
    sent = bool(info.get("sent"))
    return {
        "ok": True,
        "sent": sent,
        "recipient": info.get("recipient", ""),
        "new_password": "" if sent else info.get("new_password", ""),
    }
