"""
Users and sessions repository — all SQL touching accounts and login sessions.
Passwords arrive here already hashed (by auth_service); this layer never hashes.
"""

from datetime import datetime, timedelta, timezone
from sqlalchemy import text
from core.db import db_read, get_engine


# ---- Users ------------------------------------------------------------------
def get_user(username: str) -> dict | None:
    with db_read() as conn:
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
    with db_read() as conn:
        rows = conn.execute(
            text("""SELECT user_id, username, password_hash, full_name, role,
                           is_active, lang, email, password_changed_at
                    FROM users WHERE LOWER(email) = LOWER(:e)"""),
            {"e": email},
        ).mappings().all()
    return dict(rows[0]) if len(rows) == 1 else None


def list_users() -> list[dict]:
    with db_read() as conn:
        rows = conn.execute(
            text("""SELECT username, full_name, role, is_active, email, created_at
                    FROM users ORDER BY role, username""")
        ).mappings().all()
    return [dict(r) for r in rows]


def count_users() -> int:
    with db_read() as conn:
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


def get_user_with_session(username: str, jti: str) -> dict | None:
    """One joined query: the live user row, but only if ``jti`` is still a
    registered, unexpired session for that user. Used by the per-request auth
    dependency so revocation checking costs no extra round-trip beyond the
    existing user re-read."""
    with db_read() as conn:
        row = conn.execute(
            text("""SELECT u.user_id, u.username, u.full_name, u.role, u.is_active,
                           u.lang, u.email, u.password_changed_at
                    FROM users u
                    JOIN sessions s ON s.username = u.username
                    WHERE u.username = :u AND s.token_hash = :j
                          AND s.expires_at > :now"""),
            {"u": username, "j": jti, "now": datetime.now().strftime("%Y-%m-%dT%H:%M:%S")},
        ).mappings().first()
    return dict(row) if row else None


def get_session(token_hash: str) -> dict | None:
    with db_read() as conn:
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
    with db_read() as conn:
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
    with db_read() as conn:
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
    with db_read() as conn:
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


# ---- Failed-login throttling, per (username, ip) — the real lockout ---------
def get_login_attempt_ip(username: str, ip: str) -> dict | None:
    with db_read() as conn:
        row = conn.execute(
            text("""SELECT username, ip, fails, locked_until FROM login_attempts_ip
                    WHERE username = :u AND ip = :i"""),
            {"u": username, "i": ip},
        ).mappings().first()
    return dict(row) if row else None


def record_login_failure_ip(username: str, ip: str, locked_until: datetime | None) -> None:
    now = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    lock = locked_until.strftime("%Y-%m-%dT%H:%M:%S") if locked_until else None
    with get_engine().begin() as conn:
        conn.execute(
            text("""INSERT INTO login_attempts_ip (username, ip, fails, locked_until, last_try)
                    VALUES (:u, :i, 1, :l, :n)
                    ON CONFLICT (username, ip) DO UPDATE
                      SET fails = login_attempts_ip.fails + 1,
                          locked_until = :l,
                          last_try = :n"""),
            {"u": username, "i": ip, "l": lock, "n": now},
        )


def clear_login_failures_ip(username: str, ip: str) -> None:
    with get_engine().begin() as conn:
        conn.execute(
            text("DELETE FROM login_attempts_ip WHERE username = :u AND ip = :i"),
            {"u": username, "i": ip},
        )


def purge_stale_login_attempts_ip(older_than_hours: int = 24) -> None:
    """Bound the table's growth: an unauthenticated caller can write a row for
    any username/ip pair it likes, so rows must age out regardless of whether
    they ever reached a lock."""
    cutoff = (datetime.now() - timedelta(hours=older_than_hours)).strftime("%Y-%m-%dT%H:%M:%S")
    with get_engine().begin() as conn:
        conn.execute(text("DELETE FROM login_attempts_ip WHERE last_try < :c"), {"c": cutoff})
