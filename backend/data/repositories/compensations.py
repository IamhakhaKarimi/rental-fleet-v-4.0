"""
Damage compensation repository — the client-billed-cost ledger.

Mirrors vehicle_costs.py (the money the business *spends*) but for money the
business *collects back* from a client: damage, a mechanic invoice forwarded
to them, a traffic fine incurred while they had the car, cleaning, a fuel
shortfall, a lost item, etc. Rows live in the `charges` table (same ledger
'rental'/'deposit'/'overdue_penalty' charges use) so they automatically flow
into revenue/P&L totals — COMPENSATION_TYPES is exactly the subset of charge
types this repository manages.
"""

from sqlalchemy import text
from core.db import get_engine

COMPENSATION_TYPES = ["damage", "mechanic_fee", "traffic_fine",
                       "cleaning_fee", "fuel_shortage", "lost_item", "other"]


def add_compensation(vehicle_id: str, comp_type: str, amount_cents: int,
                     period_date: str, note: str = "", deal_id: str | None = None) -> None:
    if comp_type not in COMPENSATION_TYPES:
        comp_type = "other"
    with get_engine().begin() as conn:
        conn.execute(text("""
            INSERT INTO charges (deal_id, vehicle_id, type, amount, occurred_at, note)
            VALUES (:d, :v, :t, :a, :dt, :n)
        """), {"d": deal_id or None, "v": vehicle_id, "t": comp_type, "a": int(amount_cents),
               "dt": period_date, "n": note or ""})


def list_compensations(limit: int = 200) -> list[dict]:
    types = ",".join(f"'{t}'" for t in COMPENSATION_TYPES)
    sql = f"""SELECT c.charge_id, c.vehicle_id, v.make_model, v.license_plate, v.year,
                    c.deal_id, c.type, c.amount, c.occurred_at AS period_date, c.note
             FROM charges c
             LEFT JOIN vehicles v ON v.vehicle_id = c.vehicle_id
             WHERE c.type IN ({types})
             ORDER BY c.occurred_at DESC, c.charge_id DESC
             LIMIT :lim"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql), {"lim": limit}).mappings().all()]


def delete_compensation(charge_id: int) -> None:
    types = ",".join(f"'{t}'" for t in COMPENSATION_TYPES)
    with get_engine().begin() as conn:
        conn.execute(text(
            f"DELETE FROM charges WHERE charge_id = :c AND type IN ({types})"
        ), {"c": charge_id})


def compensation_total() -> int:
    types = ",".join(f"'{t}'" for t in COMPENSATION_TYPES)
    with get_engine().connect() as conn:
        return conn.execute(text(
            f"SELECT COALESCE(SUM(amount), 0) FROM charges WHERE type IN ({types})"
        )).scalar_one()


def compensation_by_type() -> list[dict]:
    types = ",".join(f"'{t}'" for t in COMPENSATION_TYPES)
    sql = f"""SELECT type, COALESCE(SUM(amount), 0) AS amount
             FROM charges WHERE type IN ({types})
             GROUP BY type ORDER BY amount DESC"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]
