# Balkan Car Rentals — Fleet Console v4.0

Migrated off Streamlit to **FastAPI (backend) + Next.js + Tailwind (frontend)**, same
data model and behaviour. DB: **Neon Postgres** in production, local **SQLite** in dev.

```
Rental-Fleet-V.4.0/
  backend/    FastAPI — reuses the original Python layers (config/core/data/services/ui)
  frontend/   Next.js App Router + Tailwind
```

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

## Deploy

### Backend → Render or Railway (Docker)
- Uses `backend/Dockerfile`. `render.yaml` is a ready blueprint; Railway: point at the same Dockerfile.
- Env vars:
  - `DATABASE_URL` — Neon Postgres URL (`postgresql://user:pass@host/db`). `core/db.py` rewrites it to the pure-Python `pg8000` driver.
  - `JWT_SECRET` — long random secret.
  - `CORS_ORIGINS` — your Vercel frontend origin (comma-separated for several).
  - `COOKIE_SECURE=true`, `COOKIE_SAMESITE=none` (frontend and API are different origins).
- `init_db()` runs once at startup (schema + migrations + first-run seed + default admin).

### Frontend → Vercel
- Import the repo, set **root directory** to `frontend/`. Vercel auto-detects Next.js.
- Env var: `NEXT_PUBLIC_API_BASE` = your backend URL (e.g. `https://balkan-fleet-api.onrender.com`).

## Notes / follow-ups
- The bundled `backend/assets/fonts/DejaVu*.ttf` MUST stay committed (invoice PDF glyphs).
- A security-patched `next@14.2.x` is pinned in `frontend/package.json`.
- Photo-upload UI (Fleet edit dialog) is the one remaining UI piece; the backend
  endpoints (`POST /api/vehicles/{id}/photos`, `DELETE /api/vehicles/photos/{id}`) are live.
