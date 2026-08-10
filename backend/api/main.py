"""FastAPI application entrypoint.

Boots the same database the Streamlit app uses (Neon Postgres in prod via
``DATABASE_URL``; local SQLite in dev), runs ``init_db()`` exactly once at startup
(schema + migrations + first-run seed + default admin), and mounts the REST routers.

Run from the repo root:
    uvicorn api.main:app --reload --port 8000
"""
from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from api.deps import require_level
from api.middleware import (
    BodySizeLimitMiddleware,
    CSRFOriginMiddleware,
    RateLimitMiddleware,
    RequestContextMiddleware,
    RequestScopedDBMiddleware,
    SecurityHeadersMiddleware,
)
from api.monitoring import get_logger, stats
from api.settings import settings
from services.licensing_service import LicenseLimitError

_boot_log = get_logger("boot")


_DEFAULT_JWT_SECRET = "dev-insecure-change-me-please"


def _verify_production_config() -> None:
    """Refuse to start a production instance with a forgeable session secret.

    ``cookie_secure`` is the production signal (it is only ever true behind HTTPS).
    With the shipped default secret, anyone can mint a valid ``super_admin`` token
    and the entire RBAC layer becomes decorative — so this is a hard failure at
    boot, not a warning in a log nobody reads. See DOCUMENTATION.md §8.2 C1.
    """
    if not settings.cookie_secure:
        return  # dev / LAN launcher — the default secret is fine here
    secret = (settings.jwt_secret or "").strip()
    if secret == _DEFAULT_JWT_SECRET or len(secret) < 32:
        raise RuntimeError(
            "JWT_SECRET is unset, default, or shorter than 32 characters while "
            "COOKIE_SECURE=true. Refusing to start: with a guessable secret any "
            "client can forge a super_admin session token. Set JWT_SECRET to a "
            "long random value (e.g. `python -c \"import secrets;"
            "print(secrets.token_urlsafe(48))\"`)."
        )
    if settings.cors_allow_lan:
        raise RuntimeError(
            "CORS_ALLOW_LAN=1 with COOKIE_SECURE=true. LAN mode admits any "
            "RFC-1918 origin with credentials and must never be enabled on a "
            "public host. See DOCUMENTATION.md §8.2 M8."
        )


@asynccontextmanager
async def lifespan(app: FastAPI):
    _verify_production_config()

    # 136 of 140 endpoints are sync `def` and run in AnyIO's worker pool. The
    # framework default is 40 threads — a general-purpose guess, not a decision
    # about this workload. Set it deliberately. (§8.4)
    try:
        import anyio.to_thread

        anyio.to_thread.current_default_thread_limiter().total_tokens = (
            settings.threadpool_max
        )
    except Exception:  # pragma: no cover - never let tuning break startup
        pass

    # Bridge our setting into the env var core/db.py reads. Empty => local SQLite.
    if settings.database_url:
        os.environ["DATABASE_URL"] = settings.database_url
    # init_db is idempotent: schema, 4 migrations, seed-if-empty, ensure admin,
    # purge expired sessions. Run ONCE here (not per-request like Streamlit reruns).
    from core.db import init_db

    init_db()
    # Wire the stored role/permission overrides (Admin Panel) into config.roles'
    # can(). Must run AFTER init_db so app_settings exists; with it uninstalled
    # can() simply falls back to the shipped level rules.
    from services import permissions_service

    permissions_service.install()
    # Upgrade a pre-seal (bare integer) licensed-year value to a signed one. Runs
    # at most once per installation — see licensing_service.migrate_legacy_seal.
    from services import licensing_service

    licensing_service.migrate_legacy_seal()
    yield


app = FastAPI(
    title="Balkan Car Rentals — Fleet Console API",
    version="3.2",
    lifespan=lifespan,
)

# ── Middleware ────────────────────────────────────────────────────────────────
# `add_middleware` PREPENDS, so the last one added is the outermost. The intended
# order, outermost first, is:
#
#   RequestContext  — times everything, including rejections, and stamps X-Request-ID
#   CORS            — must wrap the limiter, or a 429 arrives without CORS headers
#                     and the browser reports a CORS failure instead of "slow down"
#   SecurityHeaders — applies to every response, including errors
#   BodySizeLimit   — reject oversized bodies before any handler sees them
#   CSRFOrigin      — reject forged cross-site writes before RateLimit spends a
#                     token on a request that was always going to be rejected
#   RateLimit       — L1-L3 (DOCUMENTATION.md §8.3)
#   RequestScopedDB — innermost: binds the request's read-connection holder
#                     immediately around the actual handler, nothing outside it
#                     ever calls db_read() (DOCUMENTATION.md §8.8 M3)
#
# so they are added here in reverse.
app.add_middleware(RequestScopedDBMiddleware)
app.add_middleware(RateLimitMiddleware)
app.add_middleware(CSRFOriginMiddleware)
app.add_middleware(BodySizeLimitMiddleware)
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    # None unless CORS_ALLOW_LAN is set — see settings.cors_origin_regex.
    allow_origin_regex=settings.cors_origin_regex,
    allow_credentials=True,        # required for the HttpOnly auth cookie
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(RequestContextMiddleware)


@app.exception_handler(LicenseLimitError)
async def license_limit_handler(request, exc: LicenseLimitError) -> JSONResponse:
    """Any date past the licensed year, from any router, answers the same way.

    403 rather than 400: the request is well-formed, the installation simply is
    not licensed for that period. The extra fields let the UI name the offending
    field and the last bookable day instead of showing a bare error.
    """
    return JSONResponse(
        status_code=403,
        content={
            "detail": "license_year_locked",
            "field": exc.field,
            "value": exc.value,
            "licensed_year": exc.licensed_year,
            "max_date": exc.max_date,
            "next_year": exc.next_year,
        },
    )


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "service": "balkan-fleet-api"}


@app.get("/internal/db-health")
def db_health(user: dict = Depends(require_level(2))) -> JSONResponse:
    """Confirm the bound DB answers a trivial query; report the dialect.

    Admin-gated, and the exception text is deliberately NOT returned: a connection
    failure message routinely embeds the database host, user and (for URL-style
    DSNs) the password. It goes to the server log, where it is useful, instead of
    to an unauthenticated caller, where it is a credential leak.
    See DOCUMENTATION.md §8.2 H4.
    """
    import core.db as dbmod
    from core.db import get_engine

    try:
        with get_engine().connect() as c:
            ok = c.execute(text("SELECT 1")).scalar_one() == 1
    except Exception as exc:  # pragma: no cover - diagnostic
        _boot_log.error("db-health failed: %s", exc)
        return JSONResponse(
            status_code=503,
            content={"ok": False, "dialect": dbmod._dialect, "error": "unavailable"},
        )
    return JSONResponse(
        {"ok": ok, "dialect": dbmod._dialect, "is_remote": dbmod._is_remote}
    )


@app.get("/internal/stats")
def request_stats(user: dict = Depends(require_level(2))) -> JSONResponse:
    """Per-route latency percentiles and rejection counters.

    This is the **Phase 0 measurement instrument** (DOCUMENTATION.md §8.10): the
    provisional limits in `api/settings.py` are meant to be replaced with values
    derived from what this reports under real load. Routes are returned slowest
    p95 first. `events` carries limiter and concurrency rejections, which is how
    you tell "the limits are working" from "the limits are too tight".
    """
    return JSONResponse(stats.snapshot())


@app.post("/internal/stats/reset")
def reset_request_stats(user: dict = Depends(require_level(3))) -> JSONResponse:
    """Clear the samples, so a benchmark run starts from a clean baseline."""
    stats.reset()
    return JSONResponse({"ok": True})


# ── Routers ───────────────────────────────────────────────────────────────────
# Mounted incrementally as each domain is ported (auth, vehicles, customers,
# rentals, finance, settings, invoices, i18n, meta, notifications, ...).
from api.routers import activity as activity_router  # noqa: E402
from api.routers import admin_panel as admin_panel_router  # noqa: E402
from api.routers import auth as auth_router  # noqa: E402
from api.routers import contact as contact_router  # noqa: E402
from api.routers import customer_reports as customer_reports_router  # noqa: E402
from api.routers import customers as customers_router  # noqa: E402
from api.routers import finance as finance_router  # noqa: E402
from api.routers import finance_reports as finance_reports_router  # noqa: E402
from api.routers import i18n as i18n_router  # noqa: E402
from api.routers import invoices as invoices_router  # noqa: E402
from api.routers import license_keys as license_keys_router  # noqa: E402
from api.routers import meta as meta_router  # noqa: E402
from api.routers import notifications as notifications_router  # noqa: E402
from api.routers import photos as photos_router  # noqa: E402
from api.routers import rentals as rentals_router  # noqa: E402
from api.routers import settings_account as settings_account_router  # noqa: E402
from api.routers import settings_business as settings_business_router  # noqa: E402
from api.routers import timeline as timeline_router  # noqa: E402
from api.routers import vehicles as vehicles_router  # noqa: E402

app.include_router(auth_router.router)
app.include_router(meta_router.router)
app.include_router(i18n_router.router)
app.include_router(contact_router.router)
app.include_router(vehicles_router.router)
app.include_router(rentals_router.router)
app.include_router(notifications_router.router)
app.include_router(invoices_router.router)
app.include_router(customers_router.router)
app.include_router(customer_reports_router.router)
app.include_router(finance_router.router)
app.include_router(finance_reports_router.router)
app.include_router(settings_account_router.router)
app.include_router(settings_business_router.router)
app.include_router(activity_router.router)
app.include_router(admin_panel_router.router)
app.include_router(photos_router.router)
app.include_router(license_keys_router.router)
app.include_router(timeline_router.router)
