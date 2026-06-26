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

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

from api.settings import settings


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Bridge our setting into the env var core/db.py reads. Empty => local SQLite.
    if settings.database_url:
        os.environ["DATABASE_URL"] = settings.database_url
    # init_db is idempotent: schema, 4 migrations, seed-if-empty, ensure admin,
    # purge expired sessions. Run ONCE here (not per-request like Streamlit reruns).
    from core.db import init_db

    init_db()
    yield


app = FastAPI(
    title="Balkan Car Rentals — Fleet Console API",
    version="3.2",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,        # required for the HttpOnly auth cookie
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/api/health")
def health() -> dict:
    return {"ok": True, "service": "balkan-fleet-api"}


@app.get("/internal/db-health")
def db_health() -> JSONResponse:
    """Confirm the bound DB answers a trivial query; report the dialect."""
    import core.db as dbmod
    from core.db import get_engine

    try:
        with get_engine().connect() as c:
            ok = c.execute(text("SELECT 1")).scalar_one() == 1
    except Exception as exc:  # pragma: no cover - diagnostic
        return JSONResponse(
            status_code=503,
            content={"ok": False, "dialect": dbmod._dialect, "error": str(exc)},
        )
    return JSONResponse(
        {"ok": ok, "dialect": dbmod._dialect, "is_remote": dbmod._is_remote}
    )


# ── Routers ───────────────────────────────────────────────────────────────────
# Mounted incrementally as each domain is ported (auth, vehicles, customers,
# rentals, finance, settings, invoices, i18n, meta, notifications, ...).
from api.routers import activity as activity_router  # noqa: E402
from api.routers import auth as auth_router  # noqa: E402
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
app.include_router(vehicles_router.router)
app.include_router(rentals_router.router)
app.include_router(notifications_router.router)
app.include_router(invoices_router.router)
app.include_router(customers_router.router)
app.include_router(finance_router.router)
app.include_router(finance_reports_router.router)
app.include_router(settings_account_router.router)
app.include_router(settings_business_router.router)
app.include_router(activity_router.router)
app.include_router(photos_router.router)
app.include_router(license_keys_router.router)
app.include_router(timeline_router.router)
