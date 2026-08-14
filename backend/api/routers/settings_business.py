"""Settings → Business / Theme / License / SMTP / Data router.

Thin wrappers over the existing repositories + services, mirroring the Streamlit
Settings tabs (Business branding, theme customization, annual licensing, SMTP,
and the destructive data/danger-zone resets). Every mutation re-checks the
permission server-side and audits.

Gating (mirrors the Streamlit gates):
- Business *reads* + contact + logo/stamp  → ``manage_users`` (admin+, level 2)
- Business *name* + theme + license + smtp + data resets + pay-qr/iban
                                            → ``edit_business_settings`` (super_admin, level 3)

Money is INTEGER CENTS end-to-end; euros→cents via int(round(euros*100)). All SQL
lives in the repositories — this router never writes SQL.
"""
from __future__ import annotations

import base64
import csv
import io
import json
import zipfile
from datetime import datetime

from fastapi import APIRouter, Depends, File, HTTPException, Response, UploadFile
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from api.concurrency import heavy_slot
from api.deps import get_current_user, require
from api.settings import settings as api_settings
from api.uploads import read_capped
from config.roles import can
from data.repositories import admin_ops
from data.repositories import app_settings as app_cfg
from data.repositories import charges as charges_repo
from data.repositories import customers as cust_repo
from data.repositories import licenses as lic_repo
from data.repositories import vehicle_costs as costs_repo
from services import audit_service
from services import email_service
from services import licensing_service

# NOTE: ``ui.photos`` and ``ui.theme`` import ``streamlit`` at module top. They are
# imported LAZILY inside the endpoints that need them so this router module stays
# importable even where the Streamlit/Starlette versions clash (the encoders /
# theme tokens are only needed at request time). This keeps the one-way layering
# (we only IMPORT from ui/, never edit it).

router = APIRouter(prefix="/api", tags=["settings-business"])


def _euros_to_cents(euros: float) -> int:
    return int(round(float(euros or 0) * 100))


def _theme_consts() -> tuple[dict, list]:
    """Lazily fetch ui.theme's token defaults + font list (ui.theme imports
    streamlit at module top — kept out of this module's import time)."""
    from ui.theme import THEME_DEFAULTS, THEME_FONTS
    return THEME_DEFAULTS, THEME_FONTS


class _BytesUpload:
    """Adapter so the Streamlit-style ``encode_logo``/``encode_stamp`` encoders
    (which call ``uploaded_file.getvalue()``) accept raw multipart bytes."""

    def __init__(self, raw: bytes):
        self._raw = raw

    def getvalue(self) -> bytes:
        return self._raw


# ── Bodies ──────────────────────────────────────────────────────────────────
class BusinessNameIn(BaseModel):
    name: str = ""


class CurrencyIn(BaseModel):
    currency: str = "EUR"
    exchange_rate: float = 92


class ContactIn(BaseModel):
    phone: str = ""
    email: str = ""
    address: str = ""
    maps_url: str = ""
    pay_qr_enabled: bool | None = None
    iban: str | None = None


class ThemeIn(BaseModel):
    font: str | None = None
    primary: str | None = None
    secondary: str | None = None
    success: str | None = None
    warning: str | None = None
    alert: str | None = None
    disabled: str | None = None
    bg: str | None = None
    bar_gradient_start: str | None = None
    bar_gradient_end: str | None = None


class LicenseYearIn(BaseModel):
    year: int


class LicenseIn(BaseModel):
    licensee: str = ""
    year: int
    years: int = 1
    amount_eur: float = 0
    purchase_date: str = ""
    notes: str = ""


class SmtpIn(BaseModel):
    host: str = ""
    port: str = ""
    user: str = ""
    password: str = ""
    sender: str = ""


class ConfirmIn(BaseModel):
    confirm: str = ""


# ── Business / branding ──────────────────────────────────────────────────────
@router.get("/settings/business")
def get_business(user: dict = Depends(require("manage_users"))) -> dict:
    return {
        "business_name": app_cfg.get_business_name(),
        "has_logo": bool(app_cfg.get_logo()),
        "has_stamp": bool(app_cfg.get_stamp()),
        "phone": app_cfg.get_business_phone(),
        "address": app_cfg.get_business_address(),
        "maps_url": app_cfg.get_business_maps_url(),
        "email": app_cfg.get_business_email(),
        "iban": app_cfg.get_business_iban(),
        "pay_qr_enabled": app_cfg.get_pay_qr_enabled(),
        "currency": app_cfg.get_currency(),
        "exchange_rate": app_cfg.get_eur_all_rate(),
    }


@router.put("/settings/business/currency")
def set_currency(body: CurrencyIn,
                 user: dict = Depends(require("edit_business_settings"))) -> dict:
    currency = (body.currency or "").strip().upper()
    if currency not in ("EUR", "ALL"):
        raise HTTPException(400, detail="fields_required")
    app_cfg.set_currency(currency)
    app_cfg.set_eur_all_rate(body.exchange_rate)
    audit_service.record(user, "edit_currency", "settings", "business_currency", currency)
    return {"currency": app_cfg.get_currency(), "exchange_rate": app_cfg.get_eur_all_rate()}


@router.put("/settings/business/name")
def set_business_name(body: BusinessNameIn,
                      user: dict = Depends(require("edit_business_settings"))) -> dict:
    app_cfg.set_business_name(body.name)
    name = app_cfg.get_business_name()
    audit_service.record(user, "edit_business_name", "settings", "business_name", name)
    return {"business_name": name}


@router.put("/settings/business/contact")
def set_contact(body: ContactIn,
                user: dict = Depends(require("manage_users"))) -> dict:
    app_cfg.set_business_phone(body.phone)
    app_cfg.set_business_email(body.email)
    app_cfg.set_business_address(body.address)
    app_cfg.set_business_maps_url(body.maps_url)
    # pay-QR toggle + IBAN are super-admin-only — persist them only with the perm.
    if can(user, "edit_business_settings"):
        if body.iban is not None:
            app_cfg.set_business_iban(body.iban)
        if body.pay_qr_enabled is not None:
            app_cfg.set_pay_qr_enabled(bool(body.pay_qr_enabled))
    audit_service.record(user, "edit_business_contact", "settings", "business_contact")
    return {"ok": True}


@router.post("/settings/logo")
async def upload_logo(file: UploadFile = File(...),
                      user: dict = Depends(require("manage_users")),
                      _slot: dict = Depends(heavy_slot)) -> dict:
    # encode_logo is Pillow (blocking, CPU-bound); calling it directly from an
    # `async def` froze the event loop for every other user. See §8.2 C2 / §8.4.
    raw = await read_capped(file, api_settings.max_upload_bytes)
    if not raw:
        raise HTTPException(400, detail="fields_required")
    from ui.photos import encode_logo
    encoded = await run_in_threadpool(encode_logo, _BytesUpload(raw))
    app_cfg.set_logo(encoded)
    audit_service.record(user, "set_logo", "settings", "company_logo")
    return {"has_logo": True}


@router.delete("/settings/logo")
def delete_logo(user: dict = Depends(require("manage_users"))) -> dict:
    app_cfg.clear_logo()
    audit_service.record(user, "clear_logo", "settings", "company_logo")
    return {"has_logo": False}


@router.get("/settings/logo.png")
def get_logo_png(user: dict = Depends(get_current_user)) -> Response:
    b64 = app_cfg.get_logo()
    if not b64:
        raise HTTPException(404, detail="not_found")
    try:
        raw = base64.b64decode(b64)
    except Exception:
        raise HTTPException(404, detail="not_found")
    return Response(content=raw, media_type="image/png")


@router.post("/settings/stamp")
async def upload_stamp(file: UploadFile = File(...),
                       user: dict = Depends(require("manage_users")),
                       _slot: dict = Depends(heavy_slot)) -> dict:
    # Same blocking-Pillow-on-the-event-loop fix as upload_logo above.
    raw = await read_capped(file, api_settings.max_upload_bytes)
    if not raw:
        raise HTTPException(400, detail="fields_required")
    from ui.photos import encode_stamp
    encoded = await run_in_threadpool(encode_stamp, _BytesUpload(raw))
    app_cfg.set_stamp(encoded)
    audit_service.record(user, "set_stamp", "settings", "company_stamp")
    return {"has_stamp": True}


@router.delete("/settings/stamp")
def delete_stamp(user: dict = Depends(require("manage_users"))) -> dict:
    app_cfg.clear_stamp()
    audit_service.record(user, "clear_stamp", "settings", "company_stamp")
    return {"has_stamp": False}


@router.get("/settings/stamp.png")
def get_stamp_png(user: dict = Depends(get_current_user)) -> Response:
    b64 = app_cfg.get_stamp()
    if not b64:
        raise HTTPException(404, detail="not_found")
    try:
        raw = base64.b64decode(b64)
    except Exception:
        raise HTTPException(404, detail="not_found")
    return Response(content=raw, media_type="image/png")


# ── Theme ────────────────────────────────────────────────────────────────────
@router.get("/theme")
def get_theme_tokens(user: dict = Depends(get_current_user)) -> dict:
    # resolve_theme() reads st.session_state (night-mode flag), so it is NOT
    # import-safe outside Streamlit. Return the stored-merged token map instead;
    # the frontend applies night-mode on the client.
    defaults, fonts = _theme_consts()
    return {
        "tokens": app_cfg.get_theme(defaults),
        "fonts": fonts,
        "defaults": defaults,
    }


@router.get("/settings/theme")
def get_theme_settings(user: dict = Depends(require("edit_business_settings"))) -> dict:
    defaults, fonts = _theme_consts()
    return {
        "theme": app_cfg.get_theme(defaults),
        "fonts": fonts,
        "defaults": defaults,
    }


@router.put("/settings/theme")
def set_theme(body: ThemeIn,
              user: dict = Depends(require("edit_business_settings"))) -> dict:
    defaults, _ = _theme_consts()
    values = {k: v for k, v in body.model_dump().items() if v is not None}
    app_cfg.set_theme(values)
    audit_service.record(user, "edit_theme", "settings", "theme")
    return {"ok": True, "theme": app_cfg.get_theme(defaults)}


@router.post("/settings/theme/reset")
def reset_theme(user: dict = Depends(require("edit_business_settings"))) -> dict:
    defaults, _ = _theme_consts()
    app_cfg.reset_theme()
    audit_service.record(user, "reset_theme", "settings", "theme")
    return {"ok": True, "theme": app_cfg.get_theme(defaults)}


# ── License ──────────────────────────────────────────────────────────────────
@router.get("/license/status")
def license_status(user: dict = Depends(require("edit_business_settings"))) -> dict:
    cy = licensing_service.current_year()
    return {
        "licensed_year": licensing_service.licensed_year(),
        "current_year": cy,
        "max_date": licensing_service.max_date().isoformat(),
        "year_options": list(range(cy, cy + 11)),
    }


@router.put("/license/year")
def set_license_year(body: LicenseYearIn,
                     user: dict = Depends(require("edit_business_settings"))) -> dict:
    """Set the cap directly. ``edit_business_settings`` is super-admin only and is
    in LOCKED_PERMISSIONS, so the Admin Panel cannot delegate this to an admin —
    an admin unlocks a year only by redeeming a key the super-admin issued."""
    try:
        licensed = licensing_service.set_licensed_year(int(body.year))
    except (TypeError, ValueError):
        raise HTTPException(400, detail="fields_required")
    audit_service.record(user, "set_licensed_year", "license", str(body.year))
    return {"ok": True, "licensed_year": licensed}


@router.get("/licenses")
def list_licenses(user: dict = Depends(require("edit_business_settings"))) -> list[dict]:
    return lic_repo.list_licenses()


@router.get("/licenses/{license_id}")
def get_license(license_id: int,
                user: dict = Depends(require("edit_business_settings"))) -> dict:
    row = lic_repo.get_license(license_id)
    if not row:
        raise HTTPException(404, detail="not_found")
    return row


def _covered_through(body: LicenseIn) -> int:
    """Last year a purchase record covers. Validated here so a malformed record
    can never hand ``extend_licensed_year`` a nonsense year."""
    year, years = int(body.year), int(body.years)
    if years < 1 or not (licensing_service.MIN_LICENSE_YEAR <= year <= licensing_service.MAX_LICENSE_YEAR):
        raise HTTPException(400, detail="fields_required")
    through = year + years - 1
    if through > licensing_service.MAX_LICENSE_YEAR:
        raise HTTPException(400, detail="fields_required")
    return through


@router.post("/licenses", status_code=201)
def add_license(body: LicenseIn,
                user: dict = Depends(require("edit_business_settings"))) -> dict:
    through = _covered_through(body)
    lid = lic_repo.add_license(
        body.licensee, int(body.year), int(body.years),
        _euros_to_cents(body.amount_eur), body.purchase_date, body.notes,
    )
    licensing_service.extend_licensed_year(through)
    audit_service.record(user, "add_license", "license", str(lid), body.licensee)
    return {"ok": True, "license_id": lid}


@router.put("/licenses/{license_id}")
def update_license(license_id: int, body: LicenseIn,
                   user: dict = Depends(require("edit_business_settings"))) -> dict:
    if not lic_repo.get_license(license_id):
        raise HTTPException(404, detail="not_found")
    through = _covered_through(body)
    lic_repo.update_license(
        license_id, body.licensee, int(body.year), int(body.years),
        _euros_to_cents(body.amount_eur), body.purchase_date, body.notes,
    )
    licensing_service.extend_licensed_year(through)
    audit_service.record(user, "edit_license", "license", str(license_id), body.licensee)
    return {"ok": True}


@router.delete("/licenses/{license_id}")
def delete_license(license_id: int,
                   user: dict = Depends(require("edit_business_settings"))) -> dict:
    lic_repo.delete_license(license_id)
    audit_service.record(user, "delete_license", "license", str(license_id))
    return {"ok": True}


# ── SMTP ─────────────────────────────────────────────────────────────────────
@router.get("/smtp")
def get_smtp(user: dict = Depends(require("edit_business_settings"))) -> dict:
    return {
        "smtp_host": app_cfg.get_setting("smtp_host", ""),
        "smtp_port": app_cfg.get_setting("smtp_port", ""),
        "smtp_user": app_cfg.get_setting("smtp_user", ""),
        "smtp_pass": app_cfg.get_setting("smtp_pass", ""),
        "smtp_from": app_cfg.get_setting("smtp_from", ""),
        "is_configured": email_service.is_configured(),
        "fallback_email": email_service.FALLBACK_EMAIL,
    }


@router.put("/smtp")
def set_smtp(body: SmtpIn,
             user: dict = Depends(require("edit_business_settings"))) -> dict:
    email_service.save_smtp_config(
        host=body.host, port=body.port, user=body.user,
        password=body.password, sender=body.sender,
    )
    audit_service.record(user, "edit_smtp", "settings", "smtp")
    return {"ok": True}


# ── Data / danger zone ───────────────────────────────────────────────────────
@router.get("/data/finance-records")
def finance_records(user: dict = Depends(require("edit_business_settings"))) -> dict:
    return {
        "income": charges_repo.list_charges(200),
        "expenses": costs_repo.list_costs(200),
    }


@router.delete("/data/charges/{charge_id}")
def delete_charge(charge_id: int,
                  user: dict = Depends(require("edit_business_settings"))) -> dict:
    charges_repo.delete_charge(charge_id)
    audit_service.record(user, "delete_charge", "charge", str(charge_id))
    return {"ok": True}


@router.delete("/data/costs/{cost_id}")
def delete_cost(cost_id: int,
                user: dict = Depends(require("edit_business_settings"))) -> dict:
    costs_repo.delete_cost(cost_id)
    audit_service.record(user, "delete_cost", "cost", str(cost_id))
    return {"ok": True}


@router.get("/data/clients")
def list_clients(user: dict = Depends(require("edit_business_settings"))) -> list[dict]:
    return cust_repo.list_customers_enriched()


@router.delete("/data/clients/{customer_id}")
def delete_client(customer_id: int, body: ConfirmIn,
                  user: dict = Depends(require("edit_business_settings"))) -> dict:
    counts = admin_ops.delete_client(customer_id)
    audit_service.record(user, "delete_client", "customer", str(customer_id))
    return {"ok": True, "counts": counts}


def _require_reset_confirm(confirm: str) -> None:
    if (confirm or "").strip().upper() != "RESET":
        raise HTTPException(400, detail="fields_required")


@router.post("/data/reset/finance")
def reset_finance(body: ConfirmIn,
                  user: dict = Depends(require("edit_business_settings"))) -> dict:
    _require_reset_confirm(body.confirm)
    counts = admin_ops.reset_finance()
    audit_service.record(user, "reset_finance", "data", "finance")
    return {"ok": True, "counts": counts}


@router.post("/data/reset/clients")
def reset_clients(body: ConfirmIn,
                  user: dict = Depends(require("edit_business_settings"))) -> dict:
    _require_reset_confirm(body.confirm)
    counts = admin_ops.reset_clients()
    audit_service.record(user, "reset_clients", "data", "clients")
    return {"ok": True, "counts": counts}


@router.post("/data/reset/fleet")
def reset_fleet(body: ConfirmIn,
                user: dict = Depends(require("edit_business_settings"))) -> dict:
    _require_reset_confirm(body.confirm)
    counts = admin_ops.reset_fleet()
    audit_service.record(user, "reset_fleet", "data", "fleet")
    return {"ok": True, "counts": counts}


# ── Backup / restore ─────────────────────────────────────────────────────────
# Admin + super-admin (``backup_database``, level 2). Export streams a JSON dump of
# every business table; import replaces the current data with a previously exported
# backup, in one transaction. Both audit.
@router.get("/data/backup")
def backup_database(user: dict = Depends(require("backup_database")),
                    _slot: dict = Depends(heavy_slot)) -> Response:
    payload = admin_ops.export_all()
    body = json.dumps(payload, ensure_ascii=False, indent=2)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    audit_service.record(user, "backup_database", "data", "backup")
    return Response(
        content=body,
        media_type="application/json",
        headers={"Content-Disposition": f'attachment; filename="bcr-backup-{stamp}.json"'},
    )


@router.get("/data/backup.csv")
def backup_database_csv(user: dict = Depends(require("backup_database")),
                        _slot: dict = Depends(heavy_slot)) -> Response:
    """Same snapshot as ``/data/backup`` but as a ZIP of one CSV per table — handy for
    opening in Excel / Sheets. Secret and binary columns (password hashes, base64
    photo blobs) are dropped: this export is for *reading*, not restoring (import
    still expects the JSON dump). Each CSV is UTF-8 with a BOM so € renders in Excel."""
    tables = admin_ops.export_all().get("tables", {})
    skip_cols = {"password_hash", "photo"}
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    zbuf = io.BytesIO()
    with zipfile.ZipFile(zbuf, "w", zipfile.ZIP_DEFLATED) as zf:
        for tbl, rows in tables.items():
            cols = [c for c in (rows[0].keys() if rows else []) if c not in skip_cols]
            sbuf = io.StringIO()
            writer = csv.writer(sbuf)
            writer.writerow(cols)
            for row in rows:
                writer.writerow([row.get(c, "") for c in cols])
            zf.writestr(f"{tbl}.csv", "﻿" + sbuf.getvalue())
    audit_service.record(user, "backup_database_csv", "data", "backup")
    return Response(
        content=zbuf.getvalue(),
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="bcr-backup-{stamp}.zip"'},
    )


@router.get("/data/backup-single.csv")
def backup_database_single_csv(user: dict = Depends(require("backup_database")),
                               _slot: dict = Depends(heavy_slot)) -> Response:
    """The whole database as ONE CSV file: every table's rows concatenated, each
    section preceded by a ``# TABLE: <name>`` marker and its column header, with a
    blank line between tables. Secret/binary columns (password hashes, base64 photo
    blobs) are dropped — this export is for reading (Excel/Sheets), not restoring
    (import still expects the JSON dump). UTF-8 with a BOM so € renders in Excel."""
    tables = admin_ops.export_all().get("tables", {})
    skip_cols = {"password_hash", "photo"}
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    sbuf = io.StringIO()
    writer = csv.writer(sbuf)
    for tbl, rows in tables.items():
        cols = [c for c in (rows[0].keys() if rows else []) if c not in skip_cols]
        writer.writerow([f"# TABLE: {tbl}"])
        if cols:
            writer.writerow(cols)
            for row in rows:
                writer.writerow([row.get(c, "") for c in cols])
        writer.writerow([])  # blank separator line between tables
    audit_service.record(user, "backup_database_single_csv", "data", "backup")
    return Response(
        content=("﻿" + sbuf.getvalue()).encode("utf-8"),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="bcr-backup-{stamp}.csv"'},
    )


@router.get("/data/backup.sqlite")
def backup_database_sqlite(user: dict = Depends(require("backup_database")),
                           _slot: dict = Depends(heavy_slot)) -> Response:
    """The whole database as a portable single-file SQLite database. Built from the
    same snapshot as the JSON/CSV backups (so it works identically on a local SQLite
    dev DB and on a managed remote DB such as Turso/Postgres): every backed-up table
    is recreated with its columns and all rows inserted. Opens in any SQLite tool
    (DB Browser for SQLite, `sqlite3`, etc.)."""
    import os
    import sqlite3
    import tempfile

    tables = admin_ops.export_all().get("tables", {})
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    fd, path = tempfile.mkstemp(suffix=".sqlite")
    os.close(fd)
    try:
        con = sqlite3.connect(path)
        try:
            for tbl, rows in tables.items():
                # Union of column names across rows keeps every field even if the
                # first row is missing a nullable one. Skip a table with no rows.
                cols: list[str] = []
                seen: set[str] = set()
                for row in rows:
                    for c in row.keys():
                        if c not in seen:
                            seen.add(c)
                            cols.append(c)
                if not cols:
                    continue
                col_ddl = ", ".join(f'"{c}"' for c in cols)
                con.execute(f'CREATE TABLE "{tbl}" ({col_ddl})')
                placeholders = ", ".join("?" for _ in cols)
                con.executemany(
                    f'INSERT INTO "{tbl}" ({col_ddl}) VALUES ({placeholders})',
                    [[row.get(c) for c in cols] for row in rows],
                )
            con.commit()
        finally:
            con.close()
        with open(path, "rb") as fh:
            data = fh.read()
    finally:
        try:
            os.remove(path)
        except OSError:
            pass
    audit_service.record(user, "backup_database_sqlite", "data", "backup")
    return Response(
        content=data,
        media_type="application/vnd.sqlite3",
        headers={"Content-Disposition": f'attachment; filename="bcr-backup-{stamp}.sqlite"'},
    )


@router.post("/data/import")
async def import_database(file: UploadFile = File(...),
                          user: dict = Depends(require("backup_database")),
                          _slot: dict = Depends(heavy_slot)) -> dict:
    """Restore a JSON backup.

    The most expensive endpoint in the app, and previously the most dangerous to
    the event loop: an unbounded ``read()``, a ``json.loads`` of arbitrary size,
    and a full multi-table write — all on the loop. Now bounded and offloaded.

    ``max_import_bytes`` is the real memory ceiling of the process, since parsing
    N bytes of JSON costs several times N. A streaming importer would let that cap
    drop substantially — see DOCUMENTATION.md §8.4.
    """
    raw = await read_capped(file, api_settings.max_import_bytes, detail="request_too_large")
    if not raw:
        raise HTTPException(400, detail="fields_required")

    def _parse_and_import(payload: bytes) -> dict:
        try:
            data = json.loads(payload.decode("utf-8"))
        except Exception:
            raise HTTPException(400, detail="invalid_backup")
        if not isinstance(data, dict) or not isinstance(data.get("tables"), dict):
            raise HTTPException(400, detail="invalid_backup")
        return admin_ops.import_all(data)

    counts = await run_in_threadpool(_parse_and_import, raw)
    audit_service.record(user, "import_database", "data", "restore")
    return {"ok": True, "counts": counts}
