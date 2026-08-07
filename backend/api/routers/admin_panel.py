"""Admin Panel router — the role/permission matrix behind ``/admin``.

Two audiences, one endpoint set:

  * **super_admin** (``assign_admin_roles``) sees the full matrix: every role
    except their own, every permission except the locked administration group.
  * **admin** (``manage_users``) sees the minimal view — the client-registration
    group only, for the roles below them. That's the "manage the Agent's access
    over the executive commands of client registration" case.

The scope decision lives in ``services/permissions_service``; this layer only
turns it into JSON and HTTP status codes, and records the audit entry. Staff
listing is NOT duplicated here — the panel reuses ``GET /api/users``.
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status as http
from pydantic import BaseModel

from api.deps import require
from config.roles import (
    GROUP_LABEL_KEY,
    LOCKED_PERMISSIONS,
    PERMISSION_GROUPS,
    PERMISSION_LABEL_KEY,
    PERMISSION_MIN_LEVEL,
    ROLE_LABEL_KEY,
    ROLE_LEVEL,
    ROLES,
)
from services import audit_service, permissions_service as perms

router = APIRouter(prefix="/api/admin", tags=["admin-panel"])


class PermissionChangesIn(BaseModel):
    # {role: {permission: bool}} — only the cells the operator actually toggled.
    changes: dict[str, dict[str, bool]]


def _payload(actor: dict) -> dict:
    effective = perms.effective_matrix()
    defaults = perms.default_matrix()
    stored = perms.load_overrides()
    full = perms.is_full_scope(actor)
    editable_roles = perms.editable_roles(actor)
    editable_perms = set(perms.editable_permissions(actor))
    # A super-admin also *sees* the locked administration rows (read-only, so the
    # matrix is a complete picture of the RBAC model); an admin sees only their
    # own editable slice.
    visible_perms = editable_perms | set(LOCKED_PERMISSIONS) if full else editable_perms

    groups = []
    for key, group_perms in PERMISSION_GROUPS:
        rows = [
            {
                "permission": p,
                "label_key": PERMISSION_LABEL_KEY[p],
                "min_level": PERMISSION_MIN_LEVEL[p],
                "locked": p in LOCKED_PERMISSIONS,
                "editable": p in editable_perms,
            }
            for p in group_perms
            if p in visible_perms
        ]
        if rows:
            groups.append({"group": key, "label_key": GROUP_LABEL_KEY[key], "permissions": rows})

    return {
        # Columns, most-privileged first, matching the Users tab's ordering.
        "roles": [
            {
                "role": r,
                "label_key": ROLE_LABEL_KEY[r],
                "level": ROLE_LEVEL[r],
                "editable": r in editable_roles,
            }
            for r in ROLES
            if perms.is_full_scope(actor) or r in editable_roles
        ],
        "groups": groups,
        "matrix": effective,
        "defaults": defaults,
        # Which cells currently deviate from the shipped baseline, so the UI can
        # mark them without recomputing the comparison client-side.
        "overrides": {role: sorted(row) for role, row in stored.items()},
        "scope": "full" if perms.is_full_scope(actor) else "minimal",
        "actor_role": actor.get("role", ""),
    }


@router.get("/permissions")
def get_permissions(actor: dict = Depends(require("manage_users"))) -> dict:
    return _payload(actor)


@router.put("/permissions")
def put_permissions(body: PermissionChangesIn,
                    actor: dict = Depends(require("manage_users"))) -> dict:
    ok, msg = perms.save_overrides(actor, body.changes)
    if not ok:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, detail=msg)
    touched = ", ".join(
        f"{role}:{perm}={'on' if value else 'off'}"
        for role, row in sorted(body.changes.items())
        for perm, value in sorted(row.items())
    )
    audit_service.record(actor, "set_role_permissions", "role", "matrix", touched)
    return _payload(actor)


@router.post("/permissions/reset")
def reset_permissions(actor: dict = Depends(require("manage_users"))) -> dict:
    ok, msg = perms.reset_overrides(actor)
    if not ok:
        raise HTTPException(http.HTTP_400_BAD_REQUEST, detail=msg)
    audit_service.record(actor, "reset_role_permissions", "role", "matrix")
    return _payload(actor)
