"""Customers repository."""
from sqlalchemy import text
from core.db import get_engine


def get_or_create_customer(full_name: str, phone: str, id_passport: str) -> int:
    full_name = (full_name or "").strip()
    phone = (phone or "").strip()
    id_passport = (id_passport or "").strip()
    with get_engine().begin() as conn:
        existing = conn.execute(
            text("SELECT customer_id FROM customers WHERE full_name=:n AND phone=:p"),
            {"n": full_name, "p": phone}
        ).scalar()
        if existing is not None:
            return int(existing)
        result = conn.execute(
            text("INSERT INTO customers (full_name,phone,id_passport) VALUES (:n,:p,:i) "
                 "RETURNING customer_id"),
            {"n": full_name, "p": phone, "i": id_passport}
        )
        return int(result.scalar_one())


def update_customer(customer_id: int, full_name: str, phone: str, id_passport: str):
    with get_engine().begin() as conn:
        conn.execute(text("""
            UPDATE customers SET full_name=:n, phone=:p, id_passport=:i
            WHERE customer_id=:cid
        """), {"n": (full_name or "").strip(), "p": (phone or "").strip(),
               "i": (id_passport or "").strip(), "cid": customer_id})


def get_customer(customer_id: int) -> dict | None:
    """Fetch one customer row by id (plain dict), or None if missing."""
    with get_engine().connect() as conn:
        row = conn.execute(
            text("SELECT customer_id, full_name, phone, id_passport "
                 "FROM customers WHERE customer_id = :cid"),
            {"cid": customer_id},
        ).mappings().first()
    return dict(row) if row else None


def list_customers_enriched() -> list[dict]:
    """One-query customer list for the FastAPI customers page: each row carries
    the rental count, latest rental date, and who booked that latest rental
    (`registered_by` = `created_by_name` of the most recent rental). Cross-dialect
    (no SQLite-only syntax) — a LEFT JOIN + GROUP BY for the count/last date, plus
    a correlated subquery for the latest booker, identical in style to
    `list_customers()`."""
    sql = """SELECT c.customer_id, c.full_name, c.phone, c.id_passport,
                    COUNT(r.deal_id) AS rental_count,
                    SUM(CASE WHEN r.status = 'Active' THEN 1 ELSE 0 END) AS active_count,
                    MAX(r.start_dt) AS last_rental_date,
                    (SELECT r2.created_by_name FROM rentals r2
                       WHERE r2.customer_id = c.customer_id
                       ORDER BY r2.start_dt DESC, r2.deal_id DESC LIMIT 1) AS registered_by,
                    (SELECT r2.daily_rate FROM rentals r2
                       WHERE r2.customer_id = c.customer_id
                       ORDER BY r2.start_dt DESC, r2.deal_id DESC LIMIT 1) AS last_daily_rate,
                    (SELECT v.make_model FROM rentals r2 JOIN vehicles v ON v.vehicle_id = r2.vehicle_id
                       WHERE r2.customer_id = c.customer_id
                       ORDER BY r2.start_dt DESC, r2.deal_id DESC LIMIT 1) AS last_make_model,
                    (SELECT v.license_plate FROM rentals r2 JOIN vehicles v ON v.vehicle_id = r2.vehicle_id
                       WHERE r2.customer_id = c.customer_id
                       ORDER BY r2.start_dt DESC, r2.deal_id DESC LIMIT 1) AS last_plate
             FROM customers c
             LEFT JOIN rentals r ON r.customer_id = c.customer_id
             GROUP BY c.customer_id, c.full_name, c.phone, c.id_passport
             ORDER BY c.full_name"""
    with get_engine().connect() as conn:
        return [dict(x) for x in conn.execute(text(sql)).mappings().all()]


def list_customers() -> list[dict]:
    # The two correlated subqueries snapshot WHO booked this customer's most
    # recent rental (name + role) for the "Registered by" column.
    # The correlated subqueries snapshot WHO booked this customer's most recent
    # rental (name + role) for the "Registered by" column, and — for the
    # currently-renting card view — the car/plate/negotiated-rate of their most
    # recent ACTIVE rental (NULL for customers with no live rental).
    sql = """SELECT c.customer_id, c.full_name, c.phone, c.id_passport,
                    COUNT(r.deal_id) AS rental_count,
                    SUM(CASE WHEN r.status = 'Active' THEN 1 ELSE 0 END) AS active_count,
                    MAX(r.start_dt) AS last_rental,
                    (SELECT r2.created_by_name FROM rentals r2
                       WHERE r2.customer_id = c.customer_id
                       ORDER BY r2.start_dt DESC, r2.deal_id DESC LIMIT 1) AS last_by_name,
                    (SELECT r2.created_by_role FROM rentals r2
                       WHERE r2.customer_id = c.customer_id
                       ORDER BY r2.start_dt DESC, r2.deal_id DESC LIMIT 1) AS last_by_role,
                    (SELECT r2.vehicle_id FROM rentals r2
                       WHERE r2.customer_id = c.customer_id AND r2.status = 'Active'
                       ORDER BY r2.start_dt DESC, r2.deal_id DESC LIMIT 1) AS active_vehicle_id,
                    (SELECT r2.daily_rate FROM rentals r2
                       WHERE r2.customer_id = c.customer_id AND r2.status = 'Active'
                       ORDER BY r2.start_dt DESC, r2.deal_id DESC LIMIT 1) AS active_daily_rate,
                    (SELECT v.make_model FROM rentals r2 JOIN vehicles v ON v.vehicle_id = r2.vehicle_id
                       WHERE r2.customer_id = c.customer_id AND r2.status = 'Active'
                       ORDER BY r2.start_dt DESC, r2.deal_id DESC LIMIT 1) AS active_make_model,
                    (SELECT v.license_plate FROM rentals r2 JOIN vehicles v ON v.vehicle_id = r2.vehicle_id
                       WHERE r2.customer_id = c.customer_id AND r2.status = 'Active'
                       ORDER BY r2.start_dt DESC, r2.deal_id DESC LIMIT 1) AS active_plate
             FROM customers c
             LEFT JOIN rentals r ON r.customer_id = c.customer_id
             GROUP BY c.customer_id
             ORDER BY c.full_name"""
    with get_engine().connect() as conn:
        return [dict(x) for x in conn.execute(text(sql)).mappings().all()]
