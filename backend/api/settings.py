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
    # "strict" ships with the M9 cookie-only migration + CSRF Origin check
    # (CLAUDE.md sequencing constraint). "none" needed for cross-site cookie
    # (set secure too); the launcher's LAN mode is unaffected — SameSite
    # ignores port, so a Strict cookie still flows between :3000 and :8001 on
    # the same host.
    cookie_samesite: str = "strict"
    cookie_domain: str = ""         # empty => host-only cookie

    # First-run bootstrap admin. Only used on a genuinely empty users table — see
    # services/auth_service.ensure_bootstrap_admin. Required in production
    # (cookie_secure=true); optional in dev, where an unset value generates a
    # random password logged once instead of a constant admin/admin.
    bootstrap_admin_user: str = ""
    bootstrap_admin_password: str = ""

    # Password policy. Raised from the old 6-char minimum; see
    # services/auth_service.validate_password for the full rule set.
    password_min_length: int = 10

    # Failed-login throttling. The real lockout is keyed on (username, ip) — see
    # login_attempts_ip / auth_service.register_login_failure — so an attacker
    # hammering a known username can only ever lock out their own pairing, never
    # the genuine user logging in from their usual network. `max_login_failures`
    # is the threshold before the pair starts locking; `lockout_minutes` is the
    # base duration, doubled per failure beyond the threshold and capped at
    # `lockout_max_minutes`.
    max_login_failures: int = 5
    lockout_minutes: int = 15
    lockout_max_minutes: int = 240   # 4h cap on the exponential backoff

    # Global per-username counter (all IPs combined). Never locks anyone out —
    # it only adds a small synchronous delay once failures pile up, as friction
    # against a distributed/low-and-slow attack that spreads guesses across many
    # IPs to dodge the per-pair lock.
    global_login_failures_threshold: int = 20
    global_login_delay_seconds: float = 2.0

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

    # ── Rate limiting (L1–L3) ────────────────────────────────────────────────
    # See DOCUMENTATION.md §8.3. Three keyed layers share one token-bucket
    # implementation: per-IP, per-account, and per-cost-class.
    #
    # PROVISIONAL VALUES — deliberately generous. They exist so the mechanism is
    # live and fails safe, NOT because they were measured. Phase 0 replaces them
    # with numbers derived from real timings (§8.7). Do not treat them as tuned.
    rate_limit_enabled: bool = True
    # Per-IP (L1): the outer app-side net. Catches credential stuffing/scraping.
    rate_limit_ip_per_min: int = 300
    rate_limit_ip_burst: int = 60
    # Per-account (L2): keyed on the JWT subject. The layer that actually matters
    # in an office, where every staff member shares one NAT'd public IP.
    rate_limit_account_per_min: int = 240
    rate_limit_account_burst: int = 40
    # Per-cost-class (L3). An unclassified route inherits `heavy` — forgetting to
    # classify a route must fail safe, never fail open.
    rate_limit_cheap_per_min: int = 240
    rate_limit_write_per_min: int = 60
    rate_limit_heavy_per_min: int = 10
    rate_limit_auth_per_min: int = 10      # login + password reset, strict

    # ── Concurrency (L4) ─────────────────────────────────────────────────────
    # Rate limits bound ARRIVALS; semaphores bound RESIDENCY. Ten simultaneous
    # 36-page PDF exports is a legal rate and still a stalled server.
    heavy_concurrency_global: int = 3      # total concurrent expensive operations
    heavy_concurrency_per_user: int = 1    # ...of which any one account may hold
    heavy_acquire_timeout_s: float = 5.0   # then 429 + Retry-After, never queue forever

    # AnyIO worker-thread ceiling. 136 of 140 endpoints are sync `def` and run
    # here. The framework default is 40 — a general-purpose guess, not a decision
    # about this workload (which is mostly waiting on SQLite).
    threadpool_max: int = 64

    # ── Request size caps ────────────────────────────────────────────────────
    # `await file.read()` with no limit is memory exhaustion from one request.
    max_upload_bytes: int = 10 * 1024 * 1024      # per uploaded file (photo/logo/stamp)
    max_request_bytes: int = 32 * 1024 * 1024     # any non-import request body
    # Import is the one legitimately large body (a full JSON backup incl. photos).
    # Still bounded: json.loads of N bytes costs several times N in RAM, so this
    # is the memory ceiling of the whole process. A streaming importer would let
    # this drop a lot — see DOCUMENTATION.md §8.4.
    max_import_bytes: int = 50 * 1024 * 1024

    # Trust the first X-Forwarded-For hop as the real client IP.
    # MUST be true behind Nginx and false otherwise. Wrong in either direction
    # breaks per-IP limiting: false behind a proxy collapses the whole company
    # into one bucket; true without a proxy lets a client spoof its own IP.
    trust_proxy: bool = False

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
