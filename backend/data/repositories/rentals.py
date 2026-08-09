"""Rentals repository — create, list, cancel, and overdue detection."""
from datetime import datetime
from sqlalchemy import text
from config.settings import LANGUAGES, DEFAULT_LANG
from core.db import get_engine
from data.repositories.customers import get_or_create_customer


def next_deal_id() -> str:
    prefix = f"RENT-{datetime.now().strftime('%Y%m')}-"
    with get_engine().connect() as conn:
        rows = conn.execute(
            text("SELECT deal_id FROM rentals WHERE deal_id LIKE :p"), {"p": prefix + "%"}
        ).scalars().all()
    max_n = max((int(d.rsplit("-", 1)[-1]) for d in rows if d.rsplit("-", 1)[-1].isdigit()), default=0)
    return f"{prefix}{max_n + 1:03d}"


def list_active_rentals_with_vehicle() -> list[dict]:
    sql = """SELECT r.deal_id, r.vehicle_id, r.start_dt, r.end_dt, r.status,
                    r.rental_days, r.daily_rate, r.total_amount, r.deposit,
                    v.make_model, v.color, v.license_plate,
                    c.full_name AS client_name, c.phone, c.id_passport
             FROM rentals r
             JOIN vehicles  v ON v.vehicle_id  = r.vehicle_id
             JOIN customers c ON c.customer_id = r.customer_id
             WHERE r.status = 'Active'
             ORDER BY r.end_dt"""
    with get_engine().connect() as conn:
        return [dict(x) for x in conn.execute(text(sql)).mappings().all()]


def list_all_rentals_with_vehicle() -> list[dict]:
    """Active AND closed rentals with the vehicle + customer fields the occupancy
    timeline needs. Feeds the timeline's "Show done" toggle (Active bars are
    coloured by return-state; closed ones render greyed)."""
    sql = """SELECT r.deal_id, r.vehicle_id, r.start_dt, r.end_dt, r.status,
                    r.rental_days, r.daily_rate, r.total_amount, r.deposit,
                    v.make_model, v.color, v.license_plate,
                    c.full_name AS client_name, c.phone, c.id_passport
             FROM rentals r
             JOIN vehicles  v ON v.vehicle_id  = r.vehicle_id
             JOIN customers c ON c.customer_id = r.customer_id
             ORDER BY r.start_dt"""
    with get_engine().connect() as conn:
        return [dict(x) for x in conn.execute(text(sql)).mappings().all()]


def list_all_rentals() -> list[dict]:
    sql = """SELECT r.deal_id, r.vehicle_id, r.start_dt, r.end_dt, r.status,
                    r.rental_days, r.daily_rate, r.total_amount, r.deposit,
                    v.make_model, c.full_name AS client_name, c.phone
             FROM rentals r
             JOIN vehicles  v ON v.vehicle_id  = r.vehicle_id
             JOIN customers c ON c.customer_id = r.customer_id
             ORDER BY r.start_dt DESC"""
    with get_engine().connect() as conn:
        return [dict(x) for x in conn.execute(text(sql)).mappings().all()]


def get_rental_full(deal_id: str) -> dict | None:
    """Everything needed to print an invoice for one rental."""
    sql = """SELECT r.deal_id, r.vehicle_id, r.start_dt, r.end_dt, r.status,
                    r.rental_days, r.daily_rate, r.total_amount, r.deposit,
                    r.contract_signed, r.return_notes, r.created_at,
                    r.created_by, r.created_by_name, r.created_by_role, r.invoice_lang,
                    v.make_model, v.license_plate, v.color, v.year,
                    c.full_name AS client_name, c.phone, c.id_passport
             FROM rentals r
             JOIN vehicles  v ON v.vehicle_id  = r.vehicle_id
             JOIN customers c ON c.customer_id = r.customer_id
             WHERE r.deal_id = :d"""
    with get_engine().connect() as conn:
        row = conn.execute(text(sql), {"d": deal_id}).mappings().first()
    return dict(row) if row else None


def list_charges_for_deal(deal_id: str) -> list[dict]:
    sql = """SELECT type, amount, occurred_at FROM charges
             WHERE deal_id = :d AND deleted_at IS NULL ORDER BY occurred_at, charge_id"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql), {"d": deal_id}).mappings().all()]


def list_rentals_for_customer(customer_id: int) -> list[dict]:
    sql = """SELECT r.deal_id, r.vehicle_id, r.start_dt, r.end_dt,
                    r.rental_days, r.daily_rate, r.total_amount, r.status,
                    r.created_by, r.created_by_name, r.created_by_role,
                    v.make_model, v.license_plate
             FROM rentals r JOIN vehicles v ON v.vehicle_id=r.vehicle_id
             WHERE r.customer_id=:cid ORDER BY r.start_dt DESC"""
    with get_engine().connect() as conn:
        return [dict(x) for x in conn.execute(text(sql), {"cid": customer_id}).mappings().all()]


def vehicle_has_active_rental(vehicle_id: str) -> bool:
    """True if the vehicle currently has an Active rental (reserved / out)."""
    with get_engine().connect() as conn:
        row = conn.execute(text(
            "SELECT 1 FROM rentals WHERE vehicle_id=:v AND status='Active' LIMIT 1"
        ), {"v": vehicle_id}).first()
    return row is not None


def create_rental(*, vehicle_id, make_model, client_name, phone, id_passport,
                  start_dt, end_dt, days, daily_rate_cents, deposit_cents,
                  created_by="", created_by_name="", created_by_role="",
                  invoice_lang="tr") -> str:
    customer_id = get_or_create_customer(client_name, phone, id_passport)
    deal_id = next_deal_id()
    total = daily_rate_cents * int(days)
    with get_engine().begin() as conn:
        conn.execute(text("""
            INSERT INTO rentals
              (deal_id,customer_id,vehicle_id,start_dt,end_dt,rental_days,
               daily_rate,total_amount,deposit,status,contract_signed,
               created_by,created_by_name,created_by_role,invoice_lang)
            VALUES
              (:did,:cid,:vid,:s,:e,:d,:rate,:total,:dep,'Active','No',
               :cby,:cbn,:cbr,:ilang)
        """), {"did": deal_id, "cid": customer_id, "vid": vehicle_id,
               "s": start_dt.strftime("%Y-%m-%dT%H:%M:%S"),
               "e": end_dt.strftime("%Y-%m-%dT%H:%M:%S"),
               "d": int(days), "rate": daily_rate_cents, "total": total, "dep": deposit_cents,
               "cby": created_by or "", "cbn": created_by_name or "", "cbr": created_by_role or "",
               "ilang": invoice_lang if invoice_lang in LANGUAGES else DEFAULT_LANG})
        conn.execute(text(
            "INSERT INTO charges (deal_id,vehicle_id,type,amount) VALUES (:did,:vid,'rental',:a)"
        ), {"did": deal_id, "vid": vehicle_id, "a": total})
        if deposit_cents > 0:
            conn.execute(text(
                "INSERT INTO charges (deal_id,vehicle_id,type,amount) VALUES (:did,:vid,'deposit',:a)"
            ), {"did": deal_id, "vid": vehicle_id, "a": deposit_cents})
        conn.execute(text(
            "UPDATE vehicles SET status='Rented',updated_at=datetime('now') WHERE vehicle_id=:v"
        ), {"v": vehicle_id})
    return deal_id


def update_creator(deal_id: str, username: str, full_name: str, role: str):
    """Reassign which staff member a rental is recorded as 'registered by'."""
    with get_engine().begin() as conn:
        conn.execute(text("""
            UPDATE rentals SET created_by=:u, created_by_name=:n, created_by_role=:r
            WHERE deal_id=:d
        """), {"u": username or "", "n": full_name or "", "r": role or "", "d": deal_id})


def update_rental_rate(deal_id: str, daily_rate_cents: int) -> int:
    """Edit an Active rental's negotiated daily rate. Recomputes the total
    (rate × stored day count) and keeps the deal's 'rental' income charge in
    sync. Returns the new total in cents (or -1 if the rental is missing)."""
    daily_rate_cents = int(daily_rate_cents)
    with get_engine().begin() as conn:
        days = conn.execute(text(
            "SELECT rental_days FROM rentals WHERE deal_id=:d"), {"d": deal_id}).scalar()
        if days is None:
            return -1
        total = daily_rate_cents * int(days)
        conn.execute(text(
            "UPDATE rentals SET daily_rate=:rate, total_amount=:total WHERE deal_id=:d"
        ), {"rate": daily_rate_cents, "total": total, "d": deal_id})
        # Keep the income ledger consistent: the single 'rental' charge mirrors
        # the rental total (deposits/penalties/damage are separate charge rows).
        conn.execute(text(
            "UPDATE charges SET amount=:total WHERE deal_id=:d AND type='rental'"
        ), {"total": total, "d": deal_id})
    return total


def update_rental_dates(deal_id: str, return_date: str = "", start_date: str = "",
                         start_time: str = "", return_time: str = "") -> int:
    """Edit an Active rental's start and/or return DATE (and optionally time-of-day).
    An empty string for any field keeps the current value. Recomputes
    rental_days, the total (rate × days) and keeps the 'rental' income charge in
    sync. Rejects a return on/before the start, and a window that would clash with
    another active booking of the same car. Returns the new total in cents, or a
    negative code:
        -1 rental missing/closed, -2 invalid dates (return <= start), -3 clash."""
    from datetime import date, datetime, time as dtime
    with get_engine().begin() as conn:
        row = conn.execute(text(
            "SELECT vehicle_id, start_dt, end_dt, daily_rate FROM rentals "
            "WHERE deal_id=:d AND status='Active'"), {"d": deal_id}).mappings().first()
        if not row:
            return -1
        cur_start = datetime.fromisoformat(row["start_dt"])
        cur_end = datetime.fromisoformat(row["end_dt"])
        try:
            new_start_date = date.fromisoformat(start_date[:10]) if start_date else cur_start.date()
            new_end_date = date.fromisoformat(return_date[:10]) if return_date else cur_end.date()
            new_start_time = dtime.fromisoformat(start_time) if start_time else cur_start.time()
            new_end_time = dtime.fromisoformat(return_time) if return_time else cur_end.time()
        except ValueError:
            return -2
        new_start = datetime.combine(new_start_date, new_start_time)
        new_end = datetime.combine(new_end_date, new_end_time)
        days = (new_end_date - new_start_date).days
        if days < 1 or new_end <= new_start:
            return -2
        s = new_start.strftime("%Y-%m-%dT%H:%M:%S")
        e = new_end.strftime("%Y-%m-%dT%H:%M:%S")
        clash = conn.execute(text(
            "SELECT 1 FROM rentals WHERE vehicle_id=:v AND status='Active' "
            "AND deal_id<>:d AND MAX(start_dt,:s) < MIN(end_dt,:e) LIMIT 1"
        ), {"v": row["vehicle_id"], "d": deal_id, "s": s, "e": e}).first()
        if clash:
            return -3
        total = int(row["daily_rate"]) * days
        conn.execute(text(
            "UPDATE rentals SET start_dt=:s, end_dt=:e, rental_days=:days, total_amount=:total "
            "WHERE deal_id=:d"
        ), {"s": s, "e": e, "days": days, "total": total, "d": deal_id})
        conn.execute(text(
            "UPDATE charges SET amount=:total WHERE deal_id=:d AND type='rental'"
        ), {"total": total, "d": deal_id})
    return total


def change_rental_vehicle(deal_id: str, new_vehicle_id: str) -> bool:
    """Swap the car on an Active rental to `new_vehicle_id`. Verifies the new car
    is bookable (not archived/garaged/in-maintenance) and free for this rental's
    window (excluding this deal), then frees the old car, reserves the new one,
    and re-points the deal's income charges at it — all atomically. Returns False
    (no change) if the rental is missing/closed or the new car isn't available."""
    with get_engine().begin() as conn:
        row = conn.execute(text(
            "SELECT vehicle_id, start_dt, end_dt FROM rentals "
            "WHERE deal_id=:d AND status='Active'"), {"d": deal_id}).mappings().first()
        if not row:
            return False
        old_vid = row["vehicle_id"]
        if new_vehicle_id == old_vid:
            return True
        vstatus = conn.execute(text(
            "SELECT status FROM vehicles WHERE vehicle_id=:v"), {"v": new_vehicle_id}).scalar()
        if vstatus is None or vstatus in ("DELETED", "In Garage", "Maintenance"):
            return False
        clash = conn.execute(text(
            "SELECT 1 FROM rentals WHERE vehicle_id=:v AND status='Active' "
            "AND deal_id<>:d AND MAX(start_dt,:s) < MIN(end_dt,:e) LIMIT 1"
        ), {"v": new_vehicle_id, "d": deal_id,
            "s": row["start_dt"], "e": row["end_dt"]}).first()
        if clash:
            return False
        conn.execute(text("UPDATE rentals SET vehicle_id=:v WHERE deal_id=:d"),
                     {"v": new_vehicle_id, "d": deal_id})
        conn.execute(text("UPDATE charges SET vehicle_id=:v WHERE deal_id=:d"),
                     {"v": new_vehicle_id, "d": deal_id})
        conn.execute(text(
            "UPDATE vehicles SET status='Available', updated_at=datetime('now') WHERE vehicle_id=:v"
        ), {"v": old_vid})
        conn.execute(text(
            "UPDATE vehicles SET status='Rented', updated_at=datetime('now') WHERE vehicle_id=:v"
        ), {"v": new_vehicle_id})
    return True


def cancel_rental(deal_id: str):
    with get_engine().begin() as conn:
        vid = conn.execute(text("SELECT vehicle_id FROM rentals WHERE deal_id=:d"),
                           {"d": deal_id}).scalar()
        conn.execute(text("UPDATE rentals SET status='Closed' WHERE deal_id=:d"), {"d": deal_id})
        if vid:
            conn.execute(text(
                "UPDATE vehicles SET status='Available',updated_at=datetime('now') WHERE vehicle_id=:v"
            ), {"v": vid})


def delete_rental(deal_id: str) -> bool:
    """Permanently remove one rental record — used to drop a duplicate/erroneous
    entry from a customer's history. Cascades its charges (so it stops skewing
    Finance totals) and frees the vehicle if this rental was the one holding it.
    Returns False if the deal_id doesn't exist."""
    with get_engine().begin() as conn:
        vid = conn.execute(text(
            "SELECT vehicle_id FROM rentals WHERE deal_id=:d AND status='Active'"
        ), {"d": deal_id}).scalar()
        conn.execute(text("DELETE FROM charges WHERE deal_id=:d"), {"d": deal_id})
        deleted = conn.execute(text("DELETE FROM rentals WHERE deal_id=:d"), {"d": deal_id}).rowcount
        if vid:
            conn.execute(text(
                "UPDATE vehicles SET status='Available',updated_at=datetime('now') WHERE vehicle_id=:v"
            ), {"v": vid})
    return bool(deleted)


def reactivate_rental(deal_id: str) -> bool:
    """Undo a cancellation: set the rental back to 'Active' and re-reserve its
    vehicle. Returns False (no-op) if the rental is missing or its car is already
    held by a different active rental."""
    with get_engine().begin() as conn:
        row = conn.execute(text(
            "SELECT vehicle_id, status FROM rentals WHERE deal_id=:d"), {"d": deal_id}
        ).mappings().first()
        if not row:
            return False
        vid = row["vehicle_id"]
        clash = conn.execute(text(
            "SELECT 1 FROM rentals WHERE vehicle_id=:v AND status='Active' "
            "AND deal_id<>:d LIMIT 1"), {"v": vid, "d": deal_id}).first()
        if clash:
            return False
        conn.execute(text("UPDATE rentals SET status='Active' WHERE deal_id=:d"), {"d": deal_id})
        conn.execute(text(
            "UPDATE vehicles SET status='Rented', updated_at=datetime('now') WHERE vehicle_id=:v"
        ), {"v": vid})
    return True


def settle_and_close(deal_id: str, vehicle_id: str, late_cents: int,
                     damage_cents: int, return_notes: str, contract_signed: bool):
    """Return a vehicle: record any overdue/damage charges, close the rental, and
    free the car — all atomically. Charges feed the Finance ledger; damage also
    accrues on the vehicle's maintenance_charge."""
    with get_engine().begin() as conn:
        if late_cents > 0:
            conn.execute(text(
                "INSERT INTO charges (deal_id,vehicle_id,type,amount) "
                "VALUES (:d,:v,'overdue_penalty',:a)"
            ), {"d": deal_id, "v": vehicle_id, "a": int(late_cents)})
        if damage_cents > 0:
            conn.execute(text(
                "INSERT INTO charges (deal_id,vehicle_id,type,amount) "
                "VALUES (:d,:v,'damage',:a)"
            ), {"d": deal_id, "v": vehicle_id, "a": int(damage_cents)})
            conn.execute(text(
                "UPDATE vehicles SET maintenance_charge = maintenance_charge + :a "
                "WHERE vehicle_id=:v"
            ), {"a": int(damage_cents), "v": vehicle_id})
        conn.execute(text(
            "UPDATE rentals SET status='Closed', return_notes=:n, contract_signed=:c "
            "WHERE deal_id=:d"
        ), {"n": return_notes or "", "c": "Yes" if contract_signed else "No", "d": deal_id})
        conn.execute(text(
            "UPDATE vehicles SET status='Available', updated_at=datetime('now') "
            "WHERE vehicle_id=:v"
        ), {"v": vehicle_id})
