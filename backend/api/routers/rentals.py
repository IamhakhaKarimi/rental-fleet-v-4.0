"""Rentals router — reads + booking/return mutations.

Reuses services/scheduling_service.py (availability math) and
data/repositories/rentals.py (create/close/cancel) verbatim. Booking re-checks
is_vehicle_free on save and snapshots the acting staff member (created_by*).
Personal-info fields are stored UPPERCASE, mirroring the Streamlit booking panel.
"""
from __future__ import annotations

from datetime import date, datetime, time

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.deps import require
from data.repositories import rentals as rrepo
from services import audit_service, scheduling_service as sched

router = APIRouter(prefix="/api/rentals", tags=["rentals"])


def _cents(euros: float) -> int:
    return int(round(float(euros or 0) * 100))


def _window(start_date: str, start_time: str, days: int, return_time: str):
    sd = date.fromisoformat(start_date)
    st = time.fromisoformat(start_time)
    rt = time.fromisoformat(return_time)
    start_dt = datetime.combine(sd, st)
    end_dt = sched.compute_return(sd, st, int(days), rt)
    return start_dt, end_dt


class WindowIn(BaseModel):
    start_date: str
    start_time: str = "10:00"
    days: int = 3
    return_time: str = "10:00"


class AvailabilityIn(WindowIn):
    vehicle_id: str


class BookingIn(WindowIn):
    vehicle_id: str
    make_model: str = ""
    client_name: str
    phone: str = ""
    id_passport: str = ""
    daily_rate_euros: float = 0
    deposit_euros: float = 0
    invoice_lang: str = "tr"


class CloseIn(BaseModel):
    late_euros: float = 0
    damage_euros: float = 0
    return_notes: str = ""
    contract_signed: bool = False


# ── Reads ───────────────────────────────────────────────────────────────────
@router.get("/active")
def active(user: dict = Depends(require("view_management"))) -> list[dict]:
    return rrepo.list_active_rentals_with_vehicle()


@router.get("/all")
def all_rentals(user: dict = Depends(require("view_management"))) -> list[dict]:
    return rrepo.list_all_rentals_with_vehicle()


@router.get("/{deal_id}")
def get_one(deal_id: str, user: dict = Depends(require("view_management"))) -> dict:
    r = rrepo.get_rental_full(deal_id)
    if not r:
        raise HTTPException(404, detail="not_found")
    return r


# ── Availability ────────────────────────────────────────────────────────────
@router.post("/availability")
def availability(body: AvailabilityIn,
                 user: dict = Depends(require("create_reservation"))) -> dict:
    start_dt, end_dt = _window(body.start_date, body.start_time, body.days, body.return_time)
    return {"free": sched.is_vehicle_free(body.vehicle_id, start_dt, end_dt),
            "return": end_dt.strftime("%Y-%m-%dT%H:%M:%S")}


@router.post("/available-cars")
def available_cars(body: WindowIn,
                   user: dict = Depends(require("create_reservation"))) -> dict:
    start_dt, end_dt = _window(body.start_date, body.start_time, body.days, body.return_time)
    return {"return": end_dt.strftime("%Y-%m-%dT%H:%M:%S"),
            "cars": sched.available_vehicles(start_dt, end_dt)}


# ── Mutations ───────────────────────────────────────────────────────────────
@router.post("", status_code=201)
def create(body: BookingIn, user: dict = Depends(require("create_reservation"))) -> dict:
    if not body.client_name.strip() or not body.phone.strip():
        raise HTTPException(400, detail="register_need_fields")
    start_dt, end_dt = _window(body.start_date, body.start_time, body.days, body.return_time)
    if not sched.is_vehicle_free(body.vehicle_id, start_dt, end_dt):
        raise HTTPException(409, detail="no_cars")
    deal_id = rrepo.create_rental(
        vehicle_id=body.vehicle_id,
        make_model=body.make_model,
        client_name=body.client_name.strip().upper(),
        phone=body.phone.strip().upper(),
        id_passport=body.id_passport.strip().upper(),
        start_dt=start_dt, end_dt=end_dt, days=int(body.days),
        daily_rate_cents=_cents(body.daily_rate_euros),
        deposit_cents=_cents(body.deposit_euros),
        created_by=user["username"], created_by_name=user.get("full_name", ""),
        created_by_role=user.get("role", ""), invoice_lang=body.invoice_lang,
    )
    audit_service.record(user, "create_rental", "rental", deal_id, body.vehicle_id)
    return {"deal_id": deal_id}


@router.put("/{deal_id}/rate")
def update_rate(deal_id: str, body: "RateIn",
                user: dict = Depends(require("create_reservation"))) -> dict:
    total = rrepo.update_rental_rate(deal_id, _cents(body.daily_rate_euros))
    if total < 0:
        raise HTTPException(404, detail="not_found")
    audit_service.record(user, "edit_rental_rate", "rental", deal_id)
    return {"total": total}


@router.put("/{deal_id}/vehicle")
def change_vehicle(deal_id: str, body: "VehicleSwapIn",
                   user: dict = Depends(require("create_reservation"))) -> dict:
    if not rrepo.change_rental_vehicle(deal_id, body.vehicle_id):
        raise HTTPException(409, detail="no_cars")
    audit_service.record(user, "change_rental_vehicle", "rental", deal_id, body.vehicle_id)
    return {"ok": True}


@router.post("/{deal_id}/close")
def close(deal_id: str, body: CloseIn,
          user: dict = Depends(require("create_reservation"))) -> dict:
    r = rrepo.get_rental_full(deal_id)
    if not r:
        raise HTTPException(404, detail="not_found")
    rrepo.settle_and_close(
        deal_id, r["vehicle_id"], _cents(body.late_euros), _cents(body.damage_euros),
        body.return_notes.strip(), body.contract_signed,
    )
    audit_service.record(user, "close_rental", "rental", deal_id, r["vehicle_id"])
    return {"ok": True}


@router.post("/{deal_id}/cancel")
def cancel(deal_id: str, user: dict = Depends(require("cancel_reservation"))) -> dict:
    rrepo.cancel_rental(deal_id)
    audit_service.record(user, "cancel_rental", "rental", deal_id)
    return {"ok": True}
