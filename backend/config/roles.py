"""
Role-based access control (RBAC).

Four roles, from most to least powerful:
    super_admin > admin > employer > visitor

Permissions are derived from a minimum role level, so checking access is just
"is this user's level >= the level this action requires?". can(user, perm)
returns True/False and is the single function the rest of the app calls.

On top of that baseline sits an optional **override layer**: the Admin Panel lets
a super-admin (and, for the client-registration group only, an admin) grant or
revoke individual permissions per role. Overrides are stored in the database, but
this module stays free of DB imports — ``services/permissions_service.py`` injects
a provider via ``set_override_provider()`` at app startup. With no provider
installed (the Streamlit surface, tests, scripts) behaviour is exactly the
level-based baseline it always was.
"""

from typing import Callable

ROLES = ["super_admin", "admin", "employer", "visitor"]

ROLE_LEVEL = {"visitor": 0, "employer": 1, "admin": 2, "super_admin": 3}

# Friendly labels (translation keys live in i18n under the same role name).
ROLE_LABEL_KEY = {
    "super_admin": "role_super_admin",
    "admin": "role_admin",
    "employer": "role_employer",
    "visitor": "role_visitor",
}

# Each permission maps to the MINIMUM role level required.
PERMISSION_MIN_LEVEL = {
    "view_dashboard": 0,        # everyone
    "view_reservations": 0,     # everyone may look
    "view_fleet": 0,
    "view_management": 1,       # employer and up — gates the Reservations/Fleet/
                                # Customers pages so visitors see no management UI
    "create_reservation": 1,    # employer and up
    "cancel_reservation": 1,    # employer and up
    "service_vehicle": 1,       # employer and up — edit a vehicle + toggle its
                                # Maintenance/Available status (NOT Add / To-Garage /
                                # Delete, which stay admin-only via edit_fleet)
    "edit_fleet": 2,            # admin and up
    "soft_delete_vehicle": 2,   # admin and up (status -> DELETED)
    "view_finance": 2,          # admin and up
    "manage_users": 2,          # admin and up (create users, set role/active)
    "backup_database": 2,       # admin and up — export a full JSON backup / restore one
    "assign_admin_roles": 3,    # only super_admin may grant admin/super_admin
    "hard_delete_vehicle": 3,   # only super_admin may permanently remove a car
    "edit_business_settings": 3,  # only super_admin may rename the business
}

# ── Admin Panel metadata ─────────────────────────────────────────────────────
# Presentation grouping for the permission matrix. Order is the render order;
# every key in PERMISSION_MIN_LEVEL appears exactly once.
PERMISSION_GROUPS: list[tuple[str, list[str]]] = [
    ("general", [
        "view_dashboard",
    ]),
    ("client_registration", [
        "view_management",
        "view_reservations",
        "create_reservation",
        "cancel_reservation",
    ]),
    ("fleet", [
        "view_fleet",
        "service_vehicle",
        "edit_fleet",
        "soft_delete_vehicle",
    ]),
    ("finance", [
        "view_finance",
    ]),
    ("administration", [
        "manage_users",
        "backup_database",
        "assign_admin_roles",
        "hard_delete_vehicle",
        "edit_business_settings",
    ]),
]

GROUP_LABEL_KEY = {key: f"permgroup_{key}" for key, _ in PERMISSION_GROUPS}
PERMISSION_LABEL_KEY = {perm: f"perm_{perm}" for perm in PERMISSION_MIN_LEVEL}
GROUP_OF = {perm: key for key, perms in PERMISSION_GROUPS for perm in perms}

# Permissions that may NEVER be overridden — they are the ones that decide who
# administers the system. Making them togglable would let an admin grant
# themselves super-admin powers, or let a super-admin revoke the very permission
# needed to undo the change and lock everyone out of the panel.
LOCKED_PERMISSIONS = frozenset(dict(PERMISSION_GROUPS)["administration"])

# The only group a plain admin (not super_admin) may adjust: what an Agent is
# allowed to do around registering clients and their bookings.
ADMIN_EDITABLE_GROUPS = frozenset({"client_registration"})

# super_admin's row is fixed at "everything" and is never stored or editable.
OVERRIDABLE_ROLES = ["admin", "employer", "visitor"]


# ── Override provider (installed by services/permissions_service) ────────────
_override_provider: Callable[[], dict] | None = None


def set_override_provider(provider: Callable[[], dict] | None) -> None:
    """Install the callable that returns ``{role: {permission: bool}}``.

    Kept as an injected hook rather than a direct import so this config module
    never depends on the data layer (Routers -> Services -> Repositories -> DB).
    """
    global _override_provider
    _override_provider = provider


def _overrides() -> dict:
    if _override_provider is None:
        return {}
    try:
        return _override_provider() or {}
    except Exception:
        # A broken/unreadable override store must degrade to the baseline rules,
        # never to "access denied for everyone".
        return {}


def role_level(user: dict | None) -> int:
    if not user:
        return -1
    return ROLE_LEVEL.get(user.get("role", "visitor"), 0)


def base_can(role: str, permission: str) -> bool:
    """The level-only answer, ignoring any stored override."""
    needed = PERMISSION_MIN_LEVEL.get(permission)
    if needed is None:
        return False
    return ROLE_LEVEL.get(role, 0) >= needed


def can(user: dict | None, permission: str) -> bool:
    if not user or permission not in PERMISSION_MIN_LEVEL:
        return False
    role = user.get("role", "visitor")
    # A super-admin always holds every permission — the override layer can never
    # take one away, so the panel can't be used to lock the owner out.
    if role == "super_admin":
        return True
    if permission in LOCKED_PERMISSIONS:
        return base_can(role, permission)
    override = _overrides().get(role, {})
    if permission in override:
        return bool(override[permission])
    return base_can(role, permission)


def assignable_roles(actor: dict) -> list[str]:
    """Which roles this user is allowed to grant to others."""
    if can(actor, "assign_admin_roles"):
        return ["super_admin", "admin", "employer", "visitor"]
    if can(actor, "manage_users"):
        return ["employer", "visitor"]
    return []
