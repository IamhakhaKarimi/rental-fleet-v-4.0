"""
Charges repository — the income ledger (rental, deposit, penalties, refunds).

Charge rows are written from the rentals repository when a deal is created or
settled; this module covers the read/delete paths the super-admin data screen
needs to browse and remove individual income records. SQL lives here per the
repository layering rule. Amounts are INTEGER cents, dates ISO-8601 text.
"""
from sqlalchemy import text
from core.db import db_read, get_engine

CHARGE_TYPES = ["rental", "overdue_penalty", "damage", "deposit", "refund"]


def list_charges(limit: int = 200) -> list[dict]:
    # Excludes soft-deleted compensation rows (see data/repositories/compensations.py)
    # so a damage/mechanic_fee/etc. entry deleted from the Finance page doesn't
    # linger here looking live — this screen is a different, generic admin
    # browser over the same `charges` table.
    sql = """SELECT c.charge_id, c.deal_id, c.vehicle_id, v.make_model,
                    c.type, c.amount, c.occurred_at
             FROM charges c
             LEFT JOIN vehicles v ON v.vehicle_id = c.vehicle_id
             WHERE c.deleted_at IS NULL
             ORDER BY c.occurred_at DESC, c.charge_id DESC
             LIMIT :lim"""
    with db_read() as conn:
        return [dict(r) for r in conn.execute(text(sql), {"lim": limit}).mappings().all()]


def delete_charge(charge_id: int) -> None:
    # Deliberately a hard delete, unlike vehicle_costs/compensations.py's
    # soft-delete: this generic admin screen spans every charge type (rental,
    # deposit, refund, overdue_penalty — not just compensations), and giving
    # rental income an undo path is a different feature than the Finance page's
    # Costs/Compensation "Return" support. A compensation-type row removed from
    # here is NOT recoverable via Settings -> Activity; use the Compensation
    # tab's own Delete button (Finance page) to keep that entry undoable.
    with get_engine().begin() as conn:
        conn.execute(text("DELETE FROM charges WHERE charge_id = :c"), {"c": charge_id})
