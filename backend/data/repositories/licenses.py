"""Licenses repository — all SQL touching the annual-license ledger.

Records each license purchase (licensee, the year it covers, how many years,
the amount paid in cents, the purchase date and any notes). Returns plain dicts.
"""
from sqlalchemy import text
from core.db import db_read, get_engine


def list_licenses() -> list[dict]:
    sql = "SELECT * FROM licenses ORDER BY year DESC, license_id DESC"
    with db_read() as conn:
        return [dict(x) for x in conn.execute(text(sql)).mappings().all()]


def get_license(license_id: int) -> dict | None:
    with db_read() as conn:
        row = conn.execute(
            text("SELECT * FROM licenses WHERE license_id = :id"),
            {"id": license_id},
        ).mappings().first()
    return dict(row) if row else None


def add_license(licensee: str, year: int, years: int, amount_cents: int,
                purchase_date: str, notes: str) -> int:
    with get_engine().begin() as conn:
        result = conn.execute(
            text("""INSERT INTO licenses (licensee, year, years, amount, purchase_date, notes)
                    VALUES (:l, :y, :ys, :a, :pd, :n) RETURNING license_id"""),
            {"l": licensee or "", "y": int(year), "ys": int(years),
             "a": int(amount_cents), "pd": purchase_date, "n": notes or ""},
        )
        return int(result.scalar_one())


def update_license(license_id: int, licensee: str, year: int, years: int,
                   amount_cents: int, purchase_date: str, notes: str):
    with get_engine().begin() as conn:
        conn.execute(
            text("""UPDATE licenses
                    SET licensee=:l, year=:y, years=:ys, amount=:a,
                        purchase_date=:pd, notes=:n
                    WHERE license_id=:id"""),
            {"l": licensee or "", "y": int(year), "ys": int(years),
             "a": int(amount_cents), "pd": purchase_date, "n": notes or "",
             "id": license_id},
        )


def delete_license(license_id: int):
    with get_engine().begin() as conn:
        conn.execute(text("DELETE FROM licenses WHERE license_id = :id"),
                     {"id": license_id})
