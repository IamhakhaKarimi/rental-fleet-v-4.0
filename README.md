# Balkan Car Rentals — Fleet Console v4.0

**FastAPI (backend) + React + Tailwind (frontend, built with Vite).** Database:
**SQLite** on local disk, in development and in production alike — see "Why SQLite"
below. Postgres is supported and one env var away when the numbers call for it.

```
Auto Rental Deploy/
  backend/    FastAPI — config / core / data / services / ui layers
  frontend/   Vite + React 18 + React Router + Tailwind
  nginx/      Production Nginx config + the API systemd unit
```

The frontend builds to static files. In production Nginx serves them directly, so
there is no Node process on the server — one service to run, not two.

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
# Terminal 2 — frontend. No env file needed: the Vite dev server proxies /api
# to the backend, so development is same-origin exactly like production.
cd frontend
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

The HttpOnly `bcr_session` cookie is the session, in dev and in production. Because
the dev server proxies `/api`, the cookie is plain same-origin in both — no CORS and
no `SameSite` edge cases. Nothing is written to `localStorage`. The only case that
uses an in-memory Bearer token is an explicitly *remote* `VITE_API_BASE`, where the
cookie cannot follow.

If you bypass the proxy by pointing `VITE_API_BASE` at a loopback URL, the host must
match your address bar: a page on `localhost:3000` calling `127.0.0.1:8001` counts as
cross-site, and `SameSite=Strict` drops the session silently — you log in cleanly and
then get 401s.

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
| `frontend/.env.production.example` | `VITE_API_BASE=same-origin` |
| `nginx/balkan-fleet.conf.example` | TLS, rate limits, the `/api` proxy, static serving + SPA fallback |
| `nginx/balkan-fleet-api.service.example` | systemd unit for uvicorn (the only service) |

Three things are easy to get wrong, and all are covered in `DEPLOY.md`:

- **`TRUST_PROXY` and the Nginx `X-Forwarded-For` header ship together.** Behind Nginx
  the API otherwise sees only `127.0.0.1`, which collapses every visitor into one
  rate-limit bucket. Set it true *without* Nginx populating the header and clients can
  spoof their own IP and skip rate limiting entirely.
- **Keep uvicorn at one worker.** The rate limiter counts in process memory, so two
  workers silently double every limit.
- **Keep the SPA fallback.** Routing happens in the browser, so `/customers` and
  `/invoices/<id>` are not files on disk. Without
  `try_files $uri $uri/ /index.html;` they work when clicked and 404 when reloaded.

---

## Notes

- The bundled `backend/assets/fonts/DejaVu*.ttf` **must stay committed** — invoice PDFs
  need them for Turkish and Albanian glyphs.
- `/internal/stats` exposes per-route timings and must stay blocked at the edge. The
  shipped Nginx config already returns 404 for `/internal/`.
