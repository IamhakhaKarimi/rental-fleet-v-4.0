# Deploying Balkan Car Rentals — Fleet Console v4.0

**Architecture: single VPS, same-origin.** Nginx terminates TLS and serves the
Next.js frontend at `/`, proxying `/api` to a single uvicorn process running
the FastAPI backend, which talks to SQLite on local disk. See CLAUDE.md →
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
| `frontend/.env.production.example` | Frontend `.env.production` — one line, `NEXT_PUBLIC_API_BASE=same-origin` |
| `nginx/balkan-fleet.conf.example` | The Nginx same-origin config (TLS, `/api` proxy, L0 rate/connection limits, `X-Forwarded-For`) |
| `nginx/balkan-fleet-api.service.example` | systemd unit for the backend (single uvicorn process — see the file for why) |
| `nginx/balkan-fleet-web.service.example` | systemd unit for the frontend (`next start`) |

---

## 0 · Provision the VPS

Any small Linux VPS works — this app is chatty against SQLite (see the
"Database" note in CLAUDE.md) but each round-trip is nearly free locally, so
it does not need much CPU or RAM. You need:

```bash
sudo apt update && sudo apt install -y python3.11-venv nginx certbot python3-certbot-nginx
# Node 20+ for the frontend build — via nodesource or nvm, whichever you prefer
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

```bash
cd /opt/balkan-fleet/frontend
sudo -u balkan-fleet npm install
cp .env.production.example .env.production   # NEXT_PUBLIC_API_BASE=same-origin
sudo -u balkan-fleet npm run build

sudo cp ../nginx/balkan-fleet-web.service.example /etc/systemd/system/balkan-fleet-web.service
sudo systemctl daemon-reload
sudo systemctl enable --now balkan-fleet-web
curl -s http://127.0.0.1:3000/ | head -c 200   # some HTML
```

---

## 4 · Nginx + TLS

```bash
sudo cp ../nginx/balkan-fleet.conf.example /etc/nginx/sites-available/balkan-fleet.conf
# edit server_name and the two ssl_certificate paths for your domain
sudo ln -s /etc/nginx/sites-available/balkan-fleet.conf /etc/nginx/sites-enabled/
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
cd ../frontend && sudo -u balkan-fleet npm install && sudo -u balkan-fleet npm run build
sudo systemctl restart balkan-fleet-api balkan-fleet-web
```

`fleet.db` lives outside both service's build output, so restarting either
service never touches it.

## Verifying the hardening actually took effect

- `GET /internal/db-health` and `GET /internal/stats` (both `require_level(2)`
  — log in as an admin+ account, call with your session cookie) — confirm the
  dialect is `sqlite`, `is_remote` is `false`, and p95 latencies look sane.
- `journalctl -u balkan-fleet-api -f` — the `db.sqlite_busy` counter in
  `/internal/stats`'s `events` is the §8.8 SQLite→Postgres migration trigger;
  it should stay at 0 under normal load. Migrate on evidence there, not on a
  hunch (see the "Database" note in CLAUDE.md).
- Confirm `curl -I https://fleet.example.com/internal/stats` (no cookie) is
  blocked at the Nginx layer (404) before it even reaches the app's own
  permission check.
