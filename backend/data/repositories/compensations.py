"""
Damage compensation repository — the client-billed-cost ledger.

Mirrors vehicle_costs.py (the money the business *spends*) but for money the
business *collects back* from a client: damage, a mechanic invoice forwarded
to them, a traffic fine incurred while they had the car, cleaning, a fuel
shortfall, a lost item, etc. Rows live in the `charges` table (same ledger
'rental'/'deposit'/'overdue_penalty' charges use) so they automatically flow
into revenue/P&L totals — COMPENSATION_TYPES is exactly the subset of charge
types this repository manages.

Deletes are soft (deleted_at timestamp) so a compensation entry can be restored
from Settings -> Activity, mirroring the vehicle/rental undo pattern in
data/repositories/vehicles.py. Every read here filters `deleted_at IS NULL`
unless explicitly asked for deleted rows — services/finance_service.py's own
`charges` queries do the same so a soft-deleted entry stops counting toward
revenue immediately, exactly as a hard delete used to.
"""

from sqlalchemy import text
from core.db import db_read, get_engine

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
             WHERE c.type IN ({types}) AND c.deleted_at IS NULL
             ORDER BY c.occurred_at DESC, c.charge_id DESC
             LIMIT :lim"""
    with db_read() as conn:
        return [dict(r) for r in conn.execute(text(sql), {"lim": limit}).mappings().all()]


def list_deleted_compensations() -> list[dict]:
    """Soft-deleted rows, for the Settings -> Activity 'returnable' list."""
    types = ",".join(f"'{t}'" for t in COMPENSATION_TYPES)
    sql = f"""SELECT c.charge_id, c.vehicle_id, v.make_model, c.type, c.amount,
                    c.occurred_at AS period_date
             FROM charges c
             LEFT JOIN vehicles v ON v.vehicle_id = c.vehicle_id
             WHERE c.type IN ({types}) AND c.deleted_at IS NOT NULL
             ORDER BY c.deleted_at DESC"""
    with db_read() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]


def get_compensation(charge_id: int) -> dict | None:
    types = ",".join(f"'{t}'" for t in COMPENSATION_TYPES)
    sql = f"SELECT * FROM charges WHERE charge_id = :c AND type IN ({types})"
    with db_read() as conn:
        row = conn.execute(text(sql), {"c": charge_id}).mappings().first()
    return dict(row) if row else None


def update_compensation(charge_id: int, vehicle_id: str, comp_type: str, amount_cents: int,
                        period_date: str, note: str = "", deal_id: str | None = None) -> None:
    if comp_type not in COMPENSATION_TYPES:
        comp_type = "other"
    types = ",".join(f"'{t}'" for t in COMPENSATION_TYPES)
    with get_engine().begin() as conn:
        conn.execute(text(f"""
            UPDATE charges
            SET vehicle_id = :v, type = :t, amount = :a, occurred_at = :dt,
                note = :n, deal_id = :d
            WHERE charge_id = :c AND type IN ({types})
        """), {"v": vehicle_id, "t": comp_type, "a": int(amount_cents), "dt": period_date,
               "n": note or "", "d": deal_id or None, "c": charge_id})


def delete_compensation(charge_id: int) -> None:
    """Soft-delete: stamps deleted_at rather than removing the row, so it can
    be restored later from Settings -> Activity."""
    types = ",".join(f"'{t}'" for t in COMPENSATION_TYPES)
    with get_engine().begin() as conn:
        conn.execute(text(
            f"UPDATE charges SET deleted_at = datetime('now') "
            f"WHERE charge_id = :c AND type IN ({types})"
        ), {"c": charge_id})


def restore_compensation(charge_id: int) -> None:
    types = ",".join(f"'{t}'" for t in COMPENSATION_TYPES)
    with get_engine().begin() as conn:
        conn.execute(text(
            f"UPDATE charges SET deleted_at = NULL WHERE charge_id = :c AND type IN ({types})"
        ), {"c": charge_id})


def compensation_total() -> int:
    types = ",".join(f"'{t}'" for t in COMPENSATION_TYPES)
    with db_read() as conn:
        return conn.execute(text(
            f"SELECT COALESCE(SUM(amount), 0) FROM charges "
            f"WHERE type IN ({types}) AND deleted_at IS NULL"
        )).scalar_one()


def compensation_by_type() -> list[dict]:
    types = ",".join(f"'{t}'" for t in COMPENSATION_TYPES)
    sql = f"""SELECT type, COALESCE(SUM(amount), 0) AS amount
             FROM charges WHERE type IN ({types}) AND deleted_at IS NULL
             GROUP BY type ORDER BY amount DESC"""
    with db_read() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]
