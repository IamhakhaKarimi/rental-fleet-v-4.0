"""
Database access foundation.

- Uses SQLAlchemy over SQLite so a future move to PostgreSQL is mostly a
  connection-string change (the rest of the app talks to repositories, never
  to SQLite directly).
- Turns ON foreign keys and write-ahead logging (WAL) for integrity and
  better read/write concurrency.
- init_db() creates the schema (idempotent) and, on a brand-new database,
  seeds the vehicles table from fleet_master.csv automatically. So the app
  works on first launch with no manual import step.
"""

from sqlalchemy import create_engine, event, text
from sqlalchemy.engine import Engine

from config.settings import DB_PATH

import os

_SCHEMA_FILE = os.path.join(os.path.dirname(__file__), "schema.sql")

_engine: Engine | None = None
# Dialect of the bound engine: "sqlite" (local dev) or "postgresql" (production).
# `_is_remote` is the convenience boolean (True for Postgres). Both are set by
# get_engine() and drive the schema/migration code paths below — a remote Postgres
# DB can't be reached with raw `sqlite3.connect(DB_PATH)`, and needs a few SQLite-ism
# shims (see _PG_SHIMS) plus information_schema column introspection.
_dialect: str = "sqlite"
_is_remote: bool = False


def _env(key: str) -> str:
    """Read a config value from the environment, then Streamlit secrets (guarded so
    plain-`python` scripts still run off-Streamlit). Returns '' if unset."""
    v = os.environ.get(key, "").strip()
    if v:
        return v
    try:
        import streamlit as st
        return str(st.secrets.get(key, "")).strip()
    except Exception:
        return ""


def _build_libsql_url(url: str, token: str) -> str:
    """Turn a Turso URL (`libsql://host` or `sqlite+libsql://host…`) + an auth token
    into the SQLAlchemy URL the `sqlalchemy-libsql` dialect expects:
        sqlite+libsql://<host>/?authToken=<token>&secure=true
    Turso speaks SQLite, so the schema DDL runs unchanged (no Postgres shims)."""
    from urllib.parse import urlencode, urlsplit, parse_qsl
    p = urlsplit(url)
    host = p.netloc or p.path.lstrip("/")
    q = dict(parse_qsl(p.query))
    if token:
        q.setdefault("authToken", token)
    q.setdefault("secure", "true")
    return f"sqlite+libsql://{host}/?{urlencode(q)}"


def _remote_db_url() -> str:
    """Return a SQLAlchemy URL for the production database, or '' to fall back to the
    local SQLite file (dev). Two managed backends are supported:

      * Turso / libSQL — set TURSO_DATABASE_URL (+ TURSO_AUTH_TOKEN), or pass a
        ``libsql://…`` / ``sqlite+libsql://…`` value as DATABASE_URL. Rewritten to
        the ``sqlite+libsql://host/?authToken=…&secure=true`` form. Turso is
        SQLite-compatible, so the schema runs unchanged.
      * Postgres (Neon) — a ``postgres://…`` DATABASE_URL, rewritten to the
        pure-Python ``postgresql+pg8000://…`` driver (libpq-only query args dropped;
        TLS handled via connect_args in get_engine()).

    Why this exists: the production host has an ephemeral filesystem — a local
    SQLite file is wiped on every restart, losing all runtime data. A managed Turso
    (or Postgres) database persists across restarts."""
    turso = _env("TURSO_DATABASE_URL")
    raw = _env("DATABASE_URL")
    # Turso may also arrive through DATABASE_URL.
    if not turso and raw.startswith(("libsql://", "sqlite+libsql://")):
        turso, raw = raw, ""
    if turso:
        return _build_libsql_url(turso, _env("TURSO_AUTH_TOKEN"))
    if not raw:
        return ""
    from urllib.parse import urlsplit, urlunsplit
    p = urlsplit(raw)
    scheme = "postgresql+pg8000" if p.scheme in ("postgres", "postgresql") else p.scheme
    return urlunsplit((scheme, p.netloc, p.path, "", ""))  # drop query + fragment


def get_engine() -> Engine:
    """Return a single shared engine for the whole app.

    Uses a persistent Postgres database when DATABASE_URL is configured (production
    on Streamlit Cloud); otherwise the local SQLite file (dev)."""
    global _engine, _dialect, _is_remote
    if _engine is None:
        url = _remote_db_url()
        if url:
            # pool_pre_ping: serverless DBs (Neon free tier, Turso) suspend idle
            # connections; pre-ping silently reconnects instead of erroring.
            if url.startswith("postgresql"):
                import ssl
                _engine = create_engine(
                    url, future=True, pool_pre_ping=True,
                    connect_args={"ssl_context": ssl.create_default_context()},
                )
                _dialect = "postgresql"
            else:
                # Turso / libSQL — SQLite-compatible via the sqlalchemy-libsql
                # dialect. No local SQLite PRAGMAs (managed remote) and no PG shims.
                _engine = create_engine(url, future=True, pool_pre_ping=True)
                _dialect = "sqlite"
            _is_remote = True
        else:
            _engine = create_engine(f"sqlite:///{DB_PATH}", future=True)
            _dialect = "sqlite"
            _is_remote = False

            @event.listens_for(_engine, "connect")
            def _set_sqlite_pragmas(dbapi_conn, _):
                cur = dbapi_conn.cursor()
                cur.execute("PRAGMA foreign_keys = ON")      # referential integrity
                cur.execute("PRAGMA journal_mode = WAL")     # concurrent reads during writes
                cur.execute("PRAGMA synchronous = NORMAL")   # safe under WAL, far faster writes
                cur.execute("PRAGMA busy_timeout = 5000")    # wait up to 5s for a lock instead of erroring
                cur.execute("PRAGMA temp_store = MEMORY")    # keep temp b-trees in RAM
                cur.execute("PRAGMA cache_size = -16000")    # ~16 MB page cache per connection
                cur.execute("PRAGMA mmap_size = 134217728")  # 128 MB memory-mapped I/O
                cur.close()

    return _engine


# ── Postgres compatibility shims ──────────────────────────────────────────────
# The app's SQL was written for SQLite. Rather than rewrite every query, we define
# a couple of SQLite-named functions in Postgres so the existing SQL runs unchanged:
#   datetime('now')        → current UTC timestamp as ISO-8601 text
#   strftime('%Y-%m', col) → substring of an ISO date (mirrors how SQLite formats)
# (date('now') in schema defaults is rewritten directly — see _to_pg.) The handful
# of statement-level SQLite-isms that can't be shimmed — INSERT OR IGNORE/REPLACE,
# lastrowid, GLOB — were rewritten in the repositories to cross-dialect forms
# (ON CONFLICT, RETURNING, LIKE) that both SQLite (3.24+/3.35+) and Postgres accept.
_PG_SHIMS = [
    """CREATE OR REPLACE FUNCTION datetime(t text) RETURNS text AS $$
       SELECT to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS') $$
       LANGUAGE sql""",
    """CREATE OR REPLACE FUNCTION strftime(fmt text, t text) RETURNS text AS $$
       SELECT CASE fmt
                WHEN '%Y-%m'    THEN substr(t, 1, 7)
                WHEN '%Y'       THEN substr(t, 1, 4)
                WHEN '%Y-%m-%d' THEN substr(t, 1, 10)
                ELSE t END $$ LANGUAGE sql IMMUTABLE""",
]


def _to_pg(sql: str) -> str:
    """Rewrite the SQLite schema DDL to Postgres equivalents (autoincrement keys and
    the date('now') default; datetime('now') defaults are served by the shim)."""
    import re
    sql = re.sub(r"INTEGER\s+PRIMARY\s+KEY\s+AUTOINCREMENT", "SERIAL PRIMARY KEY",
                 sql, flags=re.IGNORECASE)
    sql = sql.replace("date('now')",
                      "to_char((now() AT TIME ZONE 'UTC'), 'YYYY-MM-DD')")
    return sql


def _split_sql_statements(sql: str) -> list[str]:
    """Split a schema script into individual statements for engines that can't run
    sqlite3's `executescript`. Strips `-- ...` line comments (schema.sql uses no
    string literals containing `;`, so a plain split on `;` is safe here)."""
    no_comments = " ".join(line.split("--", 1)[0] for line in sql.splitlines())
    return [s.strip() for s in no_comments.split(";") if s.strip()]


def _run_schema():
    """Create all tables/indexes. Safe to run repeatedly."""
    get_engine()  # ensure the engine is bound so _dialect reflects the target DB
    with open(_SCHEMA_FILE, "r", encoding="utf-8") as f:
        sql = f.read()
    if _is_remote:
        # Remote DB (Postgres OR Turso/libSQL): run through the engine, one
        # statement at a time (no sqlite3.connect to a remote URL). Postgres needs
        # the SQLite-ism shims + DDL translation; Turso is SQLite, so it runs as-is.
        with get_engine().begin() as conn:
            if _dialect == "postgresql":
                for shim in _PG_SHIMS:
                    conn.execute(text(shim))
                stmts = _split_sql_statements(_to_pg(sql))
            else:
                stmts = _split_sql_statements(sql)
            for stmt in stmts:
                conn.execute(text(stmt))
    else:
        # Local SQLite: executescript handles comments + multiple statements natively.
        import sqlite3
        con = sqlite3.connect(str(DB_PATH))
        try:
            con.executescript(sql)
            con.commit()
        finally:
            con.close()


def _table_columns(table: str) -> list[str]:
    """Column names of a table, dialect-aware (used by the additive migrations)."""
    if _dialect == "postgresql":
        with get_engine().connect() as conn:
            rows = conn.execute(
                text("SELECT column_name FROM information_schema.columns "
                     "WHERE table_name = :t"), {"t": table}).all()
        return [r[0] for r in rows]
    with get_engine().connect() as conn:
        return [r[1] for r in conn.execute(text(f"PRAGMA table_info({table})")).all()]


def _is_fleet_empty() -> bool:
    with get_engine().connect() as conn:
        count = conn.execute(text("SELECT COUNT(*) FROM vehicles")).scalar_one()
    return count == 0


def init_db():
    """Create schema, migrate the users table if needed, and seed on first run."""
    _run_schema()
    _migrate_users()
    _migrate_rentals()
    _migrate_add_columns()
    _migrate_charges_types()
    _migrate_photos()
    if _is_fleet_empty():
        # Imported lazily to avoid a circular import at module load time.
        from data.seed.import_csv import seed_vehicles_from_csv
        seed_vehicles_from_csv(get_engine())
    # Make sure at least one super-admin exists so the app can be logged into.
    from services.auth_service import ensure_default_admin
    ensure_default_admin()
    # Hygiene/security: drop expired remember-me sessions so the table can't grow
    # unbounded and stale tokens can't linger. Cheap (indexed) and idempotent.
    from data.repositories.users import purge_expired_sessions
    purge_expired_sessions()


def _migrate_users():
    """
    Phase-1 databases had an older users table (no roles we now use). Because no
    real accounts existed yet, it is safe to rebuild it with the new schema.
    Detection: if the 'full_name' column is missing, recreate the table.
    """
    cols = _table_columns("users")
    if cols and "full_name" not in cols:
        if _is_remote:
            with get_engine().begin() as conn:
                conn.execute(text("DROP TABLE IF EXISTS users"))
        else:
            import sqlite3
            con = sqlite3.connect(str(DB_PATH))
            try:
                con.execute("DROP TABLE IF EXISTS users")
                con.commit()
            finally:
                con.close()
        _run_schema()  # recreate with the new definition


def _migrate_rentals():
    """
    Add the 'created_by' snapshot columns (who booked the rental) to older
    databases. Uses additive ALTER TABLE so existing rentals are preserved; new
    columns default to '' for rows created before this feature.
    """
    cols = _table_columns("rentals")
    if not cols:
        return  # table doesn't exist yet (fresh DB) — schema.sql already has them
    needed = {
        "created_by": "TEXT NOT NULL DEFAULT ''",
        "created_by_name": "TEXT NOT NULL DEFAULT ''",
        "created_by_role": "TEXT NOT NULL DEFAULT ''",
    }
    missing = {c: d for c, d in needed.items() if c not in cols}
    if missing:
        with get_engine().begin() as conn:
            for col, ddl in missing.items():
                conn.execute(text(f"ALTER TABLE rentals ADD COLUMN {col} {ddl}"))


def _migrate_add_columns():
    """
    Additive column migrations for older databases (preserves all data):
      - vehicles.photo : optional base64 car photo
      - users.lang     : the user's preferred UI language
    """
    plan = {
        "vehicles": {"photo": "TEXT NOT NULL DEFAULT ''"},
        "users": {"lang": "TEXT NOT NULL DEFAULT 'tr'", "email": "TEXT NOT NULL DEFAULT ''",
                  # Constant default (not datetime('now')) — SQLite forbids a
                  # non-constant DEFAULT in ADD COLUMN. Empty = never changed.
                  "password_changed_at": "TEXT NOT NULL DEFAULT ''"},
        "rentals": {"invoice_lang": "TEXT NOT NULL DEFAULT 'tr'"},
        "charges": {"note": "TEXT NOT NULL DEFAULT ''"},
    }
    for table, cols in plan.items():
        existing = _table_columns(table)
        if not existing:
            continue
        missing = {c: d for c, d in cols.items() if c not in existing}
        if missing:
            with get_engine().begin() as conn:
                for col, ddl in missing.items():
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))


def _migrate_charges_types():
    """
    Old databases have a narrower CHECK on charges.type (rental/overdue_penalty/
    damage/deposit/refund only). Widen it to include the compensation types added
    for the Damage Compensation ledger (mechanic_fee, traffic_fine, cleaning_fee,
    fuel_shortage, lost_item, other). SQLite can't ALTER a CHECK constraint, so the
    table is rebuilt in place; Postgres can ALTER it directly.
    """
    new_check = (
        "'rental','overdue_penalty','damage','deposit','refund',"
        "'mechanic_fee','traffic_fine','cleaning_fee','fuel_shortage','lost_item','other'"
    )
    if _dialect == "postgresql":
        with get_engine().begin() as conn:
            conn.execute(text("ALTER TABLE charges DROP CONSTRAINT IF EXISTS charges_type_check"))
            conn.execute(text(f"ALTER TABLE charges ADD CONSTRAINT charges_type_check CHECK (type IN ({new_check}))"))
        return
    # sqlite / libsql (Turso)
    with get_engine().begin() as conn:
        ddl = conn.execute(text(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='charges'"
        )).scalar()
        if not ddl or "mechanic_fee" in ddl:
            return  # table doesn't exist yet, or already migrated
        cols = [r[1] for r in conn.execute(text("PRAGMA table_info(charges)")).all()]
        note_expr = "note" if "note" in cols else "''"
        conn.execute(text("ALTER TABLE charges RENAME TO charges_old"))
        conn.execute(text(f"""
            CREATE TABLE charges (
                charge_id   INTEGER PRIMARY KEY AUTOINCREMENT,
                deal_id     TEXT REFERENCES rentals(deal_id),
                vehicle_id  TEXT REFERENCES vehicles(vehicle_id),
                type        TEXT NOT NULL CHECK (type IN ({new_check})),
                amount      INTEGER NOT NULL,
                occurred_at TEXT NOT NULL DEFAULT (datetime('now')),
                note        TEXT NOT NULL DEFAULT ''
            )
        """))
        conn.execute(text(f"""
            INSERT INTO charges (charge_id, deal_id, vehicle_id, type, amount, occurred_at, note)
            SELECT charge_id, deal_id, vehicle_id, type, amount, occurred_at, {note_expr}
            FROM charges_old
        """))
        conn.execute(text("DROP TABLE charges_old"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_charges_deal ON charges(deal_id)"))
        conn.execute(text("CREATE INDEX IF NOT EXISTS idx_charges_vehicle ON charges(vehicle_id)"))


def _migrate_photos():
    """Move any single legacy vehicles.photo into the vehicle_photos table (once)."""
    # _table_columns is dialect-aware (PRAGMA on SQLite, information_schema on Postgres),
    # so this migration is safe on Neon too — raw PRAGMA would error on Postgres.
    if "photo" not in _table_columns("vehicles"):
        return
    with get_engine().connect() as conn:
        legacy = conn.execute(text(
            "SELECT vehicle_id, photo FROM vehicles WHERE photo IS NOT NULL AND photo != ''"
        )).mappings().all()
        already = {r[0] for r in conn.execute(
            text("SELECT DISTINCT vehicle_id FROM vehicle_photos")).all()}
    rows = [r for r in legacy if r["vehicle_id"] not in already]
    if rows:
        with get_engine().begin() as conn:
            for r in rows:
                conn.execute(text(
                    "INSERT INTO vehicle_photos (vehicle_id, photo, position) "
                    "VALUES (:v, :p, 0)"), {"v": r["vehicle_id"], "p": r["photo"]})