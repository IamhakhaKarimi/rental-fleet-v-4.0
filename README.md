# Balkan Car Rentals — Fleet Console v4.0

**FastAPI (backend) + Next.js + Tailwind (frontend).** Database: **SQLite** on local
disk, in development and in production alike — see "Why SQLite" below. Postgres is
supported and one env var away when the numbers call for it.

```
Auto Rental Deploy/
  backend/    FastAPI — config / core / data / services / ui layers
  frontend/   Next.js App Router + Tailwind
  nginx/      Production Nginx config + two systemd units
```

Full developer reference: **[`DOCUMENTATION.md`](DOCUMENTATION.md)** · Claude Code
guidance: **[`CLAUDE.md`](CLAUDE.md)** · deployment runbook: **[`DEPLOY.md`](DEPLOY.md)**.

---

## Run locally (two terminals)

```bash
# Terminal 1 — backend. Creates fleet.db and seeds from fleet_master.csv on first run.
cd backend
python -m pip install -r requirements.txt
python -m uvicorn api.main:app --port 8001          # http://127.0.0.1:8001
```

```bash
# Terminal 2 — frontend
cd frontend
cp .env.local.example .env.local                    # NEXT_PUBLIC_API_BASE=http://127.0.0.1:8001
npm install
npm run dev                                          # http://localhost:3000
```

Health check: `curl http://127.0.0.1:8001/api/health`.

### First login

There is **no `admin`/`admin` default.** On a genuinely empty database,
`ensure_bootstrap_admin()` creates one account:

- Set `BOOTSTRAP_ADMIN_USER` and `BOOTSTRAP_ADMIN_PASSWORD` to choose the credentials.
  These are **required** when `COOKIE_SECURE=true`.
- Leave them unset in development and a random password is generated and printed to
  the backend log **once**. Copy it when you see it.

### Auth in development

The HttpOnly `bcr_session` cookie is the session, in dev and in production. It works
across `localhost:3000` → `127.0.0.1:8001` because `SameSite=Strict` ignores the port.
Nothing is written to `localStorage`. The only case that uses an in-memory Bearer token
is an explicitly *remote* `NEXT_PUBLIC_API_BASE`, where the cookie cannot follow.

---

## Why SQLite, and when to change

SQLite handles one writer with many concurrent readers. A handful of staff doing
bookings and invoices is nowhere near that ceiling — the production database is
currently a few hundred kilobytes.

**The code is already Postgres-ready.** `core/db.py` carries a complete dual-dialect
layer; `DATABASE_URL=postgres://…` genuinely is the migration.

Don't do it yet. The app is chatty by design — generating one invoice PDF opens ten
connections. Against a local file each costs nothing; against a *managed* remote
Postgres each becomes a network round-trip, and the measurements in
[`DOCUMENTATION.md`](DOCUMENTATION.md) §8.11 say that would make the app slower, not
faster. Migrate on the measured trigger in §8.8 — sustained `db.sqlite_busy` events at
`/internal/stats` — not on a hunch. Slow *reads* are evidence for query work, never for
migrating, because SQLite's ceiling is its single writer.

Wherever it runs, keep `backend/fleet.db` **on local disk**. Never a network share or a
OneDrive/Dropbox-synced folder, where concurrent writes can corrupt it.

---

## Deploy

Target: **one VPS, Nginx out front, same origin.** The frontend is served at `/` and
the API is proxied at `/api`, so the two share an origin. That is a security
requirement rather than a convenience — it removes CORS entirely and is what makes the
HttpOnly session cookie work.

Everything needed is in the repo:

| File | What it is |
|---|---|
| [`DEPLOY.md`](DEPLOY.md) | The step-by-step runbook. Start here. |
| `.env.production.example` | Backend environment template |
| `frontend/.env.production.example` | `NEXT_PUBLIC_API_BASE=same-origin` |
| `nginx/balkan-fleet.conf.example` | TLS, rate limits, the `/api` proxy |
| `nginx/balkan-fleet-api.service.example` | systemd unit for uvicorn |
| `nginx/balkan-fleet-web.service.example` | systemd unit for `next start` |

Two settings are easy to get wrong, and both are covered in `DEPLOY.md`:

- **`TRUST_PROXY` and the Nginx `X-Forwarded-For` header ship together.** Behind Nginx
  the API otherwise sees only `127.0.0.1`, which collapses every visitor into one
  rate-limit bucket. Set it true *without* Nginx populating the header and clients can
  spoof their own IP and skip rate limiting entirely.
- **Keep uvicorn at one worker.** The rate limiter counts in process memory, so two
  workers silently double every limit.

---

## Notes

- The bundled `backend/assets/fonts/DejaVu*.ttf` **must stay committed** — invoice PDFs
  need them for Turkish and Albanian glyphs.
- `frontend/package.json` pins a security-patched `next@14.2.x`.
- `/internal/stats` exposes per-route timings and must stay blocked at the edge. The
  shipped Nginx config already returns 404 for `/internal/`.
