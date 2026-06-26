"""Notifications router — overdue + due-soon returns for the top-bar bell.

Mirrors ui/notifications: classify each active rental via return_state, sort
overdue by most-late and due-soon by soonest, and surface a badge count.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends

from api.deps import require
from data.repositories import rentals as rrepo
from services import scheduling_service as sched

router = APIRouter(prefix="/api", tags=["notifications"])


@router.get("/notifications")
def notifications(user: dict = Depends(require("create_reservation"))) -> dict:
    overdue, due_soon = [], []
    for r in rrepo.list_active_rentals_with_vehicle():
        state, hours = sched.return_state(r["end_dt"])
        item = {
            "deal_id": r["deal_id"],
            "vehicle_id": r["vehicle_id"],
            "make_model": r["make_model"],
            "client_name": r["client_name"],
            "phone": r.get("phone", ""),
            "end_dt": r["end_dt"],
            "hours": round(hours, 1),
        }
        if state == "overdue":
            overdue.append(item)
        elif state == "due_soon":
            due_soon.append(item)
    overdue.sort(key=lambda x: -x["hours"])
    due_soon.sort(key=lambda x: x["hours"])
    return {
        "badge": len(overdue) + len(due_soon),
        "overdue": overdue,
        "due_soon": due_soon,
        "due_soon_hours": sched.DUE_SOON_HOURS,
    }
