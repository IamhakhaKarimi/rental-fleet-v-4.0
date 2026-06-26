"""Vehicles repository — full CRUD including next-ID generation."""
from sqlalchemy import text
from core.db import get_engine


def _next_id() -> str:
    with get_engine().connect() as conn:
        # LIKE 'C%' is cross-dialect (SQLite + Postgres); the tail.isdigit() filter
        # below keeps only C<number> ids, so we don't need SQLite-only GLOB ranges.
        rows = conn.execute(text(
            "SELECT vehicle_id FROM vehicles WHERE vehicle_id LIKE 'C%'"
        )).scalars().all()
    nums = []
    for vid in rows:
        tail = vid[1:]
        if tail.isdigit():
            nums.append(int(tail))
    return f"C{(max(nums) + 1 if nums else 1):03d}"


def list_vehicles(include_deleted: bool = False) -> list[dict]:
    # NOTE: photo data is deliberately NOT selected here — listings must stay light.
    # Thumbnails load lazily via data.repositories.vehicle_photos (see ui/photos.py).
    where = "" if include_deleted else "WHERE status != 'DELETED'"
    sql = f"""SELECT vehicle_id, make_model, year, license_plate, color,
                     mileage, status, base_daily_rate, notes
              FROM vehicles {where} ORDER BY vehicle_id"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]


def get_vehicle(vehicle_id: str) -> dict | None:
    with get_engine().connect() as conn:
        row = conn.execute(
            text("SELECT * FROM vehicles WHERE vehicle_id=:v"), {"v": vehicle_id}
        ).mappings().first()
    return dict(row) if row else None


def fleet_counts() -> dict:
    sql = """SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status='Available' THEN 1 ELSE 0 END) AS available,
                    SUM(CASE WHEN status='Rented'    THEN 1 ELSE 0 END) AS rented,
                    SUM(CASE WHEN status IN ('In Garage','Maintenance') THEN 1 ELSE 0 END) AS garage
             FROM vehicles WHERE status != 'DELETED'"""
    with get_engine().connect() as conn:
        row = conn.execute(text(sql)).mappings().first()
    return {k: (row[k] or 0) for k in ("total", "available", "rented", "garage")}


def add_vehicle(make_model: str, year: int, license_plate: str, color: str,
                mileage: int, status: str, base_daily_rate_cents: int,
                notes: str, photo: str = "") -> str:
    vid = _next_id()
    with get_engine().begin() as conn:
        conn.execute(text("""
            INSERT INTO vehicles
              (vehicle_id, make_model, year, license_plate, color,
               mileage, status, base_daily_rate, notes, photo)
            VALUES (:vid,:mm,:yr,:lp,:col,:mi,:st,:rate,:notes,:photo)
        """), {"vid": vid, "mm": make_model, "yr": year, "lp": license_plate,
               "col": color, "mi": mileage, "st": status,
               "rate": base_daily_rate_cents, "notes": notes, "photo": photo or ""})
    return vid


def update_vehicle(vehicle_id: str, make_model: str, year: int, license_plate: str,
                   color: str, mileage: int, status: str,
                   base_daily_rate_cents: int, notes: str, photo=None):
    """Update a vehicle. If photo is None the existing photo is kept; pass "" to clear."""
    sets = ["make_model=:mm", "year=:yr", "license_plate=:lp", "color=:col",
            "mileage=:mi", "status=:st", "base_daily_rate=:rate", "notes=:notes",
            "updated_at=datetime('now')"]
    params = {"vid": vehicle_id, "mm": make_model, "yr": year, "lp": license_plate,
              "col": color, "mi": mileage, "st": status,
              "rate": base_daily_rate_cents, "notes": notes}
    if photo is not None:
        sets.append("photo=:photo")
        params["photo"] = photo
    with get_engine().begin() as conn:
        conn.execute(text(f"UPDATE vehicles SET {', '.join(sets)} WHERE vehicle_id=:vid"), params)


def set_status(vehicle_id: str, status: str):
    with get_engine().begin() as conn:
        conn.execute(text(
            "UPDATE vehicles SET status=:s, updated_at=datetime('now') WHERE vehicle_id=:v"
        ), {"s": status, "v": vehicle_id})


def soft_delete(vehicle_id: str):
    set_status(vehicle_id, "DELETED")


def restore_vehicle(vehicle_id: str):
    set_status(vehicle_id, "Available")


def hard_delete(vehicle_id: str):
    with get_engine().begin() as conn:
        conn.execute(text("DELETE FROM vehicles WHERE vehicle_id=:v"), {"v": vehicle_id})
