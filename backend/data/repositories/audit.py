"""
Audit-log repository.

Append-only trail of who did what. Every privileged mutation (create/cancel/
return a rental, fleet CRUD, user-management changes, cost entries) writes one
row here so an admin can answer "who changed this, and when?". Writes are
best-effort: auditing must never break the action it is recording, so failures
are swallowed.
"""

from sqlalchemy import text
from core.db import get_engine


def record(username: str, action: str, entity: str = "",
           entity_id: str = "", detail: str = "") -> None:
    try:
        with get_engine().begin() as conn:
            conn.execute(text("""
                INSERT INTO audit_log (username, action, entity, entity_id, detail)
                VALUES (:u, :a, :e, :eid, :d)
            """), {"u": username or "?", "a": action, "e": entity,
                   "eid": str(entity_id or ""), "d": detail or ""})
    except Exception:
        # Auditing is non-critical: never let a logging error abort the real work.
        pass


def list_recent(limit: int = 100) -> list[dict]:
    sql = """SELECT id, username, action, entity, entity_id, detail, ts
             FROM audit_log ORDER BY id DESC LIMIT :lim"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql), {"lim": limit}).mappings().all()]
