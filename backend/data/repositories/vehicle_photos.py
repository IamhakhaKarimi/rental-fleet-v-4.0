"""
Vehicle photos repository — multiple photos per vehicle.

Photos are stored as base64 JPEGs (one standard size, cropped on upload) in their
own table so the vehicles listing stays light. Callers load the *primary* photo
for thumbnails/cards and the full gallery only on demand.
"""

from sqlalchemy import text
from core.db import get_engine


def photo_count(vehicle_id: str) -> int:
    with get_engine().connect() as conn:
        return conn.execute(
            text("SELECT COUNT(*) FROM vehicle_photos WHERE vehicle_id = :v"),
            {"v": vehicle_id},
        ).scalar_one()


def photos_version(vehicle_id: str) -> int:
    """Monotonic-ish cache key: max photo_id (changes whenever photos change)."""
    with get_engine().connect() as conn:
        return conn.execute(
            text("SELECT COALESCE(MAX(photo_id), 0) FROM vehicle_photos WHERE vehicle_id = :v"),
            {"v": vehicle_id},
        ).scalar_one()


def primary_photo(vehicle_id: str) -> str | None:
    with get_engine().connect() as conn:
        row = conn.execute(
            text("""SELECT photo FROM vehicle_photos WHERE vehicle_id = :v
                    ORDER BY position, photo_id LIMIT 1"""),
            {"v": vehicle_id},
        ).first()
    return row[0] if row else None


def list_photos(vehicle_id: str) -> list[dict]:
    with get_engine().connect() as conn:
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
