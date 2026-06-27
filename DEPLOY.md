# Deploying Balkan Car Rentals — Fleet Console v4.0

**Architecture:** Next.js frontend on **Vercel** → FastAPI backend on **Render** →
**Turso (libSQL)** database. The backend creates all 11 tables in Turso automatically
on its first boot (`init_db()`), so there is no manual "create table" step.

> All four steps need **your** account logins (browser-interactive). Run the auth
> commands, then I can execute the mechanical parts (repo create + push, health
> checks, env wiring) for you.

---

## 0 · Install + log in to the CLIs (one time)

```bash
# GitHub CLI  (Windows)
winget install --id GitHub.cli -e        # then open a NEW terminal
gh auth login                            # GitHub.com → HTTPS → Login with a browser

# Vercel CLI
npm i -g vercel                          # npm is already installed
vercel login

# Turso — easiest on Windows: use the web dashboard at https://app.turso.tech
#   (CLI alternative: `scoop install turso`  or run it inside WSL, then `turso auth login`)
```

---

## 1 · GitHub — create the private repo and push

From the repo root (`Rental-Fleet-V.4.0/`):

```bash
gh repo create rental-fleet-v.4.0 --private --source=. --remote=origin --push
```

(The repo is already initialised with 3 commits; `fleet.db`, `.env*`, `node_modules`
and `.next` are gitignored, so **no customer data or secrets are pushed**.)

---

## 2 · Turso — create the database

**Dashboard (recommended on Windows):** https://app.turso.tech → *Create Database*
→ name it `balkan-fleet` → open it → copy the **Database URL**
(`libsql://balkan-fleet-<org>.turso.io`) and *Create Token* → copy the **auth token**.

**Or via CLI:**
```bash
turso db create balkan-fleet
turso db show balkan-fleet --url        # -> libsql://balkan-fleet-<org>.turso.io
turso db tokens create balkan-fleet     # -> <auth-token>
```

You do **not** create tables by hand — the backend builds the schema on first boot.
Verify after step 3: `turso db shell balkan-fleet ".tables"` (expect `vehicles`,
`customers`, `rentals`, `charges`, `vehicle_costs`, `users`, `sessions`, `audit_log`,
`app_settings`, `vehicle_photos`, `licenses`).

---

## 3 · Render — deploy the backend (Blueprint)

1. https://render.com → **New → Blueprint** → pick the `rental-fleet-v.4.0` repo
   (Render reads `render.yaml`).
2. Fill the prompted env vars:
   | Key | Value |
   |---|---|
   | `TURSO_DATABASE_URL` | the `libsql://…` URL from step 2 |
   | `TURSO_AUTH_TOKEN`   | the token from step 2 |
   | `CORS_ORIGINS`       | `*` for now (tighten in step 5) |
   | `DATABASE_URL`       | **leave blank** (Turso is chosen) |
   | `JWT_SECRET`         | auto-generated — leave it |
   | `COOKIE_SECURE` / `COOKIE_SAMESITE` | preset to `true` / `none` |
3. Deploy, then copy the service URL, e.g. `https://balkan-fleet-api.onrender.com`.
4. Check `…/api/health` → `{"ok":true}` and `…/internal/db-health` →
   `{"dialect":"sqlite","is_remote":true}` (confirms it's talking to Turso).

---

## 4 · Vercel — deploy the frontend

1. https://vercel.com → **Add New → Project** → import the repo.
2. **Root Directory = `frontend`** (this is a monorepo — required).
3. Environment Variable: `NEXT_PUBLIC_API_BASE` = the Render URL from step 3.
4. Deploy, then copy the URL, e.g. `https://rental-fleet-v4.vercel.app`.

---

## 5 · Close the CORS loop + first login

1. In Render, set `CORS_ORIGINS` = your Vercel URL (e.g.
   `https://rental-fleet-v4.vercel.app`) → save (Render redeploys).
2. Open the Vercel URL, log in as **`admin` / `admin`**, and **change the password
   immediately** (Settings → Profile).

Done — the Turso database persists across restarts, so there's no more data loss.
