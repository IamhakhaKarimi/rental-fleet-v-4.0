"""
Scheduling service — the booking brain.

compute_return:    turns a start date/time + day count + return time into the
                   exact return datetime to promise the customer.

available_vehicles: answers "which cars are free for [start, end)?" using an
                   indexed interval-overlap query instead of the old nested
                   Python loops. Two intervals overlap when:
                       max(start_a, start_b) < min(end_a, end_b)
                   We let SQLite evaluate that against the idx_rentals_interval
                   index, so it stays fast as the deal history grows.
"""

from datetime import datetime, date, time, timedelta
from sqlalchemy import text
from core.db import db_read


def compute_return(start_date: date, start_time: time, days: int, return_time: time) -> datetime:
    return_date = start_date + timedelta(days=int(days))
    return datetime.combine(return_date, return_time)


# How far ahead (hours) a return counts as "due soon" — the alert window.
DUE_SOON_HOURS = 24


def return_state(end_dt_str: str, now: datetime | None = None,
                 soon_hours: int = DUE_SOON_HOURS) -> tuple[str, float]:
    """
    Classify a rental's return time. Returns (state, hours) where state is:
      - "overdue"  -> deadline already passed; hours = how many hours LATE
      - "due_soon" -> within `soon_hours` of the deadline; hours = hours REMAINING
      - "ok"       -> further out; hours = hours remaining
    The car's stored status stays 'Rented' throughout — this is a derived view.
    """
    now = now or datetime.now()
    try:
        end = datetime.fromisoformat(end_dt_str)
    except Exception:
        return ("ok", 0.0)
    hours = (end - now).total_seconds() / 3600.0
    if hours < 0:
        return ("overdue", -hours)
    if hours <= soon_hours:
        return ("due_soon", hours)
    return ("ok", hours)


def is_vehicle_free(vehicle_id: str, req_start: datetime, req_end: datetime) -> bool:
    """True if the car has no Active rental overlapping [req_start, req_end)."""
    s = req_start.strftime("%Y-%m-%dT%H:%M:%S")
    e = req_end.strftime("%Y-%m-%dT%H:%M:%S")
    sql = """SELECT 1 FROM rentals r
             WHERE r.vehicle_id = :v AND r.status = 'Active'
               AND MAX(r.start_dt, :s) < MIN(r.end_dt, :e) LIMIT 1"""
    with db_read() as conn:
        clash = conn.execute(text(sql), {"v": vehicle_id, "s": s, "e": e}).first()
    return clash is None


def available_vehicles(req_start: datetime, req_end: datetime) -> list[dict]:
    """Cars free for [req_start, req_end). A car counts as free when it has NO
    Active rental overlapping the window — even one whose current rental ENDS
    before the window begins (its stored status may still be 'Rented'). So a car
    coming back from an in-progress rental in time for the requested dates appears
    here too: 'Rented' is left to the interval-overlap test rather than excluded
    outright. Only genuinely unavailable statuses (archived / garaged / in
    maintenance) are filtered before the date check."""
    s = req_start.strftime("%Y-%m-%dT%H:%M:%S")
    e = req_end.strftime("%Y-%m-%dT%H:%M:%S")
    sql = """
        SELECT v.vehicle_id, v.make_model, v.license_plate, v.color, v.base_daily_rate
        FROM vehicles v
        WHERE v.status NOT IN ('DELETED', 'In Garage', 'Maintenance')
          AND NOT EXISTS (
              SELECT 1 FROM rentals r
              WHERE r.vehicle_id = v.vehicle_id
                AND r.status = 'Active'
                AND MAX(r.start_dt, :s) < MIN(r.end_dt, :e)
          )
        ORDER BY v.vehicle_id
    """
    with db_read() as conn:
        return [dict(x) for x in conn.execute(text(sql), {"s": s, "e": e}).mappings().all()]
