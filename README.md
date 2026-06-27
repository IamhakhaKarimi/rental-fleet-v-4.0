# Balkan Car Rentals — Fleet Console v4.0

Migrated off Streamlit to **FastAPI (backend) + Next.js + Tailwind (frontend)**, same
data model and behaviour. DB: **Turso (libSQL)** in production (Neon Postgres also
supported), local **SQLite** in dev.

```
Rental-Fleet-V.4.0/
  backend/    FastAPI — reuses the original Python layers (config/core/data/services/ui)
  frontend/   Next.js App Router + Tailwind
```

Full developer reference: **[`DOCUMENTATION.md`](DOCUMENTATION.md)** · Claude Code
guidance: **[`CLAUDE.md`](CLAUDE.md)** · end-to-end deploy runbook: **[`DEPLOY.md`](DEPLOY.md)**.

## Run locally
```bash
# Backend (SQLite, self-seeds on first run; login admin/admin)
cd backend
python -m pip install -r requirements.txt
python -m uvicorn api.main:app --port 8001          # http://127.0.0.1:8001  (Windows: omit --reload)

# Frontend
cd ../frontend
cp .env.local.example .env.local                    # NEXT_PUBLIC_API_BASE=http://127.0.0.1:8001
npm install
npm run dev                                          # http://localhost:3000
```

> Note: the frontend authenticates with a Bearer JWT (localStorage) so cross-origin
> dev works; production also sets an HttpOnly `bcr_session` cookie.

## Push to GitHub

The local repo is already initialised (branch `main`, hardened `.gitignore` so no
database, secrets, `node_modules` or build output are committed). To publish it to the
existing GitHub repository, **run from the repo root**:

```bash
# 1) Point the local repo at the GitHub remote (HTTPS)
git remote add origin https://github.com/IamhakhaKarimi/rental-fleet-v-4.0.git

# 2) Name the branch main and push every commit, setting the upstream
git branch -M main
git push -u origin main
```

On the **first** push, Git Credential Manager opens a browser to sign in to GitHub — or
paste a [Personal Access Token](https://github.com/settings/tokens) as the password.
Verify with `git remote -v` and `git log --oneline`.

If the GitHub repo already contains commits (e.g. it was created with a README) the push
is rejected as non-fast-forward. Pick one:

```bash
# Option A — merge the remote's history into yours, then push
git pull --rebase origin main --allow-unrelated-histories
git push -u origin main

# Option B — overwrite the remote with your local history (DESTROYS remote commits)
git push -u --force origin main
```

Push later updates with: `git add -A && git commit -m "…" && git push`.

## Deploy

### Database → Turso (libSQL)
- Create a database at **https://app.turso.tech** (or `turso db create balkan-fleet`).
- Copy its URL (`libsql://<db>-<org>.turso.io`) and create an **auth token** — a long
  `eyJ…` JWT. Tables are created automatically on the backend's first boot.

### Backend → Render or Railway (Docker)
- Uses `backend/Dockerfile`. `render.yaml` is a ready blueprint; Railway: point at the same Dockerfile.
- Env vars:
  - `TURSO_DATABASE_URL` — the `libsql://…` URL from Turso.
  - `TURSO_AUTH_TOKEN` — the Turso auth token (`eyJ…`).
  - *(Postgres instead: set `DATABASE_URL`=`postgresql://user:pass@host/db` and leave `TURSO_*` blank — `core/db.py` rewrites it to the pure-Python `pg8000` driver.)*
  - `JWT_SECRET` — long random secret.
  - `CORS_ORIGINS` — your Vercel frontend origin (comma-separated for several).
  - `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none` (frontend and API are different origins).
- `init_db()` runs once at startup (schema + migrations + first-run seed + default admin).

### Frontend → Vercel
- Import the repo, set **root directory** to `frontend/`. Vercel auto-detects Next.js.
- Env var: `NEXT_PUBLIC_API_BASE` = your backend URL (e.g. `https://balkan-fleet-api.onrender.com`).

See **[`DEPLOY.md`](DEPLOY.md)** for the full end-to-end runbook.

## Notes / follow-ups
- The bundled `backend/assets/fonts/DejaVu*.ttf` MUST stay committed (invoice PDF glyphs).
- A security-patched `next@14.2.x` is pinned in `frontend/package.json`.
