"""
Users and sessions repository — all SQL touching accounts and login sessions.
Passwords arrive here already hashed (by auth_service); this layer never hashes.
"""

from datetime import datetime, timezone
from sqlalchemy import text
from core.db import get_engine


# ---- Users ------------------------------------------------------------------
def get_user(username: str) -> dict | None:
    with get_engine().connect() as conn:
        row = conn.execute(
            text("""SELECT user_id, username, password_hash, full_name, role,
                           is_active, lang, email, password_changed_at
                    FROM users WHERE username = :u"""),
            {"u": username},
        ).mappings().first()
    return dict(row) if row else None


def get_user_by_email(email: str) -> dict | None:
    """Case-insensitive lookup so 'forgot password' accepts the address as typed.
    Returns None when the address is blank or matches more than one account —
    an ambiguous match must not leak which one was meant."""
    email = (email or "").strip()
    if not email:
        return None
    with get_engine().connect() as conn:
        rows = conn.execute(
            text("""SELECT user_id, username, password_hash, full_name, role,
                           is_active, lang, email, password_changed_at
                    FROM users WHERE LOWER(email) = LOWER(:e)"""),
            {"e": email},
        ).mappings().all()
    return dict(rows[0]) if len(rows) == 1 else None


def list_users() -> list[dict]:
    with get_engine().connect() as conn:
        rows = conn.execute(
            text("""SELECT username, full_name, role, is_active, email, created_at
                    FROM users ORDER BY role, username""")
        ).mappings().all()
    return [dict(r) for r in rows]


def count_users() -> int:
    with get_engine().connect() as conn:
        return conn.execute(text("SELECT COUNT(*) FROM users")).scalar_one()


def insert_user(username: str, password_hash: str, full_name: str, role: str, email: str = ""):
    with get_engine().begin() as conn:
        conn.execute(
            text("""INSERT INTO users (username, password_hash, full_name, role, is_active, email)
                    VALUES (:u, :p, :f, :r, 1, :e)"""),
            {"u": username, "p": password_hash, "f": full_name, "r": role, "e": email or ""},
        )


def update_full_name(username: str, full_name: str):
    with get_engine().begin() as conn:
        conn.execute(text("UPDATE users SET full_name = :n WHERE username = :u"),
                     {"n": full_name, "u": username})


def update_email(username: str, email: str):
    with get_engine().begin() as conn:
        conn.execute(text("UPDATE users SET email = :e WHERE username = :u"),
                     {"e": (email or "").strip(), "u": username})


def update_password(username: str, password_hash: str):
    """Set the hash and stamp password_changed_at, then drop every session row for
    the user. The stamp is what invalidates already-issued JWTs (api/deps compares
    the token's issue time against it), so a reset really does end other sessions.

    Stamped in UTC — unlike the local-time columns elsewhere in this table — because
    it is compared against a JWT's `iat`, which is UTC. Mixing the two would make
    every freshly issued token look older than the stamp in any non-UTC timezone
    and lock the account out of its own app."""
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    with get_engine().begin() as conn:
        conn.execute(
            text("""UPDATE users SET password_hash = :p, password_changed_at = :t
                    WHERE username = :u"""),
            {"p": password_hash, "t": now, "u": username},
        )
        conn.execute(text("DELETE FROM sessions WHERE username = :u"), {"u": username})


def update_role(username: str, role: str):
    with get_engine().begin() as conn:
        conn.execute(text("UPDATE users SET role = :r WHERE username = :u"),
                     {"r": role, "u": username})


def update_lang(username: str, lang: str):
    with get_engine().begin() as conn:
        conn.execute(text("UPDATE users SET lang = :l WHERE username = :u"),
                     {"l": lang, "u": username})


def update_username(old_username: str, new_username: str):
    """Rename a user; sessions for the old name are dropped so they re-login."""
    with get_engine().begin() as conn:
        conn.execute(text("UPDATE users SET username = :n WHERE username = :o"),
                     {"n": new_username, "o": old_username})
        conn.execute(text("DELETE FROM sessions WHERE username = :o"), {"o": old_username})


def set_active(username: str, active: bool):
    with get_engine().begin() as conn:
        conn.execute(text("UPDATE users SET is_active = :a WHERE username = :u"),
                     {"a": 1 if active else 0, "u": username})


def delete_user(username: str):
    """Hard-delete an account and drop its sessions (so it can't be reused)."""
    with get_engine().begin() as conn:
        conn.execute(text("DELETE FROM sessions WHERE username = :u"), {"u": username})
        conn.execute(text("DELETE FROM users WHERE username = :u"), {"u": username})


# ---- Sessions ---------------------------------------------------------------
def insert_session(token_hash: str, username: str, expires_at: datetime):
    with get_engine().begin() as conn:
        conn.execute(
            text("""INSERT INTO sessions (token_hash, username, expires_at)
                    VALUES (:t, :u, :e)
                    ON CONFLICT (token_hash) DO UPDATE
                      SET username = excluded.username,
                          expires_at = excluded.expires_at"""),
            {"t": token_hash, "u": username, "e": expires_at.strftime("%Y-%m-%dT%H:%M:%S")},
        )


def get_session(token_hash: str) -> dict | None:
    with get_engine().connect() as conn:
        row = conn.execute(
            text("SELECT username, expires_at FROM sessions WHERE token_hash = :t"),
            {"t": token_hash},
        ).mappings().first()
    return dict(row) if row else None


def delete_session(token_hash: str):
    with get_engine().begin() as conn:
        conn.execute(text("DELETE FROM sessions WHERE token_hash = :t"), {"t": token_hash})


def purge_expired_sessions():
    now = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    with get_engine().begin() as conn:
        conn.execute(text("DELETE FROM sessions WHERE expires_at < :now"), {"now": now})


def delete_sessions_for_user(username: str):
    with get_engine().begin() as conn:
        conn.execute(text("DELETE FROM sessions WHERE username = :u"), {"u": username})


# ---- Password-reset tickets -------------------------------------------------
def insert_password_reset(token_hash: str, username: str, expires_at: datetime,
                          requested_ip: str = ""):
    """Store a new reset ticket, invalidating any earlier unused ones for the same
    user — requesting a second link must make the first one dead."""
    with get_engine().begin() as conn:
        conn.execute(
            text("DELETE FROM password_resets WHERE username = :u AND used_at IS NULL"),
            {"u": username},
        )
        conn.execute(
            text("""INSERT INTO password_resets (token_hash, username, expires_at, requested_ip)
                    VALUES (:t, :u, :e, :ip)"""),
            {"t": token_hash, "u": username,
             "e": expires_at.strftime("%Y-%m-%dT%H:%M:%S"), "ip": requested_ip or ""},
        )


def get_password_reset(token_hash: str) -> dict | None:
    with get_engine().connect() as conn:
        row = conn.execute(
            text("""SELECT token_hash, username, expires_at, used_at
                    FROM password_resets WHERE token_hash = :t"""),
            {"t": token_hash},
        ).mappings().first()
    return dict(row) if row else None


def consume_password_reset(token_hash: str) -> bool:
    """Mark a ticket used. The UPDATE is conditional on it still being unused, and
    rowcount tells us whether we won — so two simultaneous redemptions of the same
    link can't both succeed."""
    now = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    with get_engine().begin() as conn:
        res = conn.execute(
            text("""UPDATE password_resets SET used_at = :n
                    WHERE token_hash = :t AND used_at IS NULL"""),
            {"n": now, "t": token_hash},
        )
    return (res.rowcount or 0) > 0


def count_recent_password_resets(username: str, since: datetime) -> int:
    """How many tickets this account has been issued since `since` — the rate limit
    that stops the reset endpoint being used to spam someone's inbox."""
    with get_engine().connect() as conn:
        return conn.execute(
            text("""SELECT COUNT(*) FROM password_resets
                    WHERE username = :u AND created_at >= :s"""),
            {"u": username, "s": since.strftime("%Y-%m-%dT%H:%M:%S")},
        ).scalar_one()


def purge_expired_password_resets():
    now = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    with get_engine().begin() as conn:
        conn.execute(text("DELETE FROM password_resets WHERE expires_at < :now"), {"now": now})


# ---- Failed-login throttling ------------------------------------------------
def get_login_attempt(username: str) -> dict | None:
    with get_engine().connect() as conn:
        row = conn.execute(
            text("SELECT username, fails, locked_until FROM login_attempts WHERE username = :u"),
            {"u": username},
        ).mappings().first()
    return dict(row) if row else None


def record_login_failure(username: str, locked_until: datetime | None) -> None:
    now = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    lock = locked_until.strftime("%Y-%m-%dT%H:%M:%S") if locked_until else None
    with get_engine().begin() as conn:
        conn.execute(
            text("""INSERT INTO login_attempts (username, fails, locked_until, last_try)
                    VALUES (:u, 1, :l, :n)
                    ON CONFLICT (username) DO UPDATE
                      SET fails = login_attempts.fails + 1,
                          locked_until = :l,
                          last_try = :n"""),
            {"u": username, "l": lock, "n": now},
        )


def clear_login_failures(username: str) -> None:
    with get_engine().begin() as conn:
        conn.execute(text("DELETE FROM login_attempts WHERE username = :u"), {"u": username})
