"""
Vehicle costs repository — the operating-expense ledger.

Mirrors the `charges` table (which records income) but for money the business
*spends* on a vehicle: insurance, maintenance, depreciation, fuel, financing,
registration, or other. Amounts are stored as INTEGER cents and dates as
ISO-8601 text, exactly like the rest of the schema. The Finance page reads these
to turn raw revenue into a real income-vs-cost and net-profit picture.

Deletes are soft (deleted_at timestamp) so a cost entry can be restored from
Settings -> Activity, mirroring the vehicle/rental undo pattern in
data/repositories/vehicles.py. Every read here therefore filters
`deleted_at IS NULL` unless explicitly asked for deleted rows.
"""

from sqlalchemy import text
from core.db import get_engine

COST_TYPES = ["insurance", "maintenance", "depreciation", "fuel",
              "financing", "registration", "other"]

_LIVE = "c.deleted_at IS NULL"


def add_cost(vehicle_id: str, cost_type: str, amount_cents: int,
             period_date: str, note: str = "") -> None:
    if cost_type not in COST_TYPES:
        cost_type = "other"
    with get_engine().begin() as conn:
        conn.execute(text("""
            INSERT INTO vehicle_costs (vehicle_id, type, amount, period_date, note)
            VALUES (:v, :t, :a, :d, :n)
        """), {"v": vehicle_id, "t": cost_type, "a": int(amount_cents),
               "d": period_date, "n": note or ""})


def list_costs(limit: int = 200) -> list[dict]:
    sql = f"""SELECT c.cost_id, c.vehicle_id, v.make_model, v.license_plate, v.year,
                    c.type, c.amount, c.period_date, c.note
             FROM vehicle_costs c
             LEFT JOIN vehicles v ON v.vehicle_id = c.vehicle_id
             WHERE {_LIVE}
             ORDER BY c.period_date DESC, c.cost_id DESC
             LIMIT :lim"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql), {"lim": limit}).mappings().all()]


def list_deleted_costs() -> list[dict]:
    """Soft-deleted rows, for the Settings -> Activity 'returnable' list."""
    sql = """SELECT c.cost_id, c.vehicle_id, v.make_model, c.type, c.amount, c.period_date
             FROM vehicle_costs c
             LEFT JOIN vehicles v ON v.vehicle_id = c.vehicle_id
             WHERE c.deleted_at IS NOT NULL
             ORDER BY c.deleted_at DESC"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]


def get_cost(cost_id: int) -> dict | None:
    with get_engine().connect() as conn:
        row = conn.execute(
            text("SELECT * FROM vehicle_costs WHERE cost_id = :c"), {"c": cost_id}
        ).mappings().first()
    return dict(row) if row else None


def update_cost(cost_id: int, vehicle_id: str, cost_type: str, amount_cents: int,
                period_date: str, note: str = "") -> None:
    if cost_type not in COST_TYPES:
        cost_type = "other"
    with get_engine().begin() as conn:
        conn.execute(text("""
            UPDATE vehicle_costs
            SET vehicle_id = :v, type = :t, amount = :a, period_date = :d, note = :n
            WHERE cost_id = :c
        """), {"v": vehicle_id, "t": cost_type, "a": int(amount_cents),
               "d": period_date, "n": note or "", "c": cost_id})


def delete_cost(cost_id: int) -> None:
    """Soft-delete: stamps deleted_at rather than removing the row, so it can
    be restored later from Settings -> Activity."""
    with get_engine().begin() as conn:
        conn.execute(text(
            "UPDATE vehicle_costs SET deleted_at = datetime('now') WHERE cost_id = :c"
        ), {"c": cost_id})


def restore_cost(cost_id: int) -> None:
    with get_engine().begin() as conn:
        conn.execute(text(
            "UPDATE vehicle_costs SET deleted_at = NULL WHERE cost_id = :c"
        ), {"c": cost_id})


def cost_total() -> int:
    with get_engine().connect() as conn:
        return conn.execute(
            text("SELECT COALESCE(SUM(amount), 0) FROM vehicle_costs WHERE deleted_at IS NULL")
        ).scalar_one()


def cost_by_type() -> list[dict]:
    sql = """SELECT type, COALESCE(SUM(amount), 0) AS amount
             FROM vehicle_costs WHERE deleted_at IS NULL
             GROUP BY type ORDER BY amount DESC"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]


def cost_by_month() -> list[dict]:
    sql = """SELECT strftime('%Y-%m', period_date) AS month,
                    COALESCE(SUM(amount), 0) AS cost
             FROM vehicle_costs WHERE deleted_at IS NULL
             GROUP BY month ORDER BY month"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]


def cost_by_year() -> list[dict]:
    sql = """SELECT strftime('%Y', period_date) AS year,
                    COALESCE(SUM(amount), 0) AS cost
             FROM vehicle_costs WHERE deleted_at IS NULL
             GROUP BY year ORDER BY year"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]


def cost_by_type_for_month(month: str) -> list[dict]:
    """Cost grouped by type for a single calendar month ('YYYY-MM')."""
    sql = """SELECT type, COALESCE(SUM(amount), 0) AS amount
             FROM vehicle_costs
             WHERE deleted_at IS NULL AND strftime('%Y-%m', period_date) = :m
             GROUP BY type ORDER BY amount DESC"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql), {"m": month}).mappings().all()]


def cost_by_vehicle() -> list[dict]:
    sql = """SELECT c.vehicle_id, v.make_model,
                    COALESCE(SUM(c.amount), 0) AS cost
             FROM vehicle_costs c
             LEFT JOIN vehicles v ON v.vehicle_id = c.vehicle_id
             WHERE c.deleted_at IS NULL
             GROUP BY c.vehicle_id, v.make_model"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]
