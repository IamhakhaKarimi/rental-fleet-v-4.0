"""Vehicles + photos router — reads and mutations.

Thin wrappers over data/repositories/vehicles.py + vehicle_photos.py. Every
mutation re-checks permissions server-side and audits. The active-rental lock
(vehicle_has_active_rental) mirrors the Streamlit Fleet page: status can't be
changed while a car is out.
"""
from __future__ import annotations

import base64

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status as http
from pydantic import BaseModel

from api.deps import get_current_user, require, require_level
from config.roles import can
from data.repositories import rentals as rrepo
from data.repositories import vehicle_photos as vphotos
from data.repositories import vehicles as vrepo
from services import audit_service

router = APIRouter(prefix="/api/vehicles", tags=["vehicles"])

_EDITABLE_STATUSES = ["Available", "Maintenance"]
_SEARCH_FIELDS = ("vehicle_id", "make_model", "year", "license_plate",
                  "color", "status", "notes")


def _matches(v: dict, q: str) -> bool:
    ql = q.lower()
    return any(ql in str(v.get(k, "") or "").lower() for k in _SEARCH_FIELDS)


def _euros_to_cents(euros: float) -> int:
    return int(round(float(euros or 0) * 100))


class VehicleIn(BaseModel):
    make_model: str
    year: int | None = 2022
    license_plate: str = ""
    color: str = ""
    mileage: int = 0
    status: str = "Available"
    base_daily_rate_euros: float = 0
    notes: str = ""


class StatusIn(BaseModel):
    status: str


# ── Reads ───────────────────────────────────────────────────────────────────
@router.get("")
def list_vehicles(response: Response, q: str = "", include_deleted: bool = False,
                  page: int = Query(1, ge=1), page_size: int = Query(0, ge=0),
                  user: dict = Depends(require("view_fleet"))) -> list[dict]:
    """`page_size=0` (the default) returns everything, exactly as before this
    endpoint gained pagination — every existing caller (the card/carousel
    views, the `active`/`counts` shortcuts, mobile clients) is unaffected.
    `page_size>0` slices the list and reports the pre-slice count via
    `X-Total-Count` so a table view can build page controls (M5). The slice
    happens in Python, after the search filter below, because that filter
    already forces a full fetch — this bounds the RESPONSE, which is what
    was actually measured as unbounded, not the DB read (see DOCUMENTATION.md
    §8.2 M5 for why query cost itself wasn't the target here)."""
    rows = vrepo.list_vehicles(include_deleted=include_deleted)
    if q.strip():
        rows = [v for v in rows if _matches(v, q.strip())]
    # cheap per-row lock flag so the UI can disable status controls
    for v in rows:
        v["locked"] = rrepo.vehicle_has_active_rental(v["vehicle_id"])
    response.headers["X-Total-Count"] = str(len(rows))
    if page_size > 0:
        start = (page - 1) * page_size
        rows = rows[start:start + page_size]
    return rows


@router.get("/archived")
def archived(user: dict = Depends(require_level(2))) -> list[dict]:
    return [v for v in vrepo.list_vehicles(include_deleted=True) if v["status"] == "DELETED"]


@router.get("/active")
def active(user: dict = Depends(get_current_user)) -> list[dict]:
    return [{"vehicle_id": v["vehicle_id"], "make_model": v["make_model"],
             "license_plate": v.get("license_plate", "")}
            for v in vrepo.list_vehicles()]


@router.get("/counts")
def counts(user: dict = Depends(require("view_fleet"))) -> dict:
    return vrepo.fleet_counts()


@router.get("/thumbs/batch")
def thumbs_batch(ids: str = "",
                 user: dict = Depends(require("view_fleet"))) -> dict:
    """Batched primary-photo lookup: one request for a whole visible list of
    cards instead of one `GET .../thumb` per vehicle (M6). `ids` is a
    comma-separated vehicle_id list; capped defensively since it rides a GET
    query string. Values are raw base64 JPEG (or null) — the frontend builds
    its own `data:` URI, so this never needs to multiplex binary bodies."""
    vehicle_ids = [v.strip() for v in ids.split(",") if v.strip()][:300]
    return vphotos.primary_photos_for(vehicle_ids)


@router.get("/{vehicle_id}")
def get_one(vehicle_id: str, user: dict = Depends(require("service_vehicle"))) -> dict:
    v = vrepo.get_vehicle(vehicle_id)
    if not v:
        raise HTTPException(404, detail="not_found")
    v["locked"] = rrepo.vehicle_has_active_rental(vehicle_id)
    return v


@router.get("/{vehicle_id}/thumb")
def thumb(vehicle_id: str, v: str = "",
          user: dict = Depends(require("view_fleet"))) -> Response:
    b64 = vphotos.primary_photo(vehicle_id)
    if not b64:
        return Response(status_code=204)
    try:
        raw = base64.b64decode(b64)
    except Exception:
        return Response(status_code=204)
    return Response(content=raw, media_type="image/jpeg",
                    headers={"Cache-Control": "public, max-age=31536000, immutable"})


@router.get("/{vehicle_id}/photos")
def photos(vehicle_id: str, user: dict = Depends(require("service_vehicle"))) -> list[dict]:
    return vphotos.list_photos(vehicle_id)


@router.get("/{vehicle_id}/photos/version")
def photos_version(vehicle_id: str, user: dict = Depends(require("view_fleet"))) -> dict:
    return {"version": vphotos.photos_version(vehicle_id)}


# ── Mutations ───────────────────────────────────────────────────────────────
@router.post("", status_code=201)
def add_vehicle(body: VehicleIn, user: dict = Depends(require("edit_fleet"))) -> dict:
    if not body.make_model.strip():
        raise HTTPException(400, detail="fields_required")
    st = body.status if body.status in _EDITABLE_STATUSES else "Available"
    vid = vrepo.add_vehicle(
        body.make_model.strip(), body.year, body.license_plate.strip(),
        body.color.strip(), int(body.mileage or 0), st,
        _euros_to_cents(body.base_daily_rate_euros), body.notes.strip(),
    )
    audit_service.record(user, "add_vehicle", "vehicle", vid, body.make_model)
    return {"vehicle_id": vid}


@router.put("/{vehicle_id}")
def update_vehicle(vehicle_id: str, body: VehicleIn,
                   user: dict = Depends(require("service_vehicle"))) -> dict:
    cur = vrepo.get_vehicle(vehicle_id)
    if not cur:
        raise HTTPException(404, detail="not_found")
    if not body.make_model.strip():
        raise HTTPException(400, detail="fields_required")
    # Status is locked while the car has an active rental.
    locked = rrepo.vehicle_has_active_rental(vehicle_id)
    st = cur["status"] if locked else (
        body.status if body.status in _EDITABLE_STATUSES else cur["status"])
    vrepo.update_vehicle(
        vehicle_id, body.make_model.strip(), body.year, body.license_plate.strip(),
        body.color.strip(), int(body.mileage or 0), st,
        _euros_to_cents(body.base_daily_rate_euros), body.notes.strip(),
    )
    audit_service.record(user, "edit_vehicle", "vehicle", vehicle_id, body.make_model)
    return {"ok": True}


@router.post("/{vehicle_id}/status")
def set_status(vehicle_id: str, body: StatusIn,
               user: dict = Depends(require("service_vehicle"))) -> dict:
    if rrepo.vehicle_has_active_rental(vehicle_id):
        raise HTTPException(409, detail="status_locked_rented")
    if body.status == "In Garage" and not can(user, "edit_fleet"):
        raise HTTPException(403, detail="access_denied")
    if body.status not in ("Available", "Maintenance", "In Garage"):
        raise HTTPException(400, detail="fields_required")
    vrepo.set_status(vehicle_id, body.status)
    audit_service.record(user, "set_status", "vehicle", vehicle_id, body.status)
    return {"ok": True}


@router.post("/{vehicle_id}/archive")
def archive(vehicle_id: str, user: dict = Depends(require("soft_delete_vehicle"))) -> dict:
    vrepo.soft_delete(vehicle_id)
    audit_service.record(user, "archive_vehicle", "vehicle", vehicle_id)
    return {"ok": True}


@router.post("/{vehicle_id}/restore")
def restore(vehicle_id: str, user: dict = Depends(require_level(2))) -> dict:
    vrepo.restore_vehicle(vehicle_id)
    audit_service.record(user, "restore_vehicle", "vehicle", vehicle_id)
    return {"ok": True}


@router.delete("/{vehicle_id}")
def hard_delete(vehicle_id: str,
                user: dict = Depends(require("hard_delete_vehicle"))) -> dict:
    vrepo.hard_delete(vehicle_id)
    audit_service.record(user, "delete_vehicle", "vehicle", vehicle_id)
    return {"ok": True}
