"""
Users and sessions repository — all SQL touching accounts and login sessions.
Passwords arrive here already hashed (by auth_service); this layer never hashes.
"""

from datetime import datetime
from sqlalchemy import text
from core.db import get_engine


# ---- Users ------------------------------------------------------------------
def get_user(username: str) -> dict | None:
    with get_engine().connect() as conn:
        row = conn.execute(
            text("""SELECT user_id, username, password_hash, full_name, role,
                           is_active, lang, email
                    FROM users WHERE username = :u"""),
            {"u": username},
        ).mappings().first()
    return dict(row) if row else None


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
    with get_engine().begin() as conn:
        conn.execute(
            text("UPDATE users SET password_hash = :p WHERE username = :u"),
            {"p": password_hash, "u": username},
        )


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
