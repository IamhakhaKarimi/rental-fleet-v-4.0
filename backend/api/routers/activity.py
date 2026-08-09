"""Activity (audit-log) router — admin+ only.

Thin wrappers over services/audit_service.py (recent) plus the vehicles/rentals
repositories for the "return" (undo) actions. Mirrors the Streamlit
Settings -> Activity tab:
  - actors ranked STRICTLY above the viewer's role level are masked as the i18n
    key "system_admin_label"; equal-rank actors show by username;
  - undoable items are DELETED vehicles (restore) and Closed rentals (reactivate).

Every route is gated by require("manage_users") (admin level 2+). Mutations audit.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from api.deps import require
from config.roles import ROLE_LEVEL
from data.repositories import compensations as comp_repo
from data.repositories import rentals as rrepo
from data.repositories import users as users_repo
from data.repositories import vehicle_costs as costs_repo
from data.repositories import vehicles as vrepo
from services import audit_service

router = APIRouter(prefix="/api/activity", tags=["activity"])

_MASK_KEY = "system_admin_label"


def _role_level(role: str) -> int:
    return ROLE_LEVEL.get(role or "visitor", 0)


# ── Reads ───────────────────────────────────────────────────────────────────
@router.get("")
def activity(user: dict = Depends(require("manage_users"))) -> dict:
    """Recent audit rows with actors above the viewer masked as system_admin_label."""
    viewer_level = _role_level(user.get("role", "visitor"))
    rows = audit_service.recent(500)

    role_cache: dict[str, int] = {}

    def _masked_name(username: str) -> str:
        """Replace the displayed name when the actor outranks the viewer."""
        if not username:
            return username
        if username not in role_cache:
            actor = users_repo.get_user(username)
            role_cache[username] = _role_level((actor or {}).get("role", "visitor"))
        return _MASK_KEY if role_cache[username] > viewer_level else username

    out: list[dict] = []
    seen_actions: list[str] = []
    seen_users: list[str] = []
    for r in rows:
        ts = (r.get("ts") or "")[:19].replace("T", " ")
        masked = _masked_name(r.get("username", "") or "")
        action = r.get("action", "") or ""
        if action and action not in seen_actions:
            seen_actions.append(action)
        if masked and masked not in seen_users:
            seen_users.append(masked)
        out.append({
            "id": r.get("id"),
            "ts": ts,
            "username": masked,
            "action": action,
            "entity": r.get("entity", "") or "",
            "entity_id": r.get("entity_id", "") or "",
            "detail": r.get("detail", "") or "",
        })
    return {"rows": out, "actions": seen_actions, "users": seen_users}


@router.get("/returnable")
def returnable(user: dict = Depends(require("manage_users"))) -> list[dict]:
    """Undoable items: DELETED (archived) vehicles, Closed (cancelled) rentals,
    and soft-deleted finance costs/compensations."""
    # "entity" mirrors the entity type audit_service.record() was called with for
    # that action, so the frontend can match a log row to a returnable item by
    # (entity, entity_id) instead of entity_id alone — cost_id and charge_id are
    # both plain autoincrement ints and would otherwise collide.
    items: list[dict] = []
    for v in vrepo.list_vehicles(include_deleted=True):
        if v.get("status") == "DELETED":
            label = f"{v['vehicle_id']} · {v.get('make_model', '') or ''}".strip(" ·")
            items.append({"kind": "vehicle", "entity": "vehicle", "entity_id": v["vehicle_id"], "label": label})
    for r in rrepo.list_all_rentals():
        if r.get("status") == "Closed":
            client = r.get("client_name", "") or ""
            model = r.get("make_model", "") or ""
            label = f"{r['deal_id']} · {client} · {model}".strip(" ·")
            items.append({"kind": "rental", "entity": "rental", "entity_id": r["deal_id"], "label": label})
    for c in costs_repo.list_deleted_costs():
        label = f"{c['type']} · {c.get('make_model', '') or c['vehicle_id']} · {c['amount'] / 100:.2f}€"
        items.append({"kind": "cost", "entity": "vehicle_cost", "entity_id": str(c["cost_id"]), "label": label})
    for c in comp_repo.list_deleted_compensations():
        label = f"{c['type']} · {c.get('make_model', '') or c['vehicle_id']} · {c['amount'] / 100:.2f}€"
        items.append({"kind": "compensation", "entity": "charge", "entity_id": str(c["charge_id"]), "label": label})
    return items


# ── Mutations (undo) ─────────────────────────────────────────────────────────
@router.post("/return/vehicle/{vehicle_id}")
def return_vehicle(vehicle_id: str,
                   user: dict = Depends(require("manage_users"))) -> dict:
    vrepo.restore_vehicle(vehicle_id)
    audit_service.record(user, "return_vehicle", "vehicle", vehicle_id)
    return {"ok": True}


@router.post("/return/rental/{deal_id}")
def return_rental(deal_id: str,
                  user: dict = Depends(require("manage_users"))) -> dict:
    if not rrepo.reactivate_rental(deal_id):
        raise HTTPException(409, detail="not_available_window")
    audit_service.record(user, "return_rental", "rental", deal_id)
    return {"ok": True}


@router.post("/return/cost/{cost_id}")
def return_cost(cost_id: int,
                user: dict = Depends(require("manage_users"))) -> dict:
    if not costs_repo.get_cost(cost_id):
        raise HTTPException(404, detail="not_found")
    costs_repo.restore_cost(cost_id)
    audit_service.record(user, "return_cost", "vehicle_cost", str(cost_id))
    return {"ok": True}


@router.post("/return/compensation/{charge_id}")
def return_compensation(charge_id: int,
                        user: dict = Depends(require("manage_users"))) -> dict:
    if not comp_repo.get_compensation(charge_id):
        raise HTTPException(404, detail="not_found")
    comp_repo.restore_compensation(charge_id)
    audit_service.record(user, "return_compensation", "charge", str(charge_id))
    return {"ok": True}
