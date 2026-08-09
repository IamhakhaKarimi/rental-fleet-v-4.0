"""Finance router — income/cost ledgers, P&L rollups, and the cost expense form.

Thin wrappers over services/finance_service.py (which joins the charges income
ledger with the vehicle_costs expense ledger) and data/repositories/vehicle_costs.py.
Reads are gated at `view_finance` (level 2); the cost-entry date is capped server-side
at `licensing_service.max_date()` so staff can't record into an unlicensed year; the
finance reset is super-admin only and wipes both ledgers via admin_ops.
"""
from __future__ import annotations

import re

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from api.deps import require, require_level
from data.repositories import admin_ops, vehicle_costs as costs_repo, compensations as comp_repo
from data.repositories import vehicles as vehicles_repo
from services import audit_service, finance_service, licensing_service

router = APIRouter(prefix="/api/finance", tags=["finance"])

# ── Ledger-entry validation ──────────────────────────────────────────────────
# Every field the Costs/Compensation forms submit is checked here before it
# ever reaches a SQL statement. Queries are parameterized (SQLAlchemy `text()`
# bound params) everywhere in this codebase, so string concatenation-style SQL
# injection is not reachable through these fields regardless — this layer's
# job is data QUALITY: reject the wrong shape of data outright instead of
# silently coercing it (e.g. an unknown cost_type used to fall back to
# "other", which let junk into the ledger unnoticed).
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_DEAL_ID_RE = re.compile(r"^RENT-\d{6}-\d{3}$")
_NOTE_MAX_LEN = 300
_AMOUNT_MAX_EUROS = 1_000_000


def _clean_ledger_fields(vehicle_id: str, entry_type: str, allowed_types: list[str],
                         amount_euros: float, period_date: str, note: str) -> tuple[str, int, str]:
    """Shared validation for the cost + compensation add/update bodies.

    Returns (vehicle_id, amount_cents, note) once every field checks out, or
    raises HTTPException(400, detail=<i18n key>) on the first violation —
    matching this router's existing "fields_required" convention so the
    frontend's `tx(e?.key, fallback)` idiom keeps working unchanged.
    """
    vehicle_id = (vehicle_id or "").strip().upper()
    if not vehicle_id or len(vehicle_id) > 20:
        raise HTTPException(400, detail="fields_required")
    if not vehicles_repo.get_vehicle(vehicle_id):
        raise HTTPException(400, detail="invalid_vehicle")

    if entry_type not in allowed_types:
        raise HTTPException(400, detail="invalid_type")

    if not _DATE_RE.match((period_date or "").strip()):
        raise HTTPException(400, detail="invalid_date")

    try:
        amount = float(amount_euros)
    except (TypeError, ValueError):
        raise HTTPException(400, detail="invalid_amount")
    if amount != amount or amount in (float("inf"), float("-inf")):  # NaN / inf
        raise HTTPException(400, detail="invalid_amount")
    cents = int(round(amount * 100))
    if cents <= 0:
        raise HTTPException(400, detail="fields_required")
    if cents > _AMOUNT_MAX_EUROS * 100:
        raise HTTPException(400, detail="amount_too_large")

    note = (note or "").strip()
    if len(note) > _NOTE_MAX_LEN:
        raise HTTPException(400, detail="note_too_long")

    return vehicle_id, cents, note


class CostIn(BaseModel):
    vehicle_id: str
    cost_type: str = "other"
    amount_euros: float = 0
    period_date: str
    note: str = ""


class CompensationIn(BaseModel):
    vehicle_id: str
    comp_type: str = "other"
    amount_euros: float = 0
    period_date: str
    note: str = ""
    deal_id: str = ""


class ResetIn(BaseModel):
    confirm: str = ""


# ── Summaries ────────────────────────────────────────────────────────────────
@router.get("/summary")
def summary(user: dict = Depends(require("view_finance"))) -> dict:
    income = finance_service.revenue_summary()["total"]
    cost = finance_service.cost_total()
    net = income - cost
    margin = round(net / income * 100, 1) if income else 0.0
    return {"income": income, "cost": cost, "net": net, "margin": margin}


@router.get("/revenue-summary")
def revenue_summary(user: dict = Depends(require("view_finance"))) -> dict:
    return finance_service.revenue_summary()


@router.get("/cost-by-type")
def cost_by_type(user: dict = Depends(require("view_finance"))) -> list[dict]:
    return finance_service.cost_by_type()


# ── P&L rollups ──────────────────────────────────────────────────────────────
@router.get("/pnl/monthly")
def pnl_monthly(user: dict = Depends(require("view_finance"))) -> list[dict]:
    return finance_service.pnl_by_month()


@router.get("/pnl/yearly")
def pnl_yearly(user: dict = Depends(require("view_finance"))) -> list[dict]:
    return finance_service.pnl_by_year()


@router.get("/month-breakdown/{month}")
def month_breakdown(month: str, user: dict = Depends(require("view_finance"))) -> dict:
    return finance_service.month_breakdown(month)


@router.get("/profit-by-vehicle")
def profit_by_vehicle(user: dict = Depends(require("view_finance"))) -> list[dict]:
    return finance_service.profit_by_vehicle()


@router.get("/revenue-by-customer")
def revenue_by_customer(user: dict = Depends(require("view_finance"))) -> list[dict]:
    return finance_service.revenue_by_customer()


# ── Costs ledger ─────────────────────────────────────────────────────────────
@router.get("/costs")
def costs(limit: int = 100, user: dict = Depends(require("view_finance"))) -> list[dict]:
    return costs_repo.list_costs(limit)


@router.get("/cost-total")
def cost_total(user: dict = Depends(require("view_finance"))) -> dict:
    return {"total": finance_service.cost_total()}


@router.post("/costs", status_code=201)
def add_cost(body: CostIn, user: dict = Depends(require("view_finance"))) -> dict:
    vehicle_id, cents, note = _clean_ledger_fields(
        body.vehicle_id, body.cost_type, costs_repo.COST_TYPES,
        body.amount_euros, body.period_date, body.note)
    licensing_service.assert_allowed(body.period_date, field="period_date")
    costs_repo.add_cost(vehicle_id, body.cost_type, cents, body.period_date, note)
    audit_service.record(user, "add_cost", "vehicle", vehicle_id, body.cost_type)
    return {"ok": True}


@router.put("/costs/{cost_id}")
def update_cost(cost_id: int, body: CostIn, user: dict = Depends(require("view_finance"))) -> dict:
    vehicle_id, cents, note = _clean_ledger_fields(
        body.vehicle_id, body.cost_type, costs_repo.COST_TYPES,
        body.amount_euros, body.period_date, body.note)
    licensing_service.assert_allowed(body.period_date, field="period_date")
    costs_repo.update_cost(cost_id, vehicle_id, body.cost_type, cents, body.period_date, note)
    audit_service.record(user, "update_cost", "vehicle_cost", str(cost_id), body.cost_type)
    return {"ok": True}


@router.delete("/costs/{cost_id}", status_code=204)
def delete_cost(cost_id: int, user: dict = Depends(require("view_finance"))) -> Response:
    costs_repo.delete_cost(cost_id)
    audit_service.record(user, "delete_cost", "vehicle_cost", str(cost_id))
    return Response(status_code=204)


# ── Damage compensation ledger (money billed back to a client) ─────────────────
@router.get("/compensations")
def compensations(limit: int = 100, user: dict = Depends(require("view_finance"))) -> list[dict]:
    return comp_repo.list_compensations(limit)


@router.get("/compensation-total")
def compensation_total(user: dict = Depends(require("view_finance"))) -> dict:
    return {"total": comp_repo.compensation_total()}


@router.post("/compensations", status_code=201)
def add_compensation(body: CompensationIn, user: dict = Depends(require("view_finance"))) -> dict:
    vehicle_id, cents, note = _clean_ledger_fields(
        body.vehicle_id, body.comp_type, comp_repo.COMPENSATION_TYPES,
        body.amount_euros, body.period_date, body.note)
    deal_id = body.deal_id.strip().upper() or None
    if deal_id and not _DEAL_ID_RE.match(deal_id):
        raise HTTPException(400, detail="invalid_deal_id")
    licensing_service.assert_allowed(body.period_date, field="period_date")
    comp_repo.add_compensation(vehicle_id, body.comp_type, cents, body.period_date, note, deal_id)
    audit_service.record(user, "add_compensation", "vehicle", vehicle_id, body.comp_type)
    return {"ok": True}


@router.put("/compensations/{charge_id}")
def update_compensation(charge_id: int, body: CompensationIn, user: dict = Depends(require("view_finance"))) -> dict:
    vehicle_id, cents, note = _clean_ledger_fields(
        body.vehicle_id, body.comp_type, comp_repo.COMPENSATION_TYPES,
        body.amount_euros, body.period_date, body.note)
    deal_id = body.deal_id.strip().upper() or None
    if deal_id and not _DEAL_ID_RE.match(deal_id):
        raise HTTPException(400, detail="invalid_deal_id")
    licensing_service.assert_allowed(body.period_date, field="period_date")
    comp_repo.update_compensation(charge_id, vehicle_id, body.comp_type, cents,
                                  body.period_date, note, deal_id)
    audit_service.record(user, "update_compensation", "charge", str(charge_id), body.comp_type)
    return {"ok": True}


@router.delete("/compensations/{charge_id}", status_code=204)
def delete_compensation(charge_id: int, user: dict = Depends(require("view_finance"))) -> Response:
    comp_repo.delete_compensation(charge_id)
    audit_service.record(user, "delete_compensation", "charge", str(charge_id))
    return Response(status_code=204)


# ── Reset (super-admin) ──────────────────────────────────────────────────────
@router.post("/reset")
def reset(body: ResetIn, user: dict = Depends(require_level(3))) -> dict:
    if body.confirm.strip().upper() != "RESET":
        raise HTTPException(400, detail="fields_required")
    counts = admin_ops.reset_finance()
    audit_service.record(user, "reset_finance", "finance", "", str(counts))
    return counts
