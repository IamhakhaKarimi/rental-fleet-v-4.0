"""
Charges repository — the income ledger (rental, deposit, penalties, refunds).

Charge rows are written from the rentals repository when a deal is created or
settled; this module covers the read/delete paths the super-admin data screen
needs to browse and remove individual income records. SQL lives here per the
repository layering rule. Amounts are INTEGER cents, dates ISO-8601 text.
"""
from sqlalchemy import text
from core.db import get_engine

CHARGE_TYPES = ["rental", "overdue_penalty", "damage", "deposit", "refund"]


def list_charges(limit: int = 200) -> list[dict]:
    sql = """SELECT c.charge_id, c.deal_id, c.vehicle_id, v.make_model,
                    c.type, c.amount, c.occurred_at
             FROM charges c
             LEFT JOIN vehicles v ON v.vehicle_id = c.vehicle_id
             ORDER BY c.occurred_at DESC, c.charge_id DESC
             LIMIT :lim"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql), {"lim": limit}).mappings().all()]


def delete_charge(charge_id: int) -> None:
    with get_engine().begin() as conn:
        conn.execute(text("DELETE FROM charges WHERE charge_id = :c"), {"c": charge_id})
