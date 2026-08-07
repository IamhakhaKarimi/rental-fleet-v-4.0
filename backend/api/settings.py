"""Backend configuration (env-driven, 12-factor).

Reads from environment variables (and an optional ``.env`` at the repo root).
The DB connection itself is owned by ``core/db.py`` (which reads ``DATABASE_URL``
from the environment); ``api.main`` bridges this setting into ``os.environ`` at
startup so the existing engine code is reused unchanged.
"""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore", case_sensitive=False
    )

    # Database — empty string => local SQLite file (dev). Set to a Neon Postgres
    # URL (postgres://... or postgresql://...) for production; core/db.py rewrites
    # it to the pure-Python pg8000 driver and strips libpq-only query args.
    database_url: str = ""

    # Auth / JWT. CHANGE jwt_secret in production (env JWT_SECRET).
    jwt_secret: str = "dev-insecure-change-me-please"
    jwt_algorithm: str = "HS256"
    jwt_ttl_days: int = 14          # "remember me" lifetime
    jwt_ttl_days_short: int = 1     # non-remembered session lifetime

    # Session cookie (HttpOnly). Secure+SameSite tuned per environment.
    cookie_name: str = "bcr_session"
    cookie_secure: bool = False     # True behind HTTPS (production)
    cookie_samesite: str = "lax"    # "none" needed for cross-site cookie (set secure too)
    cookie_domain: str = ""         # empty => host-only cookie

    # Password policy. Raised from the old 6-char minimum; see
    # services/auth_service.validate_password for the full rule set.
    password_min_length: int = 10

    # Failed-login throttling: lock an account for `lockout_minutes` once it has
    # accumulated `max_login_failures` consecutive failures.
    max_login_failures: int = 5
    lockout_minutes: int = 15

    # Password-reset links: lifetime, and how many may be requested per account
    # per hour (anti inbox-flood).
    reset_token_ttl_minutes: int = 30
    reset_max_per_hour: int = 5

    # Public origin of the FRONTEND, used to build reset links in email. Falls
    # back to the first CORS origin when unset.
    app_base_url: str = ""

    # CORS — comma-separated allow-list of frontend origins.
    cors_origins: str = "http://localhost:3000"

    # LAN mode, set by the desktop launcher's "Local WiFi network" button. Off
    # by default so cloud deployments keep the strict exact-match allow-list.
    # When on, any loopback port and any RFC-1918 address may call the API —
    # a regex rather than an explicit origin because the host PC's address is a
    # DHCP lease that can change between launches (and `allow_credentials=True`
    # rules out the "*" wildcard entirely).
    cors_allow_lan: bool = False

    @property
    def frontend_base_url(self) -> str:
        base = (self.app_base_url or "").strip()
        if not base:
            origins = self.cors_origin_list
            base = origins[0] if origins else "http://localhost:3000"
        return base.rstrip("/")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def cors_origin_regex(self) -> str | None:
        """Extra origin matcher for LAN mode; None keeps exact-match only."""
        if not self.cors_allow_lan:
            return None
        return (
            r"http://("
            r"localhost"
            r"|127\.\d{1,3}\.\d{1,3}\.\d{1,3}"
            r"|10\.\d{1,3}\.\d{1,3}\.\d{1,3}"
            r"|192\.168\.\d{1,3}\.\d{1,3}"
            r"|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}"
            r")(?::\d{1,5})?$"
        )


settings = Settings()
