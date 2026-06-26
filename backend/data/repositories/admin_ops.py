"""
Destructive maintenance operations (super-admin only).

SQL lives here per the repository layering rule. Each reset runs in one
transaction and deletes child rows before parents so the foreign keys
(PRAGMA foreign_keys=ON) never block. Every statement names its table as a
fixed string literal — no f-string/identifier interpolation — so there is no
dynamic-SQL surface at all. Returns the per-table counts removed.
"""
from sqlalchemy import text
from core.db import get_engine


def reset_finance() -> dict:
    """Wipe BOTH financial ledgers — income (`charges`) and expenses
    (`vehicle_costs`). Vehicles, rentals, customers, users and settings are kept,
    so the Finance page simply returns to zero. Returns {table: rows_deleted}."""
    with get_engine().begin() as conn:
        counts = {
            "charges": conn.execute(text("SELECT COUNT(*) FROM charges")).scalar_one(),
            "vehicle_costs": conn.execute(text("SELECT COUNT(*) FROM vehicle_costs")).scalar_one(),
        }
        conn.execute(text("DELETE FROM charges"))
        conn.execute(text("DELETE FROM vehicle_costs"))
    return counts


def delete_client(customer_id: int) -> dict:
    """Delete ONE customer and everything tied to them, child-first for FK safety:
    the charges on their rentals, the rentals, then the customer. Any vehicle left
    'Rented' by a now-removed active rental is freed back to 'Available'. The
    customer_id is a bound parameter — no identifier interpolation. Returns
    {table: rows_deleted}."""
    with get_engine().begin() as conn:
        freed = conn.execute(text(
            "SELECT vehicle_id FROM rentals WHERE customer_id=:c AND status='Active'"
        ), {"c": customer_id}).scalars().all()
        counts = {
            "charges": conn.execute(text(
                "SELECT COUNT(*) FROM charges WHERE deal_id IN "
                "(SELECT deal_id FROM rentals WHERE customer_id=:c)"), {"c": customer_id}).scalar_one(),
            "rentals": conn.execute(text(
                "SELECT COUNT(*) FROM rentals WHERE customer_id=:c"), {"c": customer_id}).scalar_one(),
            "customers": conn.execute(text(
                "SELECT COUNT(*) FROM customers WHERE customer_id=:c"), {"c": customer_id}).scalar_one(),
        }
        conn.execute(text("DELETE FROM charges WHERE deal_id IN "
                          "(SELECT deal_id FROM rentals WHERE customer_id=:c)"), {"c": customer_id})
        conn.execute(text("DELETE FROM rentals WHERE customer_id=:c"), {"c": customer_id})
        conn.execute(text("DELETE FROM customers WHERE customer_id=:c"), {"c": customer_id})
        for vid in freed:
            conn.execute(text("UPDATE vehicles SET status='Available', updated_at=datetime('now') "
                              "WHERE vehicle_id=:v AND status='Rented'"), {"v": vid})
    return counts


def reset_clients() -> dict:
    """Wipe the whole customer book and everything that references it, child-first:
    the charges that belong to a rental, all rentals, then all customers. Vehicles,
    their photos, costs, users, settings and licenses are kept; any car left
    'Rented' is freed back to 'Available'. Returns {table: rows_deleted}."""
    with get_engine().begin() as conn:
        counts = {
            "charges": conn.execute(text(
                "SELECT COUNT(*) FROM charges WHERE deal_id IN (SELECT deal_id FROM rentals)")).scalar_one(),
            "rentals": conn.execute(text("SELECT COUNT(*) FROM rentals")).scalar_one(),
            "customers": conn.execute(text("SELECT COUNT(*) FROM customers")).scalar_one(),
        }
        conn.execute(text("DELETE FROM charges WHERE deal_id IN (SELECT deal_id FROM rentals)"))
        conn.execute(text("DELETE FROM rentals"))
        conn.execute(text("DELETE FROM customers"))
        conn.execute(text("UPDATE vehicles SET status='Available', updated_at=datetime('now') "
                          "WHERE status='Rented'"))
    return counts


def reset_fleet() -> dict:
    """Wipe the fleet and everything that references a vehicle: vehicle_photos,
    charges, vehicle_costs, rentals, then vehicles (child-first for FK safety).
    Customers, users, settings and licenses are kept. With the vehicles table
    empty, the default catalogue re-seeds automatically on the next app start.
    Returns {table: rows_deleted}."""
    with get_engine().begin() as conn:
        counts = {
            "vehicle_photos": conn.execute(text("SELECT COUNT(*) FROM vehicle_photos")).scalar_one(),
            "charges": conn.execute(text("SELECT COUNT(*) FROM charges")).scalar_one(),
            "vehicle_costs": conn.execute(text("SELECT COUNT(*) FROM vehicle_costs")).scalar_one(),
            "rentals": conn.execute(text("SELECT COUNT(*) FROM rentals")).scalar_one(),
            "vehicles": conn.execute(text("SELECT COUNT(*) FROM vehicles")).scalar_one(),
        }
        conn.execute(text("DELETE FROM vehicle_photos"))
        conn.execute(text("DELETE FROM charges"))
        conn.execute(text("DELETE FROM vehicle_costs"))
        conn.execute(text("DELETE FROM rentals"))
        conn.execute(text("DELETE FROM vehicles"))
    return counts
