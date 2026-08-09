"""
Vehicle photos repository — multiple photos per vehicle.

Photos are stored as base64 JPEGs (one standard size, cropped on upload) in their
own table so the vehicles listing stays light. Callers load the *primary* photo
for thumbnails/cards and the full gallery only on demand.
"""

from sqlalchemy import bindparam, text
from core.db import db_read, get_engine


def photo_count(vehicle_id: str) -> int:
    with db_read() as conn:
        return conn.execute(
            text("SELECT COUNT(*) FROM vehicle_photos WHERE vehicle_id = :v"),
            {"v": vehicle_id},
        ).scalar_one()


def photos_version(vehicle_id: str) -> int:
    """Monotonic-ish cache key: max photo_id (changes whenever photos change)."""
    with db_read() as conn:
        return conn.execute(
            text("SELECT COALESCE(MAX(photo_id), 0) FROM vehicle_photos WHERE vehicle_id = :v"),
            {"v": vehicle_id},
        ).scalar_one()


def primary_photo(vehicle_id: str) -> str | None:
    with db_read() as conn:
        row = conn.execute(
            text("""SELECT photo FROM vehicle_photos WHERE vehicle_id = :v
                    ORDER BY position, photo_id LIMIT 1"""),
            {"v": vehicle_id},
        ).first()
    return row[0] if row else None


def primary_photos_for(vehicle_ids: list[str]) -> dict[str, str | None]:
    """Batched primary-photo lookup — one query for N vehicles instead of N,
    closing the N+1 the Fleet/Dashboard pages used to cause (one thumb request
    per visible card; see DOCUMENTATION.md §8.2 M6). Window function picks the
    same "first by position, then photo_id" tie-break as primary_photo()."""
    ids = [v for v in (vehicle_ids or []) if v]
    if not ids:
        return {}
    stmt = text("""
        WITH ranked AS (
            SELECT vehicle_id, photo,
                   ROW_NUMBER() OVER (PARTITION BY vehicle_id ORDER BY position, photo_id) AS rn
            FROM vehicle_photos
            WHERE vehicle_id IN :ids
        )
        SELECT vehicle_id, photo FROM ranked WHERE rn = 1
    """).bindparams(bindparam("ids", expanding=True))
    with db_read() as conn:
        rows = conn.execute(stmt, {"ids": ids}).all()
    found = {r[0]: r[1] for r in rows}
    return {vid: found.get(vid) for vid in ids}


def list_photos(vehicle_id: str) -> list[dict]:
    with db_read() as conn:
        return [dict(r) for r in conn.execute(
            text("""SELECT photo_id, photo, position FROM vehicle_photos
                    WHERE vehicle_id = :v ORDER BY position, photo_id"""),
            {"v": vehicle_id},
        ).mappings().all()]


def add_photos(vehicle_id: str, photos: list[str]):
    photos = [p for p in (photos or []) if p]
    if not photos:
        return
    with get_engine().begin() as conn:
        start = conn.execute(
            text("SELECT COALESCE(MAX(position), -1) + 1 FROM vehicle_photos WHERE vehicle_id = :v"),
            {"v": vehicle_id},
        ).scalar_one()
        for i, p in enumerate(photos):
            conn.execute(text(
                "INSERT INTO vehicle_photos (vehicle_id, photo, position) VALUES (:v, :p, :pos)"
            ), {"v": vehicle_id, "p": p, "pos": start + i})


def delete_photo(photo_id: int):
    with get_engine().begin() as conn:
        conn.execute(text("DELETE FROM vehicle_photos WHERE photo_id = :p"), {"p": photo_id})


def clear_photos(vehicle_id: str):
    with get_engine().begin() as conn:
        conn.execute(text("DELETE FROM vehicle_photos WHERE vehicle_id = :v"), {"v": vehicle_id})
