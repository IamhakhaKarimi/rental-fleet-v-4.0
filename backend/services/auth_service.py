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
  - Repeated failed logins lock an account for a cooling-off period, so a weak
    password can't simply be guessed at full speed.
  - "Forgot password" issues a single-use, short-lived, emailed link. Requesting
    one does NOT change the password, so the endpoint cannot be used to lock
    someone out, and it answers identically whether or not the account exists so
    it cannot be used to enumerate usernames.
"""

import hashlib
import secrets
import string
from datetime import datetime, timedelta

from config.settings import LANGUAGES

import bcrypt

from api.settings import settings
from config.roles import assignable_roles, ROLES
from data.repositories import users as users_repo

# Kept as a module constant for callers that display the rule; the authoritative
# value is settings.password_min_length (env PASSWORD_MIN_LENGTH).
MIN_PASSWORD_LEN = settings.password_min_length
REMEMBER_DAYS = 30
SESSION_HOURS = 12

DEFAULT_ADMIN_USERNAME = "admin"
DEFAULT_ADMIN_PASSWORD = "admin"   # change immediately in Settings

# Rejected outright regardless of length rules — these are the first guesses any
# credential-stuffing list makes.
_COMMON_PASSWORDS = {
    "password", "passw0rd", "password1", "password123", "123456", "1234567",
    "12345678", "123456789", "1234567890", "qwerty", "qwerty123", "abc123",
    "letmein", "welcome", "admin", "admin123", "administrator", "iloveyou",
    "monkey", "dragon", "sunshine", "princess", "football", "baseball",
    "master", "login", "starwars", "changeme", "secret", "trustno1",
}


# ---- Password hashing -------------------------------------------------------
def hash_password(password: str) -> str:
    # bcrypt truncates silently at 72 BYTES; encode first so the check is on the
    # real length (a Turkish 'ş' is 2 bytes) and a long passphrase is rejected
    # rather than quietly having its tail ignored.
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], stored_hash.encode("utf-8"))
    except Exception:
        return False


# ---- Password policy --------------------------------------------------------
def validate_password(password: str, username: str = "") -> tuple[bool, str]:
    """Central strength gate for EVERY path that sets a password (self-service
    change, admin reset, account creation, reset-link redemption). Returns
    (ok, i18n_key). Rules: at least settings.password_min_length characters, at
    least three of the four character classes, not a well-known password, and not
    built out of the username."""
    pw = password or ""
    if len(pw) < settings.password_min_length:
        return False, "password_too_short"
    if len(pw.encode("utf-8")) > 72:
        return False, "password_too_long"
    classes = sum([
        any(c.islower() for c in pw),
        any(c.isupper() for c in pw),
        any(c.isdigit() for c in pw),
        any(not c.isalnum() for c in pw),
    ])
    if classes < 3:
        return False, "password_too_simple"
    folded = pw.lower()
    if folded in _COMMON_PASSWORDS:
        return False, "password_too_common"
    # Strip digits/punctuation before comparing to the username, so "admin2024!"
    # is still caught as a username-derived password.
    core = "".join(c for c in folded if c.isalpha())
    uname = (username or "").strip().lower()
    if uname and len(uname) >= 3 and core and (uname in folded or core in uname):
        return False, "password_contains_username"
    return True, "ok"


def password_policy() -> dict:
    """The rules, for display on the reset / change-password screens."""
    return {
        "min_length": settings.password_min_length,
        "min_classes": 3,
        "classes": ["lowercase", "uppercase", "digit", "symbol"],
    }


# ---- Failed-login throttling ------------------------------------------------
def _parse_dt(value) -> datetime | None:
    try:
        return datetime.fromisoformat(str(value))
    except Exception:
        return None


def lockout_remaining(username: str) -> int:
    """Seconds left on an account's lockout, 0 when not locked."""
    row = users_repo.get_login_attempt((username or "").strip())
    if not row or not row.get("locked_until"):
        return 0
    until = _parse_dt(row["locked_until"])
    if not until:
        return 0
    remaining = (until - datetime.now()).total_seconds()
    return int(remaining) if remaining > 0 else 0


def register_login_failure(username: str) -> int:
    """Count a failed attempt and lock the account once the threshold is hit.
    Returns the seconds of lockout now in force (0 if still under the threshold)."""
    username = (username or "").strip()
    row = users_repo.get_login_attempt(username)
    fails = (row or {}).get("fails", 0) + 1
    locked_until = None
    if fails >= settings.max_login_failures:
        locked_until = datetime.now() + timedelta(minutes=settings.lockout_minutes)
    users_repo.record_login_failure(username, locked_until)
    return int(settings.lockout_minutes * 60) if locked_until else 0


def clear_login_failures(username: str) -> None:
    users_repo.clear_login_failures((username or "").strip())


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
    ok, why = validate_password(password, username)
    if not ok:
        return False, why
    if users_repo.get_user(username):
        return False, "user_exists"
    users_repo.insert_user(username, hash_password(password), full_name.strip(), role,
                           (email or "").strip())
    return True, "ok"


def change_password(username: str, old_password: str, new_password: str) -> tuple[bool, str]:
    user = users_repo.get_user(username)
    if not user or not verify_password(old_password, user["password_hash"]):
        return False, "wrong_current"
    ok, why = validate_password(new_password, username)
    if not ok:
        return False, why
    if verify_password(new_password, user["password_hash"]):
        return False, "password_reused"
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
    ok, why = validate_password(new_password, username)
    if not ok:
        return False, why
    users_repo.update_password(username, hash_password(new_password))
    # A password the admin chose is known to someone other than the account
    # holder, so any lockout is cleared and existing sessions are already dropped
    # by update_password.
    clear_login_failures(username)
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


# ---- Password reset by emailed link -----------------------------------------
# The old flow reset the password the moment someone typed a username into the
# login screen and, when SMTP was unconfigured, returned the new password in the
# HTTP response — an unauthenticated takeover of any account whose username was
# guessable. This flow instead mints a single-use token, mails a link, and leaves
# the password untouched until the recipient proves they read the mailbox.
def _gen_password(n: int = 14) -> str:
    """A temporary password that satisfies validate_password by construction —
    used for admin-issued recovery when the colleague has no email on file."""
    while True:
        pw = "".join(secrets.choice(string.ascii_letters + string.digits + "!@#$%^&*")
                     for _ in range(n))
        if validate_password(pw)[0]:
            return pw


def _token_digest(token: str) -> str:
    return hashlib.sha256((token or "").encode("utf-8")).hexdigest()


def _reset_link(token: str) -> str:
    return f"{settings.frontend_base_url}/reset-password?token={token}"


def request_password_reset(identifier: str, request_ip: str = "") -> dict:
    """Begin a reset for a username OR an email address.

    Always returns the same shape, and the caller must always answer the client
    identically: whether the account exists, is active, or has an email on file is
    not disclosed. `debug_link` is populated ONLY when SMTP is unconfigured, and
    the router restricts it to loopback callers so it can't leak in a deployment.
    """
    users_repo.purge_expired_password_resets()
    identifier = (identifier or "").strip()
    result = {"issued": False, "sent": False, "debug_link": "", "recipient": ""}
    if not identifier:
        return result

    user = users_repo.get_user(identifier) or users_repo.get_user_by_email(identifier)
    if not user or not user["is_active"]:
        return result
    email = (user.get("email") or "").strip()
    if not email:
        # Nothing to send to. Deliberately silent: telling the caller "that
        # account has no email" would confirm the account exists.
        return result

    # Rate limit per account so the endpoint can't be used to flood an inbox.
    since = datetime.now() - timedelta(hours=1)
    if users_repo.count_recent_password_resets(user["username"], since) >= settings.reset_max_per_hour:
        return result

    token = secrets.token_urlsafe(32)
    expires = datetime.now() + timedelta(minutes=settings.reset_token_ttl_minutes)
    users_repo.insert_password_reset(_token_digest(token), user["username"], expires, request_ip)

    from services import email_service
    sent, info = email_service.send_password_reset(
        email, user["username"], _reset_link(token), settings.reset_token_ttl_minutes
    )
    result.update(issued=True, sent=sent, recipient=email)
    if not sent:
        result["debug_link"] = _reset_link(token)
    return result


def peek_reset_token(token: str) -> bool:
    """Is this reset token currently redeemable? Drives the reset page's 'this
    link has expired' state before the user types a new password."""
    row = users_repo.get_password_reset(_token_digest(token))
    if not row or row.get("used_at"):
        return False
    expires = _parse_dt(row["expires_at"])
    return bool(expires and expires >= datetime.now())


def reset_password_with_token(token: str, new_password: str) -> tuple[bool, str]:
    """Redeem a reset link. Validates the token, applies the password policy, then
    consumes the token BEFORE writing the new password so a replayed request can't
    set the password twice."""
    digest = _token_digest(token)
    row = users_repo.get_password_reset(digest)
    if not row or row.get("used_at"):
        return False, "reset_token_invalid"
    expires = _parse_dt(row["expires_at"])
    if not expires or expires < datetime.now():
        return False, "reset_token_expired"

    user = users_repo.get_user(row["username"])
    if not user or not user["is_active"]:
        return False, "reset_token_invalid"

    ok, why = validate_password(new_password, user["username"])
    if not ok:
        return False, why

    if not users_repo.consume_password_reset(digest):
        return False, "reset_token_invalid"   # lost the race to a concurrent redeem

    # update_password stamps password_changed_at and drops session rows, which
    # invalidates every previously issued token for this account.
    users_repo.update_password(user["username"], hash_password(new_password))
    clear_login_failures(user["username"])
    return True, user["username"]


def admin_recover_child(actor: dict, username: str) -> tuple[bool, str, dict]:
    """Admin/super-admin recovery for a colleague. Prefers mailing that user a
    reset link; only when they have no address on file does it fall back to a
    generated temporary password handed to the acting admin to pass on."""
    if not _can_manage(actor, username):
        return False, "role_not_allowed", {}
    target = users_repo.get_user(username)
    if not target:
        return False, "role_not_allowed", {}

    email = (target.get("email") or "").strip()
    if email:
        info = request_password_reset(username)
        return True, "ok", {"method": "link", "sent": info["sent"],
                            "recipient": info["recipient"],
                            "reset_link": info["debug_link"], "new_password": ""}

    new_pw = _gen_password()
    users_repo.update_password(username, hash_password(new_pw))
    clear_login_failures(username)
    return True, "ok", {"method": "temp_password", "sent": False, "recipient": "",
                        "reset_link": "", "new_password": new_pw}
