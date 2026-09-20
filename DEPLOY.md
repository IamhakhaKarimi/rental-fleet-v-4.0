# Deploying Balkan Car Rentals — Fleet Console v4.0

**Architecture: single VPS, same-origin.** Nginx terminates TLS, serves the
frontend as static files at `/`, and proxies `/api` to a single uvicorn process
running the FastAPI backend, which talks to SQLite on local disk. The frontend
is a Vite build, so **there is no Node process in production** — one systemd
unit, not two. See CLAUDE.md →
"Deployment Targets (Production)" for why this replaced the earlier
Vercel + Render + Turso split (same-origin is a security requirement — it
removes CORS entirely and is what makes the `HttpOnly` + `SameSite=Strict`
cookie work — and SQLite stays local rather than moving to a managed remote
database that would only make the app *slower*; see the "Database" note in
CLAUDE.md).

**Config templates live in this repo:**

| File | What it's for |
|---|---|
| `.env.production.example` | Backend `.env` — every knob in `backend/api/settings.py`, with the ones the boot guard actually requires called out |
| `frontend/.env.production.example` | Frontend `.env.production` — one line, `VITE_API_BASE=same-origin` |
| `nginx/balkan-fleet.conf.example` | The Nginx same-origin config (TLS, `/api` proxy, L0 rate/connection limits, `X-Forwarded-For`) |
| `nginx/balkan-fleet-api.service.example` | systemd unit for the backend (single uvicorn process — see the file for why) |

---

## 0 · Provision the VPS

Any small Linux VPS works — this app is chatty against SQLite (see the
"Database" note in CLAUDE.md) but each round-trip is nearly free locally, so
it does not need much CPU or RAM. You need:

```bash
sudo apt update && sudo apt install -y python3.11-venv nginx certbot python3-certbot-nginx
# Node 20+ — needed to BUILD the frontend only; nothing Node runs at serve time
```

Create a dedicated non-root user the systemd units run as:

```bash
sudo useradd --system --create-home --shell /usr/sbin/nologin balkan-fleet
sudo mkdir -p /opt/balkan-fleet
sudo chown balkan-fleet:balkan-fleet /opt/balkan-fleet
```

---

## 1 · Get the code onto the box

```bash
sudo -u balkan-fleet git clone <your-repo-url> /opt/balkan-fleet
cd /opt/balkan-fleet
```

(`fleet.db`, `.env*`, `node_modules` and `.next` are gitignored — cloning
never brings customer data or secrets with it.)

---

## 2 · Backend

```bash
cd /opt/balkan-fleet/backend
sudo -u balkan-fleet python3 -m venv .venv
sudo -u balkan-fleet .venv/bin/pip install -r requirements.txt

cp ../.env.production.example .env
# Edit .env now. REQUIRED (the boot guard refuses to start without these once
# COOKIE_SECURE=true):
#   JWT_SECRET               — python -c "import secrets; print(secrets.token_urlsafe(48))"
#   BOOTSTRAP_ADMIN_USER      — your first admin's username
#   BOOTSTRAP_ADMIN_PASSWORD  — must pass the password policy (10+ chars, 3 of 4 classes)
#   APP_BASE_URL / CORS_ORIGINS — your real domain, e.g. https://fleet.example.com
```

First boot creates `fleet.db` and seeds it from `fleet_master.csv`, then seeds
exactly the one bootstrap admin from the env vars above and never again (see
`services/auth_service.py#ensure_bootstrap_admin`) — there is no more
`admin`/`admin`.

```bash
sudo cp ../nginx/balkan-fleet-api.service.example /etc/systemd/system/balkan-fleet-api.service
# edit the WorkingDirectory/User/paths inside if you didn't use /opt/balkan-fleet
sudo systemctl daemon-reload
sudo systemctl enable --now balkan-fleet-api
sudo systemctl status balkan-fleet-api   # should be active (running)
curl -s http://127.0.0.1:8001/api/health # {"ok":true,"service":"balkan-fleet-api"}
```

---

## 3 · Frontend

The frontend is a static bundle. You build it once and Nginx serves the files —
there is no service to enable and nothing listening on :3000.

```bash
cd /opt/balkan-fleet/frontend
sudo -u balkan-fleet npm ci
cp .env.production.example .env.production   # VITE_API_BASE=same-origin
sudo -u balkan-fleet npm run build           # typechecks, then emits dist/

ls dist/index.html dist/assets/              # should exist
```

`VITE_API_BASE` is inlined at BUILD time, so it must be in place *before*
`npm run build`, not after. With it set to `same-origin` every API call is a
plain relative `/api/...` fetch that Nginx proxies — no CORS, no port.

---

## 4 · Nginx + TLS

```bash
sudo cp ../nginx/balkan-fleet.conf.example /etc/nginx/sites-available/balkan-fleet.conf
# edit server_name and the two ssl_certificate paths for your domain
sudo ln -s /etc/nginx/sites-available/balkan-fleet.conf /etc/nginx/sites-enabled/
# Also set `root` to your real path if you did not use /opt/balkan-fleet, and
# make sure nginx can read it: the dist/ directory must be traversable by the
# nginx user (www-data), not only by balkan-fleet.
sudo nginx -t && sudo systemctl reload nginx

# First cert issuance (certbot's Nginx plugin edits the file in place to add
# the redirect + cert paths automatically — safe to run even though the
# template above already has both):
sudo certbot --nginx -d fleet.example.com
```

`TRUST_PROXY=true` in `backend/.env` and the `proxy_set_header X-Forwarded-For
$remote_addr;` line in the Nginx config **must ship together** — see the
comment in `nginx/balkan-fleet.conf.example` for why either one alone is
worse than neither (CLAUDE.md → "Sequencing constraints").

---

## 5 · First login

Open `https://fleet.example.com`, log in with the `BOOTSTRAP_ADMIN_USER` /
`BOOTSTRAP_ADMIN_PASSWORD` from step 2, and **change the password immediately**
(Settings → Profile) — the bootstrap credentials are the only account that
exists on a fresh install.

---

## Updating

```bash
cd /opt/balkan-fleet && sudo -u balkan-fleet git pull
cd backend  && sudo -u balkan-fleet .venv/bin/pip install -r requirements.txt
cd ../frontend && sudo -u balkan-fleet npm ci && sudo -u balkan-fleet npm run build
sudo systemctl restart balkan-fleet-api
```

Only the API restarts — the frontend is files on disk, live the moment the build
finishes. Asset filenames are content-hashed, so a returning browser picks up the
new build without a cache purge (the Nginx config marks `/assets/` immutable and
`index.html` no-cache, which is what makes that safe).

`fleet.db` lives outside the build output, so none of this touches it.

## Verifying the hardening actually took effect

- Open the site, then **reload while on a sub-page** such as
  `https://fleet.example.com/customers`, and open an invoice link directly.
  Both must render, not 404. This is the single most likely thing to be wrong
  after a first deploy: routing lives in the browser, so those paths exist on
  no disk anywhere, and only the `try_files $uri $uri/ /index.html;` line in
  the Nginx config makes them work. Clicking through to a page succeeds even
  when it is missing — reloading is what exposes it.
- `GET /internal/db-health` and `GET /internal/stats` (both `require_level(2)`
  — log in as an admin+ account, call with your session cookie) — confirm the
  dialect is `sqlite`, `is_remote` is `false`, and p95 latencies look sane.
- `journalctl -u balkan-fleet-api -f` — the `db.sqlite_busy` counter in
  `/internal/stats`'s `events` is the §8.8 SQLite→Postgres migration trigger;
  it should stay at 0 under normal load. Migrate on evidence there, not on a
  hunch (see the "Database" note in CLAUDE.md). The threshold is stated
  concretely in DOCUMENTATION.md §8.8: **more than 10 events per hour sustained
  across a working day.** Sample it at a fixed hour — the counter is in-process
  and resets on restart, so the delta between two samples is the real number.

### If you do migrate to Postgres later

Set `DATABASE_URL=postgres://…` and restart. That genuinely is the migration —
`core/db.py` carries a complete dual-dialect layer, and the four defects that
would have bitten on the way across (backup-restore sequence desync, a
`strftime` shim that returned unformatted input, a `DROP TABLE` missing
`CASCADE`, and TLS forced even on a loopback connection) are fixed. Three
things to know before you do:

- **Put Postgres on this same VPS.** A managed remote instance would make the
  app slower, not faster — DOCUMENTATION.md §8.11 measures one invoice PDF at
  10 connection opens, which is free locally and 20–50 ms each over a network.
  TLS is applied automatically for a remote host and skipped for a loopback one,
  so a local install needs no SSL setup.
- **Rehearse it first.** The migration was verified end to end against Postgres
  16 — schema, migrations, shims, a full 962-row restore, and identical finance
  figures on both engines (§8.8). Repeat that on your own data before switching:
  export a backup, restore it into the new database, and compare the Finance page
  against the SQLite one before you point the app at it.
- **There is no schema-version tool.** Migrations are hand-rolled in
  `core/db.py#init_db` and detect their own need by inspecting columns rather
  than reading a version number. Adding Alembic is worth doing *before* the
  schema next changes, not during the dialect switch.
- Confirm `curl -I https://fleet.example.com/internal/stats` (no cookie) is
  blocked at the Nginx layer (404) before it even reaches the app's own
  permission check.
