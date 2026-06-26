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

    # CORS — comma-separated allow-list of frontend origins.
    cors_origins: str = "http://localhost:3000"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


settings = Settings()
