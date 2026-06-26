"""
Audit service — thin convenience layer over the audit repository.

Pages call `record(user, action, ...)` right after a successful mutation. The
user dict (from auth) carries the username, so call sites don't have to dig it
out themselves.
"""

from data.repositories import audit as audit_repo


def record(user: dict | None, action: str, entity: str = "",
           entity_id: str = "", detail: str = "") -> None:
    username = (user or {}).get("username", "?")
    audit_repo.record(username, action, entity, entity_id, detail)


def recent(limit: int = 100) -> list[dict]:
    return audit_repo.list_recent(limit)
