"""
Authentication & account service.

Security choices:
  - Passwords are hashed with bcrypt (per-password salt, slow by design). This
    is a real password-hashing function, unlike the old unsalted SHA-256.
  - "Remember me" works via a random session token: a 256-bit token is put in a
    browser cookie, and only its SHA-256 hash is stored in the database. So even
    if the database leaked, the stored hashes could not be replayed as cookies.
  - Remember me ON  -> token valid 30 days (cookie persists across restarts).
    Remember me OFF -> token valid 12 hours (and a session cookie that dies when
    the browser closes).
"""

import hashlib
import secrets
from datetime import datetime, timedelta

from config.settings import LANGUAGES

import bcrypt

from config.roles import assignable_roles, ROLES
from data.repositories import users as users_repo

MIN_PASSWORD_LEN = 6
REMEMBER_DAYS = 30
SESSION_HOURS = 12

DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "admin"   # change immediately in Settings


# ---- Password hashing -------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8"), stored_hash.encode("utf-8"))
    except Exception:
        return False


# ---- First-run seeding ------------------------------------------------------
def ensure_default_admin():
    if users_repo.count_users() == 0:
        users_repo.insert_user(
            DEFAULT_ADMIN_USERNAME,
            hash_password(DEFAULT_ADMIN_PASSWORD),
            full_name="System Administrator",
            role="super_admin",
        )


# ---- Login ------------------------------------------------------------------
def _public(user: dict) -> dict:
    """The user shape the rest of the app passes around (no password hash)."""
    return {
        "username": user["username"],
        "full_name": user["full_name"],
        "role": user["role"],
        "lang": user.get("lang") or "tr",
        "email": user.get("email") or "",
    }


def authenticate(username: str, password: str) -> dict | None:
    user = users_repo.get_user((username or "").strip())
    if not user or not user["is_active"]:
        return None
    if verify_password(password, user["password_hash"]):
        return _public(user)
    return None


# ---- Sessions (remember me) -------------------------------------------------
def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def create_session(username: str, remember: bool) -> tuple[str, datetime]:
    # Opportunistic hygiene: clear any expired sessions on each new login so the
    # table stays bounded even on long-running servers (cheap; indexed delete).
    users_repo.purge_expired_sessions()
    token = secrets.token_urlsafe(32)
    duration = timedelta(days=REMEMBER_DAYS) if remember else timedelta(hours=SESSION_HOURS)
    expires_at = datetime.now() + duration
    users_repo.insert_session(_token_hash(token), username, expires_at)
    return token, expires_at


def validate_session(token: str) -> dict | None:
    if not token:
        return None
    row = users_repo.get_session(_token_hash(token))
    if not row:
        return None
    try:
        if datetime.fromisoformat(row["expires_at"]) < datetime.now():
            users_repo.delete_session(_token_hash(token))
            return None
    except Exception:
        return None
    user = users_repo.get_user(row["username"])
    if not user or not user["is_active"]:
        return None
    return _public(user)


def destroy_session(token: str):
    if token:
        users_repo.delete_session(_token_hash(token))


# ---- Account management -----------------------------------------------------
def create_user(actor: dict, username: str, password: str, full_name: str, role: str,
                email: str = "") -> tuple[bool, str]:
    username = (username or "").strip()
    if not username or not password:
        return False, "fields_required"
    if role not in assignable_roles(actor):
        return False, "role_not_allowed"
    if len(password) < MIN_PASSWORD_LEN:
        return False, "password_too_short"
    if users_repo.get_user(username):
        return False, "user_exists"
    users_repo.insert_user(username, hash_password(password), full_name.strip(), role,
                           (email or "").strip())
    return True, "ok"


def change_password(username: str, old_password: str, new_password: str) -> tuple[bool, str]:
    user = users_repo.get_user(username)
    if not user or not verify_password(old_password, user["password_hash"]):
        return False, "wrong_current"
    if len(new_password) < MIN_PASSWORD_LEN:
        return False, "password_too_short"
    users_repo.update_password(username, hash_password(new_password))
    return True, "ok"


def set_user_role(actor: dict, username: str, role: str) -> tuple[bool, str]:
    # Defense-in-depth (don't rely on UI gating): the NEW role must be grantable by
    # the actor, the TARGET must be within the actor's scope, and the last active
    # super-admin can never be demoted out of super_admin.
    if role not in assignable_roles(actor):
        return False, "role_not_allowed"
    if not _can_manage(actor, username):
        return False, "role_not_allowed"
    if is_last_active_super_admin(username) and role != "super_admin":
        return False, "last_super_admin"
    users_repo.update_role(username, role)
    return True, "ok"


def set_user_active(actor: dict, username: str, active: bool) -> tuple[bool, str]:
    # Same guards as role changes: only act on in-scope targets, and never
    # deactivate the last active super-admin.
    if not _can_manage(actor, username):
        return False, "role_not_allowed"
    if not active and is_last_active_super_admin(username):
        return False, "last_super_admin"
    users_repo.set_active(username, active)
    return True, "ok"


def delete_user(actor: dict, username: str) -> tuple[bool, str]:
    """Permanently delete a CHILD user. Scoped to the actor's grant range
    (so an admin can only delete employer/visitor accounts, not other admins or
    super-admins), never your own account, and never the last super-admin."""
    if username == (actor or {}).get("username"):
        return False, "cannot_delete_self"
    if not _can_manage(actor, username):
        return False, "role_not_allowed"
    if is_last_active_super_admin(username):
        return False, "last_super_admin"
    users_repo.delete_user(username)
    return True, "ok"


def all_users() -> list[dict]:
    return users_repo.list_users()


# ---- Per-user language preference ------------------------------------------
def set_user_lang(username: str, lang: str):
    if lang in LANGUAGES:
        users_repo.update_lang(username, lang)


# ---- Admin-driven account changes ------------------------------------------
def _can_manage(actor: dict, target_username: str) -> bool:
    """An actor may manage a target whose role is within the actor's grant scope."""
    target = users_repo.get_user(target_username)
    return bool(target) and target["role"] in assignable_roles(actor)


def admin_reset_password(actor: dict, username: str, new_password: str) -> tuple[bool, str]:
    if not _can_manage(actor, username):
        return False, "role_not_allowed"
    if not new_password or len(new_password) < MIN_PASSWORD_LEN:
        return False, "password_too_short"
    users_repo.update_password(username, hash_password(new_password))
    return True, "ok"


def change_username(actor: dict, old_username: str, new_username: str) -> tuple[bool, str]:
    new_username = (new_username or "").strip()
    if not _can_manage(actor, old_username):
        return False, "role_not_allowed"
    if not new_username:
        return False, "fields_required"
    if new_username == old_username:
        return True, "ok"
    if users_repo.get_user(new_username):
        return False, "user_exists"
    users_repo.update_username(old_username, new_username)
    return True, "ok"


def set_user_email(username: str, email: str):
    users_repo.update_email(username, email)


def set_user_full_name(username: str, full_name: str):
    users_repo.update_full_name(username, (full_name or "").strip())


def is_last_active_super_admin(username: str) -> bool:
    """True iff this username is an active super_admin AND the only one."""
    active_supers = [u for u in users_repo.list_users()
                     if u["role"] == "super_admin" and u["is_active"]]
    return len(active_supers) == 1 and active_supers[0]["username"] == username


# ---- Password recovery (generate a new password + deliver it) ---------------
def _gen_password(n: int = 10) -> str:
    import secrets
    import string
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(n))


def _deliver_new_password(username: str, new_pw: str, to_email: str) -> tuple[bool, str]:
    from services import email_service
    to = email_service.resolve_recipient(to_email)
    body = (f"A new password has been generated for the Balkan Car Rentals account "
            f"'{username}'.\n\nNew password: {new_pw}\n\n"
            f"Please sign in and change it immediately in Settings → Password.")
    sent, info = email_service.send_mail(to, "Balkan Car Rentals — password reset", body)
    return sent, to


def admin_recover_child(actor: dict, username: str) -> tuple[bool, str, dict]:
    """Admin/super-admin resets a child user's password; the new one is delivered
    to the acting parent's email. Returns (ok, msg, info)."""
    if not _can_manage(actor, username):
        return False, "role_not_allowed", {}
    new_pw = _gen_password()
    users_repo.update_password(username, hash_password(new_pw))
    sent, recipient = _deliver_new_password(username, new_pw, (actor or {}).get("email", ""))
    return True, "ok", {"new_password": new_pw, "sent": sent, "recipient": recipient}


def self_recover(username: str) -> tuple[bool, str, dict]:
    """Login 'forgot password' for Admin / Super-Admin only. Delivers to the
    account's own email (falling back to the owner default)."""
    user = users_repo.get_user((username or "").strip())
    if not user or not user["is_active"]:
        return False, "login_failed", {}
    from config.roles import ROLE_LEVEL
    if ROLE_LEVEL.get(user["role"], 0) < ROLE_LEVEL["admin"]:
        return False, "recover_admin_only", {}
    new_pw = _gen_password()
    users_repo.update_password(user["username"], hash_password(new_pw))
    sent, recipient = _deliver_new_password(user["username"], new_pw, user.get("email", ""))
    return True, "ok", {"new_password": new_pw, "sent": sent, "recipient": recipient}
