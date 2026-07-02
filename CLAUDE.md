# CLAUDE.md — Rental Fleet v4.0

This file is Claude Code guidance for the **Balkan Car Rentals — Fleet Console** project.

---

## Project Identity

- **App name:** Balkan Car Rentals — Fleet Console
- **Version:** v4.0 (reference baseline — see `../Rental-Fleet-V.4.1` for the production-hardening fork)
- **Full docs:** See [DOCUMENTATION.md](./DOCUMENTATION.md)
- **Database schema:** See [backend/core/schema.sql](./backend/core/schema.sql)

---

## How to Run Locally

### Backend (FastAPI)

```bash
cd backend
pip install -r requirements.txt
uvicorn api.main:app --reload --port 8001
```

- API base: `http://127.0.0.1:8001`
- First run creates `fleet.db` (SQLite) and seeds it from `fleet_master.csv`.
- Health check: `GET /api/health`

### Frontend (Next.js)

```bash
cd frontend
npm install
npm run dev
```

- UI: `http://localhost:3000`
- Requires `.env.local` with `NEXT_PUBLIC_API_BASE=http://127.0.0.1:8001`

### Default admin credentials (first run)

Created automatically by `init_db()` if no `super_admin` exists.
Check `services/auth_service.py` `ensure_default_admin()` for the seeded username and password.

---

## Architecture at a Glance

```
frontend/          Next.js 14 App Router (TypeScript, Tailwind 3.4)
backend/
  api/             FastAPI app layer (routers, settings, deps, security)
  config/          Shared config: roles, i18n (6 langs), rental terms
  core/            DB engine, schema.sql, migrations
  data/            Repositories (all SQL), seed/CSV importer
  services/        Business logic: auth, finance, scheduling, licensing, email, audit
  ui/              Invoice builders, PDF, photo encoding, theme, notifications
```

**Layer rule:** Routers → Services → Repositories → DB. No SQL in routers or services.

---

## Key Directories & Files

| Path | What it is |
|---|---|
| `backend/api/main.py` | FastAPI app factory; mounts all 17 routers |
| `backend/api/deps.py` | `get_current_user()`, `require(perm)` dependencies |
| `backend/config/roles.py` | 4 roles × 25 permissions, `can(user, perm)` |
| `backend/core/db.py` | Engine init (SQLite / Turso libSQL / Neon Postgres), `init_db()`, migrations |
| `backend/core/schema.sql` | 11 tables, 9 indexes |
| `backend/services/auth_service.py` | Password hashing, login, temp password |
| `backend/services/scheduling_service.py` | Availability check, return window |
| `backend/ui/invoice_links.py` | QR payloads + per-QR guided action buttons |
| `frontend/lib/api.ts` | Fetch wrapper + Bearer JWT auth |
| `frontend/lib/auth.tsx` | `useAuth()` context |
| `frontend/lib/i18n.tsx` | `useT()` i18n context |
| `frontend/lib/toast.tsx` | `useToast()` — portal-rendered success/error/info toasts |
| `frontend/lib/types.ts` | All TypeScript interfaces |
| `frontend/components/ViewToggle.tsx` | Shared card/table view switch (Fleet, Reservations, Customers) |

---

## Database

- **Dev:** SQLite (`fleet.db` in backend dir); no setup needed.
- **Prod:** Set `DATABASE_URL` (or `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN`) to a Turso libSQL or Neon Postgres URL.
- **Money:** Always stored as INTEGER cents. Never store floats.
- **Dates:** Always ISO-8601 text (`YYYY-MM-DDTHH:MM:SS` or `YYYY-MM-DD`).
- **Schema file:** `backend/core/schema.sql` — 11 tables, all `CREATE IF NOT EXISTS`.

### Tables (brief)

| Table | Purpose |
|---|---|
| `vehicles` | Fleet inventory |
| `customers` | Rental clients |
| `rentals` | Bookings (deal_id = `RENT-YYYYMM-NNN`) |
| `charges` | Income ledger (rental / penalty / damage / deposit / refund) |
| `vehicle_costs` | Expense ledger (7 cost types) |
| `users` | Staff accounts |
| `audit_log` | Immutable mutation trail |
| `app_settings` | Key-value store (theme, business info, SMTP) |
| `vehicle_photos` | Multiple photos per vehicle (lazy-loaded) |
| `licenses` | License purchase records |

---

## RBAC

Roles: `visitor(0)` < `employer(1)` < `admin(2)` < `super_admin(3)`

- Permission checks are **server-side only**. Frontend mirrors are for UI gating, not security.
- Always use `deps.require("perm_name")` as a FastAPI dependency on privileged routes.
- Last-active-super-admin cannot be demoted or deleted.
- `backup_database` (admin+, level 2) gates every export/import endpoint under `/api/data/*`.

---

## Coding Conventions

### Backend (Python)

- All SQL goes in `data/repositories/`. Routers never call `execute()` directly.
- Services have no DB I/O — they call repositories and contain business logic only.
- Money arithmetic: `int(round(value * 100))` for euros→cents input.
- Audit service calls are best-effort: wrap in try/except where they'd block the main flow.
- `audit_service` should be called in routers after a successful mutation, not inside services.
- Use `deps.require("perm")` — never hardcode role strings in router bodies.

### Frontend (TypeScript / Next.js)

- All API calls go through `lib/api.ts` — never use `fetch()` directly in components.
- Money display: always use `formatEur(cents)` from `lib/money.ts`.
- Permission checks in UI: use `can(user, "perm")` from `lib/perms.ts`.
- i18n: always use `t("key")` / the `tf(key, fallback)` pattern from `useT()` — never hardcode English strings in JSX without a fallback.
- CRUD confirmations: use `useToast()` from `lib/toast.tsx`, not `alert()`.
- Customer name input must be uppercased before API submission.
- A page offering both a detail-card list and a table view of the same rows should use the shared `ViewToggle` component, with the choice persisted per-page in `localStorage`.

---

## API Conventions

- **Auth:** Bearer JWT in `Authorization` header (dev) or HttpOnly cookie (prod).
- **Money:** All money fields in request/response are INTEGER cents.
- **IDs:** Vehicle IDs are `C###` strings. Rental IDs are `RENT-YYYYMM-NNN` strings.
- **Error shape:** `{"detail": "Human-readable message"}` with appropriate HTTP status.
- **Availability re-check:** The booking endpoint always re-checks availability server-side, even if the client already called the availability endpoint.

---

## i18n

- 6 languages: Turkish (`tr` — default), English (`en`), German (`de`), Italian (`it`), Spanish (`es`), Albanian (`sq`).
- Invalid language codes fall back to `tr`.
- Translation bundles: `GET /api/i18n/{lang}.json`.
- Rental terms: `GET /api/i18n/terms/{lang}` (13 rules). Printed on invoices.

---

## Invoice & PDF Rules

- Invoices always render **2 A4 copies** side-by-side (customer + office), each on its own page.
- Seal: stamp image takes precedence over logo if both exist.
- QR codes: up to 2 per invoice — a **contact vCard** and/or a **SEPA payment** QR. When no business contact info is configured, a **fallback rental-summary QR** (built purely from the deal) takes the contact QR's place, so every invoice always shows at least one QR.
- Each QR's encoded actions (call / WhatsApp / map / IBAN / email) also render as **tappable, labelled buttons** directly beneath it, so a digital reader can act without scanning.
- SEPA QR only generated when `pay_qr_enabled = true` AND `iban` is set AND `balance_due > 0`.
- PDF fonts: DejaVuSans (bundled in `backend/assets/fonts/`) for Turkish/Albanian glyphs.

---

## Recent Updates (this session)

- **Invoices:** fallback summary QR + per-QR guided action buttons (see "Invoice & PDF Rules" above).
- **Dashboard (`/`):** availability date-range picker moved into a modal (OK/Cancel), now shows the exact day count next to the selected dates; once a window is chosen, the free-car list renders as a swipeable, wrap-around carousel with prev/next pagination buttons (`app/(app)/page.tsx`).
- **BookingDialog:** the negotiated daily rate has +/-5 stepper buttons alongside the numeric input.
- **Fleet / Reservations / Customers pages:** each got a shared card ⇄ table view toggle (`components/ViewToggle.tsx`, choice persisted in `localStorage` per page). Table rows carry the same CRUD/status actions as the cards.
- **Settings → Backup:** two new export formats — `GET /api/data/backup-single.csv` (every table concatenated into one CSV) and `GET /api/data/backup.sqlite` (a portable single-file SQLite database), alongside the existing JSON and per-table-CSV-zip exports.
- **Timeline:** the "Active Rental Bar Gradient" theme selector (Settings → Select Theme) now paints **all** active (ok-tone) rental bars, not just already-started ones — previously the gradient only affected bars whose start date had been reached.
- **Reservations:** rental start/return dates can now be edited in place (`update_rental_dates` in `data/repositories/rentals.py`), with clash detection against other active bookings of the same vehicle.
- **New:** `frontend/lib/toast.tsx` — lightweight, portal-rendered toast notifications (`useToast().success/error/info`), replacing raw `alert()` calls across CRUD flows.
- **New:** `backend/api/routers/customer_reports.py` — `GET /api/reports/customers-timeline.pdf` and `GET /api/reports/customers.csv`, a per-customer rental timeline report (active + closed rentals).
- **Finance page:** overview redesigned as a bento board (mirrors the dashboard's "Fleet at a glance" layout) with a hero net-profit/margin card.
- **Theme:** `bar_gradient_start` / `bar_gradient_end` are now stored theme keys (`app_settings` table, `theme_bar_gradient_*`).

---

## What NOT to Change Without Careful Review

- `core/schema.sql` — migrations must be additive (`ALTER TABLE` via `core/db.py`, not raw schema edits).
- `config/roles.py` — permission names are referenced by string throughout the codebase.
- Vehicle ID format (`C###`) and Rental ID format (`RENT-YYYYMM-NNN`) — used as FK references.
- Money storage convention (cents as INTEGER) — changing this requires a full data migration.
- `audit_service` calls — removing them silently breaks the audit trail.

---

## Deployment Targets (Production)

| Layer | Service |
|---|---|
| Database | Turso (libSQL) or Neon (Postgres) |
| Backend | Render or Railway (`backend/Dockerfile`) |
| Frontend | Vercel (`frontend/` root dir) |

Refer to `DEPLOY.md` for the step-by-step deployment runbook.
