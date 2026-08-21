"""Customers router — reads + edit / reassign / cascade-delete mutations.

Thin wrappers over data/repositories/customers.py + rentals.py + users.py and
data/repositories/admin_ops.py (the per-customer cascade). Mirrors the Streamlit
Customers card view: the edit form stores personal-info fields UPPERCASE, the
"Registered By" reassign identifies the rental and re-snapshots the booker, and
the super-admin delete cascades the customer + their rentals/charges. Every
mutation re-checks permissions server-side and audits.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import BaseModel

from api.deps import require, require_level
from data.repositories import admin_ops
from data.repositories import customers as crepo
from data.repositories import rentals as rrepo
from data.repositories import users as urepo
from services import audit_service

router = APIRouter(prefix="/api", tags=["customers"])

_SEARCH_FIELDS = ("full_name", "phone", "id_passport", "customer_id")


def _matches(c: dict, q: str) -> bool:
    ql = q.lower()
    return any(ql in str(c.get(k, "") or "").lower() for k in _SEARCH_FIELDS)


# Sort keys the Customers page's dropdown offers. `name` is A–Z; the other two
# are "biggest/newest first", which is what a front desk scanning a list wants.
# A customer with no rental yet has no date and no rate, so those rows always
# sink to the bottom instead of sorting as 0/"" — the `has_value` flag in each
# key does that, and full_name breaks every tie so the order is stable between
# identical requests (it has to be: the table pages this list server-side).
_SORTS = {
    "name": lambda c: (str(c.get("full_name") or "").upper(),),
    "start_date": lambda c: (0 if c.get("last_rental_date") else 1,
                             _desc_text(c.get("last_rental_date")),
                             str(c.get("full_name") or "").upper()),
    "price": lambda c: (0 if c.get("last_daily_rate") is not None else 1,
                        -int(c.get("last_daily_rate") or 0),
                        str(c.get("full_name") or "").upper()),
}


def _desc_text(value: object) -> str:
    """Sort an ISO date string DESCENDING inside an otherwise ascending key.
    Inverting each character's code point reverses the comparison without
    needing a second `reverse=` pass over a mixed-direction tuple."""
    return "".join(chr(0x10FFFF - ord(ch)) for ch in str(value or ""))


def _sorted(rows: list[dict], sort: str) -> list[dict]:
    """Order the customer list. An unknown key falls back to A–Z by name, so a
    stale or hand-typed `sort=` never returns an arbitrarily ordered page."""
    return sorted(rows, key=_SORTS.get(sort, _SORTS["name"]))


class CustomerIn(BaseModel):
    full_name: str
    phone: str = ""
    id_passport: str = ""


class ReassignIn(BaseModel):
    username: str


class DeleteIn(BaseModel):
    confirm: bool = False


# ── Reads ───────────────────────────────────────────────────────────────────
@router.get("/customers")
def list_customers(response: Response, q: str = "", sort: str = "name",
                   page: int = Query(1, ge=1), page_size: int = Query(0, ge=0),
                   user: dict = Depends(require("view_management"))) -> list[dict]:
    """See vehicles.py's `list_vehicles` for the pagination contract:
    `page_size=0` (default) is unchanged, unbounded behaviour; `page_size>0`
    slices post-filter and reports the true count via `X-Total-Count` (M5).

    `sort` is one of `name` / `start_date` / `price` and is applied BEFORE the
    page slice — sorting only the 25 rows of the current page would reorder a
    page rather than the list. The default `name` reproduces the repository's
    own `ORDER BY c.full_name`, so an unsorted caller sees no change."""
    rows = crepo.list_customers_enriched()
    if q.strip():
        rows = [c for c in rows if _matches(c, q.strip())]
    rows = _sorted(rows, sort)
    response.headers["X-Total-Count"] = str(len(rows))
    if page_size > 0:
        start = (page - 1) * page_size
        rows = rows[start:start + page_size]
    return rows


@router.get("/customers/{customer_id}")
def get_one(customer_id: int,
            user: dict = Depends(require("view_management"))) -> dict:
    c = crepo.get_customer(customer_id)
    if not c:
        raise HTTPException(404, detail="not_found")
    c["rentals"] = rrepo.list_rentals_for_customer(customer_id)
    return c


@router.get("/customers/{customer_id}/rentals")
def customer_rentals(customer_id: int,
                     user: dict = Depends(require("view_management"))) -> list[dict]:
    return rrepo.list_rentals_for_customer(customer_id)


# ── Mutations ───────────────────────────────────────────────────────────────
@router.put("/customers/{customer_id}")
def update_customer(customer_id: int, body: CustomerIn,
                    user: dict = Depends(require("service_vehicle"))) -> dict:
    if not body.full_name.strip():
        raise HTTPException(400, detail="fields_required")
    if not crepo.get_customer(customer_id):
        raise HTTPException(404, detail="not_found")
    crepo.update_customer(
        customer_id,
        body.full_name.strip().upper(),
        body.phone.strip().upper(),
        body.id_passport.strip().upper(),
    )
    audit_service.record(user, "edit_customer", "customer", str(customer_id),
                         body.full_name)
    return {"ok": True}


@router.put("/rentals/{deal_id}/reassign")
def reassign_rental(deal_id: str, body: ReassignIn,
                    user: dict = Depends(require_level(2))) -> dict:
    target = urepo.get_user(body.username)
    if not target:
        raise HTTPException(404, detail="not_found")
    rrepo.update_creator(deal_id, target["username"],
                         target.get("full_name", ""), target.get("role", ""))
    audit_service.record(user, "reassign_rental", "rental", deal_id, body.username)
    return {"ok": True}


@router.delete("/customers/{customer_id}")
def delete_customer(customer_id: int, body: DeleteIn,
                    user: dict = Depends(require_level(2))) -> dict:  # admin + super-admin
    if not body.confirm:
        raise HTTPException(400, detail="fields_required")
    if not crepo.get_customer(customer_id):
        raise HTTPException(404, detail="not_found")
    counts = admin_ops.delete_client(customer_id)
    audit_service.record(user, "delete_customer", "customer", str(customer_id))
    return {"ok": True, "counts": counts}
