"""
One-time vehicle importer.

Reads fleet_master.csv and inserts each row into the vehicles table. It uses
INSERT OR IGNORE keyed on vehicle_id, so running it again never creates
duplicates and never overwrites edits you have made inside the app.

Called automatically by core.db.init_db() the first time the database is
created. You can also run it by hand to top-up new rows:

    python -m data.seed.import_csv
"""

import pandas as pd
from sqlalchemy import text
from sqlalchemy.engine import Engine

from config.settings import SEED_CSV


# CSV header -> internal handling. Rates/charges are converted to integer cents.
def _to_cents(value, default=0) -> int:
    try:
        if pd.isna(value):
            return default
        clean = str(value).replace("€", "").replace("$", "").replace(",", "").strip()
        return int(round(float(clean) * 100))
    except Exception:
        return default


def _to_int(value, default=0) -> int:
    try:
        if pd.isna(value):
            return default
        return int(float(str(value).strip()))
    except Exception:
        return default


def _to_str(value) -> str:
    if pd.isna(value):
        return ""
    return str(value).strip()


def seed_vehicles_from_csv(engine: Engine):
    df = pd.read_csv(SEED_CSV).dropna(how="all")

    rows = []
    for _, r in df.iterrows():
        vid = _to_str(r.get("Car ID"))
        if not vid:
            continue
        status = _to_str(r.get("Status")) or "Available"
        if status not in ("Available", "Rented", "In Garage", "Maintenance", "DELETED"):
            status = "Available"
        rows.append({
            "vehicle_id": vid,
            "make_model": _to_str(r.get("Make/Model")),
            "year": _to_int(r.get("Year"), None),
            "license_plate": _to_str(r.get("License Plate")),
            "color": _to_str(r.get("Color")),
            "mileage": _to_int(r.get("Current Mileage"), 0),
            "status": status,
            # Currency is the euro; accept the legacy "($)" header too so older
            # CSV exports still import cleanly.
            "base_daily_rate": _to_cents(
                r.get("Base Daily Rate (€)", r.get("Base Daily Rate ($)")), 0),
            "maintenance_charge": _to_cents(r.get("Client Maintenance Charge"), 0),
            "notes": _to_str(r.get("Notes")),
        })

    insert_sql = text("""
        INSERT INTO vehicles
            (vehicle_id, make_model, year, license_plate, color, mileage,
             status, base_daily_rate, maintenance_charge, notes)
        VALUES
            (:vehicle_id, :make_model, :year, :license_plate, :color, :mileage,
             :status, :base_daily_rate, :maintenance_charge, :notes)
        ON CONFLICT (vehicle_id) DO NOTHING
    """)
    with engine.begin() as conn:
        for row in rows:
            conn.execute(insert_sql, row)
    return len(rows)


if __name__ == "__main__":
    from core.db import get_engine, init_db
    init_db()  # ensures schema exists, then seeds
    print(f"Seed complete from {SEED_CSV}")
