"""
Vehicle costs repository — the operating-expense ledger.

Mirrors the `charges` table (which records income) but for money the business
*spends* on a vehicle: insurance, maintenance, depreciation, fuel, financing,
registration, or other. Amounts are stored as INTEGER cents and dates as
ISO-8601 text, exactly like the rest of the schema. The Finance page reads these
to turn raw revenue into a real income-vs-cost and net-profit picture.
"""

from sqlalchemy import text
from core.db import get_engine

COST_TYPES = ["insurance", "maintenance", "depreciation", "fuel",
              "financing", "registration", "other"]


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
    sql = """SELECT c.cost_id, c.vehicle_id, v.make_model, v.license_plate, v.year,
                    c.type, c.amount, c.period_date, c.note
             FROM vehicle_costs c
             LEFT JOIN vehicles v ON v.vehicle_id = c.vehicle_id
             ORDER BY c.period_date DESC, c.cost_id DESC
             LIMIT :lim"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql), {"lim": limit}).mappings().all()]


def delete_cost(cost_id: int) -> None:
    with get_engine().begin() as conn:
        conn.execute(text("DELETE FROM vehicle_costs WHERE cost_id = :c"), {"c": cost_id})


def cost_total() -> int:
    with get_engine().connect() as conn:
        return conn.execute(
            text("SELECT COALESCE(SUM(amount), 0) FROM vehicle_costs")
        ).scalar_one()


def cost_by_type() -> list[dict]:
    sql = """SELECT type, COALESCE(SUM(amount), 0) AS amount
             FROM vehicle_costs GROUP BY type ORDER BY amount DESC"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]


def cost_by_month() -> list[dict]:
    sql = """SELECT strftime('%Y-%m', period_date) AS month,
                    COALESCE(SUM(amount), 0) AS cost
             FROM vehicle_costs GROUP BY month ORDER BY month"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]


def cost_by_year() -> list[dict]:
    sql = """SELECT strftime('%Y', period_date) AS year,
                    COALESCE(SUM(amount), 0) AS cost
             FROM vehicle_costs GROUP BY year ORDER BY year"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]


def cost_by_type_for_month(month: str) -> list[dict]:
    """Cost grouped by type for a single calendar month ('YYYY-MM')."""
    sql = """SELECT type, COALESCE(SUM(amount), 0) AS amount
             FROM vehicle_costs
             WHERE strftime('%Y-%m', period_date) = :m
             GROUP BY type ORDER BY amount DESC"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql), {"m": month}).mappings().all()]


def cost_by_vehicle() -> list[dict]:
    sql = """SELECT c.vehicle_id, v.make_model,
                    COALESCE(SUM(c.amount), 0) AS cost
             FROM vehicle_costs c
             LEFT JOIN vehicles v ON v.vehicle_id = c.vehicle_id
             GROUP BY c.vehicle_id, v.make_model"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]
