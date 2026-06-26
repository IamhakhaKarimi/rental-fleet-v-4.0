"""
Central configuration for the Balkan Car Rentals fleet console.

Everything that other modules need to agree on lives here: where the database
file is, what the brand is called, which currency we use, and the canonical
list of vehicle/rental statuses. Keeping these in one place means a change
(e.g. switching currency) happens once, not in twenty files.
"""

from pathlib import Path

# --- Project paths -----------------------------------------------------------
# BASE_DIR is the project root (the folder that contains app.py).
BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "fleet.db"                 # SQLite database file (created on first run)
SEED_CSV = BASE_DIR / "fleet_master.csv"        # one-time vehicle seed source

# --- Brand -------------------------------------------------------------------
APP_NAME = "Balkan Car Rentals"
APP_TAGLINE = "Fleet Console"
APP_VERSION = "3.2"
PAGE_ICON = "🚗"

# --- Languages ---------------------------------------------------------------
# Canonical set of selectable UI languages → display label (flag + endonym).
# Lives here (a Streamlit-free module) so the service layer can validate a
# language code without importing the i18n module (which imports Streamlit).
# Albanian (sq) is offered only to staff "parent" roles (super_admin / admin /
# employer); see STAFF_ONLY_LANGS and the per-role filtering in the UI.
LANGUAGES = {
    "tr": "🇹🇷 Türkçe",
    "en": "🇬🇧 English",
    "de": "🇩🇪 Deutsch",
    "it": "🇮🇹 Italiano",
    "es": "🇪🇸 Español",
    "sq": "🇦🇱 Shqip",
}
STAFF_ONLY_LANGS = {"sq"}
# Fallback UI/invoice language. Lives here (Streamlit-free) so the service and
# data layers can validate/normalise a language without importing Streamlit.
DEFAULT_LANG = "tr"

# --- Currency ----------------------------------------------------------------
# All money is stored in the database as INTEGER cents and only converted to a
# human string at display time. This avoids floating-point rounding drift.
CURRENCY_SYMBOL = "€"
CURRENCY_CODE = "EUR"

# --- Status vocabularies (must match the CHECK constraints in schema.sql) -----
VEHICLE_STATUSES = ["Available", "Rented", "In Garage", "Maintenance", "DELETED"]
RENTAL_STATUSES = ["Active", "Closed"]

# Status -> design token name (resolved to a color in ui/theme.py).
# NOTE: "Overdue" is NOT a stored vehicle status — it is a *derived* state
# (a rental whose end_dt is in the past). It lives here only so the timeline and
# reservation cards can colour overdue items red. See VEHICLE_STATUSES above for
# the values actually persisted in the database.
STATUS_TOKEN = {
    "Available": "ok",
    "Rented": "info",
    "In Garage": "warn",
    "Maintenance": "warn",
    "DELETED": "archived",
    "Overdue": "danger",  # derived, not stored
}

# Default booking values
DEFAULT_PICKUP_HOUR = 10        # 10:00 default pick-up time
DEFAULT_RENTAL_DAYS = 3
