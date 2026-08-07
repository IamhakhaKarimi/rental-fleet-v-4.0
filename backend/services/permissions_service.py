"""
Role/permission overrides — the business logic behind the Admin Panel.

``config/roles.py`` defines the level-based baseline and stays DB-free; this
service owns the *stored* deviations from it and installs itself as that module's
override provider at startup (``install()``).

Storage is a single JSON blob in ``app_settings`` under ``role_permission_overrides``:

    {"employer": {"cancel_reservation": false}, "visitor": {"view_fleet": false}}

Only deviations are written, so an untouched install stores nothing and behaves
exactly as it did before this layer existed.

Scope rules enforced here (the router only translates them to HTTP):
  * ``super_admin``'s row is fixed at "everything" — never stored, never editable.
  * Permissions in ``LOCKED_PERMISSIONS`` (the administration group) are never
    overridable, for anyone — that's the anti-lockout / anti-escalation rule.
  * A super-admin may edit every other permission for admin / employer / visitor.
  * A plain admin may edit only ``ADMIN_EDITABLE_GROUPS`` (client registration),
    only for roles ranked below them, and only for permissions they hold
    themselves — nobody can grant what they don't have.
"""
from __future__ import annotations

import json
import time

from config.roles import (
    ADMIN_EDITABLE_GROUPS,
    GROUP_OF,
    LOCKED_PERMISSIONS,
    OVERRIDABLE_ROLES,
    PERMISSION_MIN_LEVEL,
    ROLE_LEVEL,
    base_can,
    can,
    set_override_provider,
)
from data.repositories import app_settings as app_cfg

OVERRIDES_KEY = "role_permission_overrides"

# can() runs on every authenticated request, so the blob is cached rather than
# re-read per check. The TTL bounds how long a saved change takes to reach other
# processes; save_overrides() clears the local cache immediately.
_TTL_SECONDS = 5.0
_cache: dict = {"at": 0.0, "data": {}}


# ── Read ─────────────────────────────────────────────────────────────────────
def _sanitize(parsed: object) -> dict[str, dict[str, bool]]:
    """Drop anything unknown or forbidden, so a hand-edited/stale row can never
    widen access beyond what the panel itself allows."""
    out: dict[str, dict[str, bool]] = {}
    if not isinstance(parsed, dict):
        return out
    for role, perms in parsed.items():
        if role not in OVERRIDABLE_ROLES or not isinstance(perms, dict):
            continue
        clean = {
            p: bool(v)
            for p, v in perms.items()
            if p in PERMISSION_MIN_LEVEL and p not in LOCKED_PERMISSIONS
        }
        if clean:
            out[role] = clean
    return out


def load_overrides(force: bool = False) -> dict[str, dict[str, bool]]:
    now = time.monotonic()
    if not force and (now - _cache["at"]) < _TTL_SECONDS:
        return _cache["data"]
    raw = app_cfg.get_setting(OVERRIDES_KEY, "")
    data: dict[str, dict[str, bool]] = {}
    if raw:
        try:
            data = _sanitize(json.loads(raw))
        except Exception:
            data = {}
    _cache["at"] = now
    _cache["data"] = data
    return data


def install() -> None:
    """Wire this service in as config.roles' override provider (called once at
    app startup, after the DB is initialised)."""
    set_override_provider(load_overrides)


# ── Matrices ─────────────────────────────────────────────────────────────────
def default_matrix() -> dict[str, dict[str, bool]]:
    """The shipped baseline — level rules only, no overrides."""
    return {
        role: {perm: base_can(role, perm) for perm in PERMISSION_MIN_LEVEL}
        for role in ROLE_LEVEL
    }


def effective_matrix() -> dict[str, dict[str, bool]]:
    """What ``can()`` will actually answer for each role right now."""
    return {
        role: {perm: can({"role": role}, perm) for perm in PERMISSION_MIN_LEVEL}
        for role in ROLE_LEVEL
    }


# ── Scope ────────────────────────────────────────────────────────────────────
def is_full_scope(actor: dict) -> bool:
    """A super-admin gets the whole matrix; an admin gets the minimal view."""
    return can(actor, "assign_admin_roles")


def editable_roles(actor: dict) -> list[str]:
    """Roles ranked strictly below the actor, that also carry a stored row."""
    level = ROLE_LEVEL.get(actor.get("role", "visitor"), 0)
    return [r for r in OVERRIDABLE_ROLES if ROLE_LEVEL[r] < level]


def editable_permissions(actor: dict) -> list[str]:
    if is_full_scope(actor):
        return [p for p in PERMISSION_MIN_LEVEL if p not in LOCKED_PERMISSIONS]
    return [
        p
        for p in PERMISSION_MIN_LEVEL
        if p not in LOCKED_PERMISSIONS
        and GROUP_OF.get(p) in ADMIN_EDITABLE_GROUPS
        and can(actor, p)  # never grant what the actor doesn't hold
    ]


def can_edit(actor: dict, role: str, permission: str) -> bool:
    return role in editable_roles(actor) and permission in editable_permissions(actor)


# ── Write ────────────────────────────────────────────────────────────────────
def save_overrides(actor: dict, changes: dict) -> tuple[bool, str]:
    """Apply ``{role: {permission: bool}}`` on top of what's stored.

    Returns ``(ok, msg)`` in the same shape as auth_service, where ``msg`` is an
    i18n key on failure. Rejects the whole payload if any single entry is out of
    scope — a partially applied permission change is worse than none.
    """
    if not isinstance(changes, dict) or not changes:
        return False, "fields_required"

    allowed_roles = set(editable_roles(actor))
    allowed_perms = set(editable_permissions(actor))

    for role, perms in changes.items():
        if role not in allowed_roles or not isinstance(perms, dict):
            return False, "role_not_allowed"
        for perm in perms:
            if perm not in PERMISSION_MIN_LEVEL:
                return False, "fields_required"
            if perm not in allowed_perms:
                return False, "access_denied"

    stored = dict((r, dict(p)) for r, p in load_overrides(force=True).items())
    for role, perms in changes.items():
        row = stored.setdefault(role, {})
        for perm, value in perms.items():
            # Storing only deviations keeps the blob small and, more usefully,
            # means a permission returned to its default stops being pinned — so
            # later changes to the shipped baseline still reach that role.
            if bool(value) == base_can(role, perm):
                row.pop(perm, None)
            else:
                row[perm] = bool(value)
        if not row:
            stored.pop(role, None)

    _persist(stored)
    return True, "saved"


def reset_overrides(actor: dict) -> tuple[bool, str]:
    """Clear every override the actor is allowed to touch (a super-admin clears
    the lot; an admin only clears their own narrow slice)."""
    if is_full_scope(actor):
        _persist({})
        return True, "saved"

    allowed_roles = set(editable_roles(actor))
    allowed_perms = set(editable_permissions(actor))
    stored = dict((r, dict(p)) for r, p in load_overrides(force=True).items())
    for role in list(stored):
        if role not in allowed_roles:
            continue
        stored[role] = {p: v for p, v in stored[role].items() if p not in allowed_perms}
        if not stored[role]:
            stored.pop(role)
    _persist(stored)
    return True, "saved"


def _persist(data: dict) -> None:
    app_cfg.set_setting(OVERRIDES_KEY, json.dumps(data, sort_keys=True) if data else "")
    # Drop the cache so the very next can() in this process sees the new rules
    # instead of waiting out the TTL.
    _cache["at"] = 0.0
    _cache["data"] = {}
