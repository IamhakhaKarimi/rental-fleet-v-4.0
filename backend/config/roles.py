"""
Role-based access control (RBAC).

Four roles, from most to least powerful:
    super_admin > admin > employer > visitor

Permissions are derived from a minimum role level, so checking access is just
"is this user's level >= the level this action requires?". can(user, perm)
returns True/False and is the single function the rest of the app calls.
"""

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
    "assign_admin_roles": 3,    # only super_admin may grant admin/super_admin
    "hard_delete_vehicle": 3,   # only super_admin may permanently remove a car
    "edit_business_settings": 3,  # only super_admin may rename the business
}


def role_level(user: dict | None) -> int:
    if not user:
        return -1
    return ROLE_LEVEL.get(user.get("role", "visitor"), 0)


def can(user: dict | None, permission: str) -> bool:
    needed = PERMISSION_MIN_LEVEL.get(permission, 99)
    return role_level(user) >= needed


def assignable_roles(actor: dict) -> list[str]:
    """Which roles this user is allowed to grant to others."""
    if can(actor, "assign_admin_roles"):
        return ["super_admin", "admin", "employer", "visitor"]
    if can(actor, "manage_users"):
        return ["employer", "visitor"]
    return []
