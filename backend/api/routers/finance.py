"""Finance router — income/cost ledgers, P&L rollups, and the cost expense form.

Thin wrappers over services/finance_service.py (which joins the charges income
ledger with the vehicle_costs expense ledger) and data/repositories/vehicle_costs.py.
Reads are gated at `view_finance` (level 2); the cost-entry date is capped server-side
at `licensing_service.max_date()` so staff can't record into an unlicensed year; the
finance reset is super-admin only and wipes both ledgers via admin_ops.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel

from api.deps import require, require_level
from data.repositories import admin_ops, vehicle_costs as costs_repo, compensations as comp_repo
from services import audit_service, finance_service, licensing_service

router = APIRouter(prefix="/api/finance", tags=["finance"])


def _euros_to_cents(euros: float) -> int:
    return int(round(float(euros or 0) * 100))


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
    if _euros_to_cents(body.amount_euros) <= 0:
        raise HTTPException(400, detail="fields_required")
    licensing_service.assert_allowed(body.period_date, field="period_date")
    cost_type = body.cost_type if body.cost_type in costs_repo.COST_TYPES else "other"
    costs_repo.add_cost(body.vehicle_id, cost_type,
                        _euros_to_cents(body.amount_euros),
                        body.period_date, body.note.strip())
    audit_service.record(user, "add_cost", "vehicle", body.vehicle_id, cost_type)
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
    if _euros_to_cents(body.amount_euros) <= 0:
        raise HTTPException(400, detail="fields_required")
    licensing_service.assert_allowed(body.period_date, field="period_date")
    comp_type = body.comp_type if body.comp_type in comp_repo.COMPENSATION_TYPES else "other"
    comp_repo.add_compensation(body.vehicle_id, comp_type,
                               _euros_to_cents(body.amount_euros),
                               body.period_date, body.note.strip(), body.deal_id.strip() or None)
    audit_service.record(user, "add_compensation", "vehicle", body.vehicle_id, comp_type)
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
