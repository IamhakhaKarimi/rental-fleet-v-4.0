"""
Destructive maintenance operations (super-admin only).

SQL lives here per the repository layering rule. Each reset runs in one
transaction and deletes child rows before parents so the foreign keys
(PRAGMA foreign_keys=ON) never block. Every statement names its table as a
fixed string literal — no f-string/identifier interpolation — so there is no
dynamic-SQL surface at all. Returns the per-table counts removed.
"""
from sqlalchemy import text, inspect
from core.db import get_engine

# Tables included in a full backup, in PARENT-FIRST dependency order (so inserts on
# restore never trip a foreign key). Restore deletes in the reverse (child-first)
# order for the same reason. `sessions` is intentionally excluded — those are
# transient login tokens with no value in a backup. This is a fixed whitelist:
# every table name below is a literal constant, never user input, so interpolating
# it into SQL is not a dynamic-SQL surface.
BACKUP_TABLES = [
    "vehicles",
    "customers",
    "rentals",
    "charges",
    "vehicle_costs",
    "users",
    "audit_log",
    "app_settings",
    "vehicle_photos",
    "licenses",
]

# `app_settings` rows that a backup must never carry. The annual-license cap is
# one of them: backup/restore is an admin-level (level 2) capability, so if a
# restore could write `licensed_until_year`, any admin could unlock years for
# free by importing a hand-edited backup. These keys are skipped on export and
# preserved across import — the running installation's own license always wins.
# See services/licensing_service.PROTECTED_SETTING_KEYS.
PROTECTED_SETTINGS = (
    "licensed_until_year",
    "licensed_until_year_sealed_at",
)


def export_all() -> dict:
    """Read every backed-up table into a JSON-serialisable dict. All columns are
    text / integer / NULL (money is INTEGER cents, images are base64 TEXT), so the
    result is JSON-safe as-is. Dialect-agnostic — runs over the shared engine, so it
    works on local SQLite, Turso/libSQL and Postgres alike.

    License state is omitted (see PROTECTED_SETTINGS): it is bound to this
    installation's signing secret and is meaningless — or abusable — elsewhere."""
    eng = get_engine()
    tables: dict = {}
    with eng.connect() as conn:
        for tbl in BACKUP_TABLES:
            rows = conn.execute(text(f"SELECT * FROM {tbl}")).mappings().all()
            dicts = [dict(r) for r in rows]
            if tbl == "app_settings":
                dicts = [r for r in dicts if r.get("key") not in PROTECTED_SETTINGS]
            tables[tbl] = dicts
    return {"format": "bcr-backup", "version": 1, "tables": tables}


def import_all(data: dict) -> dict:
    """Replace the contents of every backed-up table with the rows in `data`
    (as produced by export_all). Runs in ONE transaction: wipe child-first, then
    insert parent-first, so an interrupted restore rolls back cleanly and foreign
    keys never block. Column names are validated against the live table columns
    before use, so a tampered backup can't inject SQL through a column name.
    License state (PROTECTED_SETTINGS) is held back from the wipe and restored
    afterwards, so a restore can neither grant nor revoke licensed years.
    Returns {table: rows_inserted}."""
    payload = data.get("tables") or {}
    eng = get_engine()
    insp = inspect(eng)
    counts: dict = {}
    with eng.begin() as conn:
        # Snapshot this installation's license rows before anything is touched.
        keep = [
            dict(r)
            for r in conn.execute(
                text("SELECT * FROM app_settings WHERE key IN (:k0, :k1)"),
                {"k0": PROTECTED_SETTINGS[0], "k1": PROTECTED_SETTINGS[1]},
            ).mappings().all()
        ]
        # Wipe existing rows child-first (reverse dependency order) for FK safety.
        for tbl in reversed(BACKUP_TABLES):
            conn.execute(text(f"DELETE FROM {tbl}"))
        # Re-insert parent-first.
        for tbl in BACKUP_TABLES:
            valid_cols = {c["name"] for c in insp.get_columns(tbl)}
            rows = payload.get(tbl) or []
            inserted = 0
            for row in rows:
                if not isinstance(row, dict):
                    continue
                # A backup never legitimately carries license state; one that does
                # is either stale or doctored. Drop it either way.
                if tbl == "app_settings" and row.get("key") in PROTECTED_SETTINGS:
                    continue
                cols = [c for c in row.keys() if c in valid_cols]
                if not cols:
                    continue
                col_list = ", ".join(cols)
                placeholders = ", ".join(f":{c}" for c in cols)
                params = {c: row[c] for c in cols}
                conn.execute(
                    text(f"INSERT INTO {tbl} ({col_list}) VALUES ({placeholders})"), params
                )
                inserted += 1
            counts[tbl] = inserted
        # Put the live license back exactly as it was.
        settings_cols = {c["name"] for c in insp.get_columns("app_settings")}
        for row in keep:
            cols = [c for c in row.keys() if c in settings_cols]
            col_list = ", ".join(cols)
            placeholders = ", ".join(f":{c}" for c in cols)
            conn.execute(
                text(f"INSERT INTO app_settings ({col_list}) VALUES ({placeholders})"),
                {c: row[c] for c in cols},
            )
    return counts


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
