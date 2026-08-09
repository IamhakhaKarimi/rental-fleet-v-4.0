# Rental Fleet v4.0 — Technical Documentation

## Table of Contents

- [Recent Updates](#recent-updates)

1. [Project Overview](#1-project-overview)
2. [Repository Layout](#2-repository-layout)
3. [Frontend](#3-frontend)
   - 3.1 Stack & Dependencies
   - 3.2 Pages & Routes
   - 3.3 Reusable Components
   - 3.4 State Management & Contexts
   - 3.5 Theming & Night Mode
   - 3.6 Internationalisation (i18n)
   - 3.7 Environment Variables
4. [Backend](#4-backend)
   - 4.1 Stack & Dependencies
   - 4.2 Project Structure
   - 4.3 Application Entry Point
   - 4.4 Configuration & Settings
   - 4.5 Authentication & Security
   - 4.6 RBAC & Permissions
   - 4.7 API Endpoints (full reference)
   - 4.8 Services Layer
   - 4.9 Repository Layer
5. [Database](#5-database)
   - 5.1 Engine Support
   - 5.2 Schema — All Tables
   - 5.3 Indexes
   - 5.4 Data Conventions
   - 5.5 Seed & Reset
6. [Deployment](#6-deployment)
7. [Environment Reference](#7-environment-reference)
8. [Security & Runtime Hardening](#8-security--runtime-hardening) — **production-readiness plan**
   - 8.1 Threat Model & Deployment Shape
   - 8.2 Audit Findings (severity-ranked)
   - 8.3 Layered Rate Limiting (L0–L4)
   - 8.4 Concurrency & Thread Saturation
   - 8.5 Session & Authentication Model
   - 8.6 Runtime Performance
   - 8.7 Tuning Knobs
   - 8.8 SQLite → Postgres Migration Trigger
   - 8.9 Nginx Reference Configuration
   - 8.10 Phased Rollout & Verification
   - 8.11 Phase 0 — Measured Baseline

---

## Recent Updates

Additions made in the most recent working session, on top of the baseline described in the rest of this document:

- **Invoices** (`ui/invoice.py`, `ui/invoice_links.py`): every invoice now always renders at least one QR code. When no business contact info (phone/email/address) is configured, a **fallback rental-summary QR** — built purely from the deal — takes the contact QR's place. Each QR's encoded actions (call, WhatsApp, map, IBAN, email) also render as **tappable, labelled buttons** directly beneath it on the HTML invoice, so a digital reader can act on the invoice without scanning.
- **Dashboard** (`app/(app)/page.tsx`): the availability date-range picker moved into a modal with OK/Cancel, and now shows the exact day count next to the selected dates. Once a window is chosen, the free-car list renders as a swipeable, wrap-around carousel with prev/next pagination buttons (paging past the last card loops to the first).
- **BookingDialog** (`components/BookingDialog.tsx`): the negotiated daily rate field gained +/-5 stepper buttons.
- **Fleet / Reservations / Customers pages**: each got a shared card ⇄ table view toggle (new `components/ViewToggle.tsx`), with the chosen view persisted per page in `localStorage`. Table rows carry the same CRUD/status actions as the cards.
- **Settings → Backup**: two new export formats alongside the existing JSON and per-table CSV-zip — `GET /api/data/backup-single.csv` (every table concatenated into one CSV file) and `GET /api/data/backup.sqlite` (a portable single-file SQLite database, built from the same snapshot used by the other exports).
- **Timeline**: the "Active Rental Bar Gradient" theme selector (Settings → Select Theme) now paints **all** active (ok-tone) rental bars, not only ones whose start date has already been reached — previously the configured gradient had no visible effect on upcoming reservations.
- **Reservations**: rental start/return dates can now be edited in place (`update_rental_dates()` in `data/repositories/rentals.py`), with clash detection against other active bookings of the same vehicle.
- **New:** `frontend/lib/toast.tsx` — lightweight, portal-rendered toast notifications (`useToast().success/error/info`), used across CRUD flows instead of `alert()`.
- **New:** `backend/api/routers/customer_reports.py` — a per-customer rental timeline report, both as PDF and CSV (`GET /api/reports/customers-timeline.pdf`, `GET /api/reports/customers.csv`).
- **Finance page**: the Overview tab was redesigned as a bento board (mirrors the dashboard's "Fleet at a glance" layout), with a hero net-profit/margin card.
- **Theme**: `bar_gradient_start` / `bar_gradient_end` are now stored theme keys (`app_settings` table, `theme_bar_gradient_*`), editable from Settings → Select Theme.
- **RBAC**: new `backup_database` permission (admin+, level 2) gates every export/import endpoint under `/api/data/*`.

---

## 1. Project Overview

**Balkan Car Rentals — Fleet Console** is a full-stack vehicle rental management platform. It handles the complete lifecycle of a car rental business: fleet inventory, customer records, bookings, invoicing, financial reporting, staff management, and audit logging.

| Dimension | Value |
|---|---|
| API version | 3.2 |
| Frontend framework | Next.js 14 (App Router) |
| Backend framework | FastAPI (Python 3.9+) |
| Primary database | SQLite (dev) / Turso libSQL or Neon Postgres (prod) |
| Languages | Turkish, English, Albanian |
| User roles | visitor · employer · admin · super_admin |
| API routes | 95+ |
| Database tables | 11 |

---

## 2. Repository Layout

```
Rental-Fleet-V.4.0/
├── backend/
│   ├── Dockerfile                  # Production container (Railway/Render)
│   ├── requirements.txt            # Python deps
│   ├── fleet_master.csv            # Initial fleet seed data
│   ├── assets/fonts/               # DejaVuSans*.ttf (PDF glyph support)
│   │
│   ├── api/                        # FastAPI app layer
│   │   ├── main.py                 # App factory, CORS, router mounts, lifespan
│   │   ├── settings.py             # Pydantic BaseSettings (env-driven)
│   │   ├── deps.py                 # get_current_user(), require(perm), scope helpers
│   │   ├── security.py             # JWT issue/verify, cookie read/write
│   │   ├── .env.example
│   │   └── routers/                # 15 domain routers (one file per domain)
│   │       ├── auth.py
│   │       ├── vehicles.py
│   │       ├── rentals.py
│   │       ├── customers.py
│   │       ├── customer_reports.py # Per-customer rental timeline report (PDF + CSV)
│   │       ├── finance.py
│   │       ├── finance_reports.py
│   │       ├── invoices.py
│   │       ├── license_keys.py
│   │       ├── settings_account.py
│   │       ├── settings_business.py
│   │       ├── i18n.py
│   │       ├── meta.py
│   │       ├── notifications.py
│   │       ├── activity.py
│   │       ├── photos.py
│   │       └── timeline.py
│   │
│   ├── config/                     # Shared config (roles, i18n, terms)
│   │   ├── roles.py                # 4 roles × 25 permissions, can(user, perm)
│   │   ├── settings.py             # DB_PATH, SEED_CSV constants
│   │   ├── terms.py                # rental_terms(lang) — 13 rules × 3 languages
│   │   ├── i18n.py                 # TRANSLATIONS registry + t(key, lang)
│   │   └── lang_sq.py              # Albanian
│   │
│   ├── core/
│   │   ├── db.py                   # SQLAlchemy engine init (SQLite / Turso / Postgres), schema migrations, seed
│   │   └── schema.sql               # 11 CREATE TABLE + 9 CREATE INDEX statements
│   │
│   ├── data/
│   │   ├── repositories/           # Data access layer (all SQL lives here)
│   │   │   ├── vehicles.py
│   │   │   ├── vehicle_photos.py
│   │   │   ├── customers.py
│   │   │   ├── rentals.py
│   │   │   ├── charges.py
│   │   │   ├── vehicle_costs.py
│   │   │   ├── users.py
│   │   │   ├── licenses.py
│   │   │   ├── audit.py
│   │   │   ├── app_settings.py
│   │   │   └── admin_ops.py        # Export/import + finance/client/fleet resets (super_admin)
│   │   └── seed/
│   │       └── import_csv.py       # fleet_master.csv → vehicles table
│   │
│   ├── services/                   # Business logic (no DB I/O, calls repos)
│   │   ├── auth_service.py         # Password hashing, login, password recovery
│   │   ├── finance_service.py      # P&L roll-ups, income/cost joins
│   │   ├── scheduling_service.py   # Availability check + return window math
│   │   ├── licensing_service.py    # Licensed year tracking, date caps
│   │   ├── email_service.py        # SMTP client, password recovery email delivery
│   │   └── audit_service.py        # Mutation logging (best-effort, never raises)
│   │
│   └── ui/                         # Document & notification serializers
│       ├── invoice.py              # build_invoice_html() + payload assembly
│       ├── invoice_links.py        # QR payloads + per-QR guided action buttons (vCard / SEPA / summary)
│       ├── license_invoice.py      # build_license_invoice_html()
│       ├── pdf.py                  # Invoice/license/report → PDF (fpdf2)
│       ├── notifications.py        # Overdue/due_soon classification + messages
│       ├── photos.py               # Photo encode (ImageOps.fit, JPEG q80)
│       ├── components.py           # format_eur(), fmt_date(), fmt_invoice_no()
│       ├── theme.py                # resolve_theme(), CSS var tokens, night mode
│       └── nav.py                  # Navigation items, permission-gated
│
└── frontend/                       # Next.js 14 application
    ├── package.json
    ├── tsconfig.json
    ├── next.config.mjs
    ├── tailwind.config.ts
    ├── .env.local.example
    │
    ├── app/
    │   ├── layout.tsx              # Root: ThemeProvider + font + CSS vars
    │   ├── providers.tsx           # Theme + Auth + i18n + Toast context wrappers
    │   ├── login/page.tsx          # Public login form
    │   └── (app)/                  # Auth-required route group
    │       ├── layout.tsx          # Sidebar + account popover + auth guard
    │       ├── page.tsx            # Dashboard (staff) | VisitorHome (visitor); date-range carousel
    │       ├── browse/page.tsx     # Visitor: available cars grid
    │       ├── reservations/page.tsx  # Card/table toggle
    │       ├── fleet/page.tsx         # Card/table toggle
    │       ├── customers/page.tsx     # Card/table toggle
    │       ├── finance/page.tsx       # Bento-board overview + 6 tabs
    │       ├── settings/page.tsx
    │       └── invoices/[dealId]/page.tsx
    │
    ├── lib/
    │   ├── api.ts                  # Fetch wrapper, Bearer JWT, error normalisation
    │   ├── auth.tsx                # useAuth() context (login/logout/session restore)
    │   ├── i18n.tsx                # useT() context, loads /api/i18n/{lang}.json
    │   ├── toast.tsx                # useToast() — portal-rendered success/error/info notifications
    │   ├── money.ts                # formatEur() cents → display string
    │   ├── dates.ts                # fmtDate() ISO → locale month, fmtInvoiceNo()
    │   ├── theme.ts                # CSS var binding, night mode, contrast lift
    │   ├── perms.ts                # can(user, perm) client-side gate mirror
    │   ├── types.ts                # TypeScript interfaces (User, Vehicle, etc.)
    │   └── icons.ts                # Material Symbols Rounded icon name constants
    │
    ├── components/
    │   ├── Sidebar.tsx
    │   ├── Bell.tsx
    │   ├── Kpi.tsx
    │   ├── StatusBadge.tsx
    │   ├── Timeline.tsx
    │   ├── BookingDialog.tsx
    │   ├── ReservationCard.tsx
    │   ├── VisitorHome.tsx
    │   ├── Modal.tsx
    │   ├── ViewToggle.tsx          # Shared card/table view switch
    │   └── NightModeToggle.tsx
    │
    └── styles/globals.css          # :root CSS vars, media queries, print CSS
```

---

## 3. Frontend

### 3.1 Stack & Dependencies

| Package | Version | Purpose |
|---|---|---|
| Next.js | 14.2 | App Router, SSR + SSG, image optimisation |
| React | 18.3 | UI rendering |
| TypeScript | 5.6 | Static typing |
| Tailwind CSS | 3.4 | Utility-first styling |
| Recharts | 3.9 | Finance charts (bar, pie, area) |
| Material Symbols Rounded | — | Icon font (self-hosted via Google Fonts) |

**Run commands:**

```bash
cd frontend
npm install
npm run dev        # http://localhost:3000
npm run build
npm run start      # production server
```

### 3.2 Pages & Routes

| Route | File | Access | Description |
|---|---|---|---|
| `/login` | `app/login/page.tsx` | Public | Username + password form, remember-me toggle |
| `/` | `app/(app)/page.tsx` | Auth | Dashboard (staff KPIs + timeline) or VisitorHome. Once a date window is picked, available cars render as a swipeable, wrap-around carousel with pagination. |
| `/browse` | `app/(app)/browse/page.tsx` | Auth | Visitor: available cars grid with daily rate |
| `/reservations` | `app/(app)/reservations/page.tsx` | employer+ | Active rentals: card list or table view (toggle) + booking panel + timeline |
| `/fleet` | `app/(app)/fleet/page.tsx` | employer+ | Fleet: card grid or table view (toggle); Add/Edit/Archive/Restore dialogs |
| `/customers` | `app/(app)/customers/page.tsx` | employer+ | Customers: card grid or table view (toggle) + rental history modal |
| `/finance` | `app/(app)/finance/page.tsx` | admin+ | Bento-board overview + 6-tab finance dashboard |
| `/settings` | `app/(app)/settings/page.tsx` | admin+ | 7-tab settings panel |
| `/invoices/[dealId]` | `app/(app)/invoices/[dealId]/page.tsx` | employer+ | Invoice iframe viewer + language selector |

**Finance tabs:** Overview · Monthly · Yearly · By Vehicle · By Customer · Costs

**Settings tabs:** Business · Users · License · Data · Language · Profile · Activity

### 3.3 Reusable Components

| Component | File | Description |
|---|---|---|
| `Sidebar` | `components/Sidebar.tsx` | 2-state: expanded (236px) / collapsed (62px icon rail). Navigation links are permission-gated. |
| `Bell` | `components/Bell.tsx` | Notification badge + modal listing overdue rentals, due-soon rentals, and license expiry. |
| `Kpi` | `components/Kpi.tsx` | Stat card: label + Material icon + formatted value. |
| `StatusBadge` | `components/StatusBadge.tsx` | Coloured pill for vehicle/rental statuses. |
| `Timeline` | `components/Timeline.tsx` | Rental occupancy calendar visualiser. Active rentals paint the admin-configured "Active Rental Bar Gradient". |
| `BookingDialog` | `components/BookingDialog.tsx` | Full booking form: customer (ALL-CAPS enforced), vehicle, dates, rate (with +/-5 stepper), deposit, invoice language. |
| `ReservationCard` | `components/ReservationCard.tsx` | Active rental card in neumorphic style; in-place date/rate editing, return processing. |
| `VisitorHome` | `components/VisitorHome.tsx` | Hero section + available cars grid. No management controls. |
| `Modal` | `components/Modal.tsx` | Stacked modal dialog framework (multiple layers). |
| `ViewToggle` | `components/ViewToggle.tsx` | Shared card ⇄ table segmented switch, used by Fleet, Reservations and Customers pages. Choice persisted per page in `localStorage`. |
| `NightModeToggle` | `components/NightModeToggle.tsx` | Dark/light toggle — persisted in `localStorage`. |

### 3.4 State Management & Contexts

Contexts are composed in `app/providers.tsx`:

**`AuthContext`** (`lib/auth.tsx`)
- Stores the logged-in `User` object and JWT token.
- `login(username, password, rememberMe)` — POSTs to `/api/auth/login`, saves token.
- `logout()` — Calls `/api/auth/logout`, clears local state.
- Session is restored from `localStorage` on mount.

**`I18nContext`** (`lib/i18n.tsx`)
- Lazy-loads `/api/i18n/{lang}.json` for the active language.
- `useT()` returns `t(key)` translation helper.
- Falls back to English for missing keys.

**`ThemeContext`** (`lib/theme.ts`)
- Binds CSS variable tokens from `/api/theme` onto `:root`, including `--bar-grad-start` / `--bar-grad-end`.
- Night mode toggle reads/writes `localStorage["night"]`.
- Contrast lift applies automatically in night mode.

**`ToastContext`** (`lib/toast.tsx`)
- `useToast()` returns `success(msg)` / `error(msg)` / `info(msg)` / `push(msg, kind)`.
- Toasts stack bottom-right, auto-dismiss after a few seconds, dismissible on click.
- Rendered through a portal above the modal overlay (z-index) so confirmations stay visible while a dialog is open.
- Callers pass already-translated strings — the toast layer is presentation-only.

**API client** (`lib/api.ts`)
- Thin fetch wrapper: prepends `NEXT_PUBLIC_API_BASE`, attaches `Authorization: Bearer <token>` header.
- Normalises HTTP errors into typed `ApiError` objects.
- Handles 401 → auto-logout.

### 3.5 Theming & Night Mode

- All colours are CSS custom properties defined in `styles/globals.css` and overridden per theme via `/api/theme`.
- Night mode is client-side only (no server round-trip). It applies a second CSS variable layer.
- Theme tokens (primary, surface, text, accent, active-rental-bar gradient start/end, etc.) are editable by `super_admin` via the Settings → Business tab.
- The "Active Rental Bar Gradient" pair (`bar_gradient_start` / `bar_gradient_end`) paints every active (non-alert, non-closed) rental bar on the Timeline.

### 3.6 Internationalisation (i18n)

| Language | Code | Notes |
|---|---|---|
| Turkish | `tr` | Default; fallback when lang is unknown |
| English | `en` | |
| Albanian | `sq` | Staff-visible only |

- Translation bundles are served from the FastAPI backend at `/api/i18n/{lang}.json`.
- Rental terms (13 rules) are served from `/api/i18n/terms/{lang}` and printed on invoices.
- The user's preferred language is stored in their `users.lang` database column.

### 3.7 Environment Variables

| Variable | Example | Description |
|---|---|---|
| `NEXT_PUBLIC_API_BASE` | `http://127.0.0.1:8001` | Backend base URL. Must NOT have a trailing slash. |

---

## 4. Backend

### 4.1 Stack & Dependencies

| Package | Version | Purpose |
|---|---|---|
| FastAPI | 0.115 | Async REST framework |
| SQLAlchemy | 2.0 | ORM, dialect-agnostic SQL |
| Pydantic | 2.7 | Request/response validation, settings |
| PyJWT | 2.10 | Stateless JWT tokens |
| bcrypt | 5.0 | Password hashing (bcrypt rounds=12) |
| Pillow | 11.0 | Photo cropping and encoding |
| fpdf2 | 2.8 | PDF generation for invoices and reports |
| segno | 1.6 | QR code generation (vCard, SEPA, summary) |
| pandas | 3.0 | CSV seed parsing |
| sqlalchemy-libsql | 0.2 | Turso/libSQL dialect for production |
| uvicorn | — | ASGI server |

**Run commands:**

```bash
cd backend
pip install -r requirements.txt
uvicorn api.main:app --reload --port 8001
```

### 4.2 Project Structure

The backend follows a strict layered architecture:

```
Router → Service → Repository → Database
```

- **Routers** handle HTTP: parse request, enforce permissions, call services, return responses.
- **Services** contain business logic: no DB I/O, call repositories.
- **Repositories** are the only layer that executes SQL.
- **Core** initialises the DB engine and runs migrations.

### 4.3 Application Entry Point

`api/main.py` is the FastAPI application factory:

1. `lifespan()` context: bridges `DATABASE_URL` / `TURSO_DATABASE_URL` env vars, calls `init_db()` once at startup.
2. `init_db()` is idempotent: creates schema, runs migrations, seeds fleet if empty, ensures a default admin exists, purges expired sessions.
3. CORS middleware is configured from `settings.cors_origin_list`.
4. 17 routers are mounted via `app.include_router()`.

### 4.4 Configuration & Settings

`api/settings.py` — Pydantic `BaseSettings` reading from environment / `.env`:

| Setting | Env Var | Default | Description |
|---|---|---|---|
| `database_url` | `DATABASE_URL` | `""` (SQLite) | Connection string |
| `jwt_secret` | `JWT_SECRET` | — | Required; signs all tokens |
| `jwt_ttl_days` | `JWT_TTL_DAYS` | `14` | Remember-me session duration |
| `jwt_ttl_days_short` | `JWT_TTL_DAYS_SHORT` | `1` | Normal session duration |
| `cookie_name` | `COOKIE_NAME` | `bcr_session` | Auth cookie name |
| `cookie_secure` | `COOKIE_SECURE` | `false` | Set `true` in production (HTTPS) |
| `cookie_samesite` | `COOKIE_SAMESITE` | `lax` | Use `none` for cross-site |
| `cookie_domain` | `COOKIE_DOMAIN` | `""` | Set to `.yourdomain.com` for cross-subdomain |
| `cors_origins` | `CORS_ORIGINS` | `http://localhost:3000` | Comma-separated allowed origins |

Production databases: `TURSO_DATABASE_URL` (+ `TURSO_AUTH_TOKEN`) for Turso/libSQL, or a `postgres://…` `DATABASE_URL` for Neon.

### 4.5 Authentication & Security

**Flow:**

1. `POST /api/auth/login` — validates username/password via `bcrypt.checkpw`, issues a signed JWT, sets HttpOnly cookie, returns `{user, token}`.
2. `GET /api/me` and all protected routes — `deps.get_current_user()` reads the Bearer token or cookie, verifies the JWT signature and expiry, loads the user row.
3. `POST /api/auth/logout` — clears the auth cookie.
4. `POST /api/auth/forgot-password` — generates a temporary password, sends it via SMTP (or returns it on-screen if SMTP not configured). Admin+ only.

**JWT fields:** `sub` (username), `role`, `exp`.

**Password hashing:** bcrypt rounds=12 via `auth_service.hash_password()` and `auth_service.verify_password()`.

**Cookies:** HttpOnly, Secure (in production), SameSite configurable. Cross-origin setups use `SameSite=none` with `Secure=true`.

### 4.6 RBAC & Permissions

Four roles in ascending privilege:

| Role | Level | Description |
|---|---|---|
| `visitor` | 0 | Read-only: browse available cars |
| `employer` | 1 | Fleet ops: bookings, invoices, customers |
| `admin` | 2 | Finance, user management, data exports/backups |
| `super_admin` | 3 | All ops: theme, SMTP, resets, hard deletes |

**25 permissions** are defined in `config/roles.py` (including `backup_database`, admin+). Each permission maps to a minimum role level. `can(user, perm)` checks `user.role_level >= required_level`.

**Key guards:**
- Last-super-admin guard: cannot demote, deactivate, or delete the final active `super_admin`.
- All permission checks happen server-side; the frontend mirrors them for UI gating only.
- `deps.require(perm)` is used as a FastAPI dependency on every privileged endpoint.

### 4.7 API Endpoints (Full Reference)

#### Auth — `/api/auth/*`

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| POST | `/api/auth/login` | None | — | Login; returns user + JWT; sets cookie |
| POST | `/api/auth/logout` | Any | — | Clears auth cookie |
| GET | `/api/me` | JWT | any | Current user profile |
| POST | `/api/auth/forgot-password` | JWT | admin+ | Reset user password; deliver via email or on-screen |

#### Vehicles — `/api/vehicles/*`

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| GET | `/api/vehicles` | JWT | employer+ | List fleet (no photos); supports search query |
| GET | `/api/vehicles/archived` | JWT | employer+ | Soft-deleted vehicles |
| GET | `/api/vehicles/active` | JWT | employer+ | Brief picker list (id, make_model, plate) |
| GET | `/api/vehicles/counts` | JWT | employer+ | `{total, available, rented, garage}` |
| GET | `/api/vehicles/{id}` | JWT | employer+ | Full vehicle record |
| POST | `/api/vehicles` | JWT | admin+ | Create vehicle + optional photos |
| PUT | `/api/vehicles/{id}` | JWT | admin+ | Update vehicle fields (not photos) |
| POST | `/api/vehicles/{id}/status` | JWT | employer+ | Change status: Garage / Maintenance / Available |
| POST | `/api/vehicles/{id}/archive` | JWT | admin+ | Soft delete (status → DELETED) |
| DELETE | `/api/vehicles/{id}` | JWT | super_admin | Hard delete |
| POST | `/api/vehicles/{id}/restore` | JWT | admin+ | Unarchive (DELETED → Available) |
| GET | `/api/vehicles/{id}/thumb` | JWT | employer+ | Thumbnail (ETag on photo version) |
| POST | `/api/vehicles/{id}/photos` | JWT | admin+ | Add photos to vehicle |

#### Photos — `/api/vehicles/photos/*`

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| GET | `/api/vehicles/{id}/photos` | JWT | employer+ | List all photos for a vehicle |
| DELETE | `/api/vehicles/photos/{photo_id}` | JWT | admin+ | Delete one photo |
| GET | `/api/vehicles/{id}/photos/version` | JWT | employer+ | Cache key: `MAX(photo_id)` |

#### Rentals — `/api/rentals/*`

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| GET | `/api/rentals/active` | JWT | employer+ | Active rentals with vehicle details |
| GET | `/api/rentals/all` | JWT | admin+ | All rentals (active + closed) |
| GET | `/api/rentals/{deal_id}` | JWT | employer+ | Full rental record |
| POST | `/api/rentals/available-cars` | JWT | employer+ | Free vehicles for a date/time window |
| POST | `/api/rentals` | JWT | employer+ | Create booking (re-checks availability) |
| PUT | `/api/rentals/{deal_id}/dates` | JWT | employer+ | Edit start/return date (clash-checked) |
| PUT | `/api/rentals/{deal_id}/rate` | JWT | employer+ | Edit the negotiated daily rate |
| PUT | `/api/rentals/{deal_id}/vehicle` | JWT | employer+ | Swap the car on an active rental |
| POST | `/api/rentals/{deal_id}/close` | JWT | employer+ | Close rental + post charges |
| POST | `/api/rentals/{deal_id}/cancel` | JWT | admin+ | Cancel rental |
| PUT | `/api/rentals/{deal_id}/reassign` | JWT | admin+ | Reassign the "registered by" staff member |

#### Customers — `/api/customers/*`

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| GET | `/api/customers` | JWT | employer+ | List customers (searchable) + rental count |
| GET | `/api/customers/{id}` | JWT | employer+ | Full record + rental history |
| PUT | `/api/customers/{id}` | JWT | employer+ | Update personal info |
| DELETE | `/api/customers/{id}` | JWT | admin+ | Delete customer (cascades to rentals) |
| GET | `/api/customers/{id}/rentals` | JWT | employer+ | Rental history for one customer |

#### Customer Reports — `/api/reports/*`

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| GET | `/api/reports/customers-timeline.pdf` | JWT | employer+ | Per-customer rental timeline (active + closed), one row per customer |
| GET | `/api/reports/customers.csv` | JWT | employer+ | Flat CSV: one row per rental, with customer + car metadata |

#### Finance — `/api/finance/*`

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| GET | `/api/finance/summary` | JWT | admin+ | `{income, cost, net, margin}` |
| GET | `/api/finance/has-data` | JWT | admin+ | `{has_income, has_costs}` |
| GET | `/api/finance/revenue-summary` | JWT | admin+ | By charge type: rental/penalty/damage/total |
| GET | `/api/finance/cost-by-type` | JWT | admin+ | Expense breakdown by type DESC |
| GET | `/api/finance/pnl/monthly` | JWT | admin+ | P&L by month |
| GET | `/api/finance/pnl/yearly` | JWT | admin+ | P&L by year |
| GET | `/api/finance/month-breakdown/{month}` | JWT | admin+ | Deep dive into one month |
| GET | `/api/finance/profit-by-vehicle` | JWT | admin+ | Income − cost per car |
| GET | `/api/finance/revenue-by-customer` | JWT | admin+ | Revenue per client |
| GET | `/api/finance/costs` | JWT | admin+ | Recent expense entries |
| GET | `/api/finance/cost-total` | JWT | admin+ | Sum of all costs |
| POST | `/api/finance/costs` | JWT | admin+ | Add expense (date capped at licensed year) |
| DELETE | `/api/finance/costs/{cost_id}` | JWT | admin+ | Remove expense entry |

#### Finance Reports — `/api/finance/report/*`

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| GET | `/api/finance/report/{slug}.csv` | JWT | admin+ | Export report as CSV |
| GET | `/api/finance/report/{slug}.pdf` | JWT | admin+ | Export report as PDF |

Slug values: `summary`, `monthly`, `yearly`, `by_vehicle`, `by_customer`, `recent_costs`.

#### Invoices — `/api/rentals/{deal_id}/invoice*`

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| GET | `/api/rentals/{deal_id}/invoice-meta` | JWT | employer+ | Available languages + stored default |
| GET | `/api/rentals/{deal_id}/invoice.html` | JWT | employer+ | Full HTML invoice (2 A4 copies). QR cards render call/WhatsApp/map/IBAN/email actions as tappable buttons. |
| GET | `/api/rentals/{deal_id}/invoice.pdf` | JWT | employer+ | PDF download |
| POST | `/api/rentals/invoices-batch.html` | JWT | employer+ | One printable doc, one office copy per selected rental |
| GET | `/api/licenses/{id}/invoice.html` | JWT | admin+ | License invoice HTML |
| GET | `/api/licenses/{id}/invoice.pdf` | JWT | admin+ | License invoice PDF |

#### License — `/api/license*` and `/api/licenses*`

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| GET | `/api/license/status` | JWT | admin+ | Current licensed year + extension options |
| PUT | `/api/license/year` | JWT | super_admin | Set licensed year |
| GET | `/api/licenses` | JWT | admin+ | All license records |
| GET | `/api/licenses/{id}` | JWT | admin+ | One record |
| POST | `/api/licenses` | JWT | super_admin | Add license + auto-extend year |
| PUT | `/api/licenses/{id}` | JWT | super_admin | Edit (extend-only cap enforced) |
| DELETE | `/api/licenses/{id}` | JWT | super_admin | Remove license record |

#### Settings → Account — `/api/profile*` and `/api/users*`

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| GET | `/api/profile` | JWT | any | Own profile |
| PUT | `/api/profile/full-name` | JWT | any | Update own full name |
| PUT | `/api/profile/email` | JWT | any | Update own email |
| PUT | `/api/profile/password` | JWT | any | Change own password |
| GET | `/api/profile/languages` | JWT | any | Supported language list |
| PUT | `/api/profile/language` | JWT | any | Switch UI language |
| GET | `/api/users` | JWT | admin+ | Staff list (masked by role level) |
| GET | `/api/users/assignable-roles` | JWT | admin+ | Roles this actor can grant |
| POST | `/api/users` | JWT | admin+ | Create user |
| PUT | `/api/users/{username}/role` | JWT | admin+ | Change role (last-super guard) |
| PUT | `/api/users/{username}/active` | JWT | admin+ | Activate / deactivate |
| DELETE | `/api/users/{username}` | JWT | admin+ | Delete user (last-super guard) |
| PUT | `/api/users/{username}/email` | JWT | admin+ | Update user email |
| POST | `/api/users/{username}/reset-password` | JWT | admin+ | Admin password reset |

#### Admin Panel — `/api/admin/*`

Backs the Admin Panel (staff-by-role list + the role × permission checkbox
matrix), which is rendered by `frontend/components/AdminPanel.tsx` inside
**Settings → Roles**. There is no `/admin` route and no sidebar entry: the panel
is configuration, so it sits with the other admin screens.

Scope is decided server-side: a **super_admin** gets every role column and every
unlocked permission; an **admin** gets only the `client_registration` group for
the roles below them.

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| GET | `/api/admin/permissions` | JWT | admin+ | Matrix, defaults, stored overrides, scope |
| PUT | `/api/admin/permissions` | JWT | admin+ | Apply `{role: {perm: bool}}` (rejects out-of-scope cells wholesale) |
| POST | `/api/admin/permissions/reset` | JWT | admin+ | Clear the overrides the actor may touch |

Guardrails (in `services/permissions_service.py`, not the router):

- `super_admin` always holds every permission — the matrix can never lock the owner out.
- The `administration` group (`manage_users`, `assign_admin_roles`,
  `edit_business_settings`, `backup_database`, `hard_delete_vehicle`) is **never**
  overridable, for any role — that's the anti-escalation rule.
- An admin may only grant permissions they hold themselves, to roles below them.
- Only *deviations* from the shipped baseline are stored, so an untouched install
  writes nothing and behaves exactly as before this layer existed.

#### Settings → Business — `/api/settings/*`

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| GET | `/api/settings/business` | JWT | admin+ | Full business info |
| PUT | `/api/settings/business/name` | JWT | admin+ | Set business name |
| PUT | `/api/settings/business/contact` | JWT | admin+ | Phone, email, address, maps_url, IBAN, pay QR |
| PUT | `/api/settings/business/pay-qr` | JWT | admin+ | IBAN + pay_qr_enabled toggle |
| POST | `/api/settings/logo` | JWT | super_admin | Upload logo (280×100 PNG) |
| DELETE | `/api/settings/logo` | JWT | super_admin | Remove logo |
| GET | `/api/settings/logo.png` | JWT | any | Fetch logo |
| POST | `/api/settings/stamp` | JWT | super_admin | Upload stamp (260×180 PNG) |
| DELETE | `/api/settings/stamp` | JWT | super_admin | Remove stamp |
| GET | `/api/settings/stamp.png` | JWT | any | Fetch stamp |
| GET | `/api/settings/theme` | JWT | super_admin | Theme editor tokens (includes bar-gradient pair) |
| PUT | `/api/settings/theme` | JWT | super_admin | Save custom theme |
| POST | `/api/settings/theme/reset` | JWT | super_admin | Restore default theme |
| GET | `/api/theme` | JWT | any | Resolved CSS variable tokens (public read) |

#### Data — Backup / Restore — `/api/data/*`

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| GET | `/api/data/backup` | JWT | admin+ | Full JSON snapshot of every business table |
| GET | `/api/data/backup.csv` | JWT | admin+ | One CSV per table, bundled as a `.zip` |
| GET | `/api/data/backup-single.csv` | JWT | admin+ | Every table concatenated into ONE CSV file, `# TABLE:` markers |
| GET | `/api/data/backup.sqlite` | JWT | admin+ | Portable single-file SQLite database built from the snapshot |
| POST | `/api/data/import` | JWT | admin+ | Restore from a JSON backup (replaces all current data) |
| GET | `/api/data/finance-records` | JWT | super_admin | Income + expense rows (last 200) |
| GET | `/api/data/clients` | JWT | super_admin | All customers |
| DELETE | `/api/data/charges/{charge_id}` | JWT | super_admin | Remove one income entry |
| DELETE | `/api/data/costs/{cost_id}` | JWT | super_admin | Remove one expense entry |
| POST | `/api/data/reset/finance` | JWT | super_admin | Wipe all charges + costs (requires literal `'RESET'`) |
| POST | `/api/data/reset/clients` | JWT | super_admin | Wipe customers + cascade rentals |
| POST | `/api/data/reset/fleet` | JWT | super_admin | Empty fleet + re-seed from CSV |

The CSV exports (`backup.csv`, `backup-single.csv`) drop secret/binary columns (`password_hash`, `photo`) — they're for reading (Excel/Sheets), not restoring. Only the JSON backup round-trips through `/api/data/import`.

#### i18n & Meta

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| GET | `/api/i18n/languages` | JWT | any | Supported language code → label map |
| GET | `/api/i18n/{lang}.json` | JWT | any | Translation bundle |
| GET | `/api/i18n/terms/{lang}` | JWT | any | 13-rule rental terms |
| GET | `/api/nav` | JWT | any | Navigation items (permission-gated) |
| GET | `/api/dashboard` | JWT | employer+ | KPIs + fleet counts + notifications |

#### Notifications & Activity

| Method | Path | Auth | Permission | Description |
|---|---|---|---|---|
| GET | `/api/notifications` | JWT | employer+ | Badge count + overdue/due-soon + license expiry |
| GET | `/api/activity` | JWT | admin+ | Audit log (filtered + role-masked) |
| GET | `/api/activity/returnable` | JWT | admin+ | Restorable items |
| POST | `/api/activity/return/vehicle/{vehicle_id}` | JWT | admin+ | Restore deleted vehicle |
| POST | `/api/activity/return/rental/{deal_id}` | JWT | admin+ | Reactivate closed rental |

#### Health & Internal

| Method | Path | Auth | Description |
|---|---|---|---|
| GET | `/api/health` | None | `{ok: true, service: "balkan-fleet-api"}` |
| GET | `/internal/db-health` | None | DB connectivity + dialect report |

### 4.8 Services Layer

| Service | File | Responsibility |
|---|---|---|
| `auth_service` | `services/auth_service.py` | Password hash/verify, login validation, temp password generation |
| `finance_service` | `services/finance_service.py` | P&L roll-ups, income/cost aggregation, margin calculation |
| `scheduling_service` | `services/scheduling_service.py` | `is_vehicle_free()` availability check, `return_state()` window math |
| `licensing_service` | `services/licensing_service.py` | Licensed year tracking, date caps for cost entries |
| `email_service` | `services/email_service.py` | SMTP client, password recovery email delivery |
| `audit_service` | `services/audit_service.py` | Best-effort mutation logging; never raises, never blocks the main flow |

### 4.9 Repository Layer

All SQL lives in `data/repositories/`. Routers never execute raw SQL.

| Repository | File | Tables touched |
|---|---|---|
| `vehicles` | `repositories/vehicles.py` | `vehicles` |
| `vehicle_photos` | `repositories/vehicle_photos.py` | `vehicle_photos` |
| `customers` | `repositories/customers.py` | `customers` |
| `rentals` | `repositories/rentals.py` | `rentals` + `vehicles` (dates/rate/vehicle edits, availability, close/cancel) |
| `charges` | `repositories/charges.py` | `charges` |
| `vehicle_costs` | `repositories/vehicle_costs.py` | `vehicle_costs` |
| `users` | `repositories/users.py` | `users` |
| `licenses` | `repositories/licenses.py` | `licenses` |
| `audit` | `repositories/audit.py` | `audit_log` |
| `app_settings` | `repositories/app_settings.py` | `app_settings` (incl. theme, bar-gradient, pay-QR/IBAN keys) |
| `admin_ops` | `repositories/admin_ops.py` | Multiple — `export_all()` / `import_all()` (backup/restore) + destructive resets |

---

## 5. Database

### 5.1 Engine Support

The same SQLAlchemy codebase targets three database backends:

| Backend | `DATABASE_URL` format | Use case |
|---|---|---|
| SQLite (local file) | `""` (empty) → defaults to `fleet.db` | Local development |
| Turso / libSQL | `TURSO_DATABASE_URL` (+ `TURSO_AUTH_TOKEN`), or `libsql://…` | Production (edge, free tier) |
| Neon / Postgres | `postgresql://user:pass@host/db` | Production (Postgres) |

The active dialect is auto-detected by `core/db.py` and exposed at `/internal/db-health`.

### 5.2 Schema — All Tables

#### `vehicles`

| Column | Type | Notes |
|---|---|---|
| `vehicle_id` | TEXT PK | Format: `C001`, `C002`, … (MAX+1 on insert) |
| `make_model` | TEXT NOT NULL | e.g. `"BMW 3 Series"` |
| `year` | INTEGER | |
| `license_plate` | TEXT | |
| `color` | TEXT | |
| `mileage` | INTEGER | Default 0 |
| `status` | TEXT | CHECK: `Available` · `Rented` · `In Garage` · `Maintenance` · `DELETED` |
| `base_daily_rate` | INTEGER | **Cents.** Default 0 |
| `maintenance_charge` | INTEGER | **Cents.** Extra charge applied on close |
| `acquisition_cost` | INTEGER | **Cents.** Purchase price |
| `acquisition_date` | TEXT | ISO date |
| `notes` | TEXT | |
| `photo` | TEXT | Base64 JPEG (legacy single photo) |
| `created_at` | TEXT | ISO datetime |
| `updated_at` | TEXT | ISO datetime |

#### `customers`

| Column | Type | Notes |
|---|---|---|
| `customer_id` | INTEGER PK AUTOINCREMENT | |
| `full_name` | TEXT NOT NULL | Stored ALL-CAPS |
| `phone` | TEXT | |
| `id_passport` | TEXT | ID or passport number |
| `created_at` | TEXT | ISO datetime |

#### `rentals`

| Column | Type | Notes |
|---|---|---|
| `deal_id` | TEXT PK | Format: `RENT-YYYYMM-NNN` |
| `customer_id` | INTEGER FK → customers | |
| `vehicle_id` | TEXT FK → vehicles | |
| `start_dt` | TEXT | ISO datetime |
| `end_dt` | TEXT | ISO datetime |
| `rental_days` | INTEGER | |
| `daily_rate` | INTEGER | **Cents.** Snapshot at booking time |
| `total_amount` | INTEGER | **Cents.** `rental_days × daily_rate` |
| `deposit` | INTEGER | **Cents.** |
| `status` | TEXT | CHECK: `Active` · `Closed` |
| `contract_signed` | TEXT | `Yes` / `No` |
| `return_notes` | TEXT | |
| `created_by` | TEXT | Staff username (snapshot) |
| `created_by_name` | TEXT | Staff full name (snapshot) |
| `created_by_role` | TEXT | Staff role (snapshot) |
| `invoice_lang` | TEXT | Language code for this rental's invoice |
| `created_at` | TEXT | ISO datetime |

#### `charges` (income ledger)

| Column | Type | Notes |
|---|---|---|
| `charge_id` | INTEGER PK AUTOINCREMENT | |
| `deal_id` | TEXT FK → rentals (nullable) | |
| `vehicle_id` | TEXT FK → vehicles (nullable) | |
| `type` | TEXT | CHECK: `rental` · `overdue_penalty` · `damage` · `deposit` · `refund` |
| `amount` | INTEGER | **Cents.** Can be negative (refund) |
| `occurred_at` | TEXT | ISO datetime |

#### `vehicle_costs` (expense ledger)

| Column | Type | Notes |
|---|---|---|
| `cost_id` | INTEGER PK AUTOINCREMENT | |
| `vehicle_id` | TEXT FK → vehicles (nullable) | |
| `type` | TEXT | CHECK: `insurance` · `maintenance` · `depreciation` · `fuel` · `financing` · `registration` · `other` |
| `amount` | INTEGER | **Cents** |
| `period_date` | TEXT | ISO date (`YYYY-MM-DD`) |
| `note` | TEXT | |

#### `users`

| Column | Type | Notes |
|---|---|---|
| `user_id` | INTEGER PK AUTOINCREMENT | |
| `username` | TEXT UNIQUE NOT NULL | |
| `password_hash` | TEXT NOT NULL | bcrypt rounds=12 |
| `full_name` | TEXT | |
| `role` | TEXT | CHECK: `super_admin` · `admin` · `employer` · `visitor` |
| `is_active` | INTEGER | 1 = active, 0 = deactivated |
| `lang` | TEXT | Preferred UI language code |
| `email` | TEXT | For password recovery |
| `created_at` | TEXT | ISO datetime |

#### `sessions`

| Column | Type | Notes |
|---|---|---|
| `token_hash` | TEXT PK | SHA-256 of the random session token |
| `username` | TEXT NOT NULL | |
| `expires_at` | TEXT NOT NULL | ISO datetime |
| `created_at` | TEXT | ISO datetime |

#### `audit_log`

| Column | Type | Notes |
|---|---|---|
| `id` | INTEGER PK AUTOINCREMENT | |
| `username` | TEXT | Actor username |
| `action` | TEXT | e.g. `CREATE`, `UPDATE`, `DELETE`, `LOGIN` |
| `entity` | TEXT | Table or domain name |
| `entity_id` | TEXT | Primary key of affected record |
| `detail` | TEXT | JSON or human-readable summary |
| `ts` | TEXT | ISO datetime |

#### `app_settings` (key-value store)

| Column | Type | Notes |
|---|---|---|
| `key` | TEXT PK | e.g. `business_name`, `theme_primary`, `smtp_host` |
| `value` | TEXT | |
| `updated_at` | TEXT | ISO datetime |

Known keys: `business_name`, `business_phone`, `business_email`, `business_address`, `maps_url`, `iban`, `pay_qr_enabled`, `logo`, `stamp`, `smtp_host`, `smtp_port`, `smtp_user`, `smtp_pass`, `smtp_from`, `theme_*` (including `theme_bar_gradient_start` / `theme_bar_gradient_end`)

#### `vehicle_photos`

| Column | Type | Notes |
|---|---|---|
| `photo_id` | INTEGER PK AUTOINCREMENT | Used as cache-bust version key |
| `vehicle_id` | TEXT FK → vehicles | |
| `photo` | TEXT NOT NULL | Base64 JPEG (640×480, q80) |
| `position` | INTEGER | Sort order |
| `created_at` | TEXT | ISO datetime |

#### `licenses`

| Column | Type | Notes |
|---|---|---|
| `license_id` | INTEGER PK AUTOINCREMENT | |
| `licensee` | TEXT | Business name at time of purchase |
| `year` | INTEGER | Year this license covers |
| `years` | INTEGER | Number of years purchased |
| `amount` | INTEGER | **Cents** |
| `purchase_date` | TEXT | ISO date |
| `notes` | TEXT | |
| `created_at` | TEXT | ISO datetime |

### 5.3 Indexes

| Index Name | Table | Columns | Purpose |
|---|---|---|---|
| `idx_rentals_vehicle` | `rentals` | `vehicle_id` | Vehicle rental history lookups |
| `idx_rentals_status` | `rentals` | `status` | Filter active vs closed |
| `idx_rentals_customer` | `rentals` | `customer_id` | Customer rental history |
| `idx_rentals_interval` | `rentals` | `vehicle_id, start_dt, end_dt` | Availability overlap queries |
| `idx_charges_deal` | `charges` | `deal_id` | Invoice charge lookups |
| `idx_charges_vehicle` | `charges` | `vehicle_id` | P&L by vehicle |
| `idx_costs_vehicle` | `vehicle_costs` | `vehicle_id, period_date` | Cost by vehicle + period |
| `idx_vphotos_vehicle` | `vehicle_photos` | `vehicle_id, position, photo_id` | Photo listing + version |
| `idx_sessions_expires` | `sessions` | `expires_at` | Expired session purge |

### 5.4 Data Conventions

| Convention | Rule |
|---|---|
| **Money** | Stored as INTEGER cents. `3050` = €30.50. Input: `int(round(float * 100))`. Display: `formatEur()` strips `.00` when whole euros. |
| **Dates** | ISO-8601 text `YYYY-MM-DDTHH:MM:SS` for datetimes; `YYYY-MM-DD` for cost/license periods. |
| **Vehicle IDs** | `C{MAX+1:03d}` — generated via `SELECT MAX` then formatted. Never reused. |
| **Rental IDs** | `RENT-YYYYMM-NNN` — month prefix + sequential counter. |
| **Customer names** | ALL-CAPS enforced on booking. |
| **Booleans** | SQLite INTEGER: `1` = true, `0` = false. |
| **Balance due** | `sum(rental_charges) − deposit`. Deposit row shown only if `deposit > 0`. Deposit/refund types excluded from P&L revenue. |

### 5.5 Seed & Reset

- **Seed gate:** `_is_fleet_empty()` — only seeds if `COUNT(vehicles) == 0`.
- **Seed source:** `backend/fleet_master.csv`.
- **Reset gate:** The literal string `'RESET'` (case-insensitive, `.upper()`) must be passed in the request body. Enforced server-side.
- **Cascade delete customers:** frees any `Rented` vehicles back to `Available`.

---

## 6. Deployment

### Running on the local network

For an office where a handful of staff share one machine's app, `start.bat` boots
`launcher/launcher.py` — a stdlib HTTP server on `127.0.0.1:8800` that serves the
repo-root `index.html` and supervises both servers. It binds loopback only: it can start
and stop processes, so it is never exposed to the network whatever mode the app runs in.

| Mode | API | Web | Extra env |
|---|---|---|---|
| This PC only | `--host 127.0.0.1` | `next dev -H 127.0.0.1` | — |
| Local WiFi network | `--host 0.0.0.0` | `next start -H 0.0.0.0` | `CORS_ALLOW_LAN=1`, `APP_BASE_URL=http://<ip>:3000` |

LAN mode runs a **production build** because `next dev` is too slow and memory-hungry
for several concurrent users. The build is done once and reused — see below for why it
is not tied to an IP.

**Four gates have to open together, or the app looks fine and then fails on login:**

1. **Bind address** — uvicorn defaults to loopback; LAN mode passes `--host 0.0.0.0`.
2. **Frontend API base** — `NEXT_PUBLIC_API_BASE` is inlined by Next at *build* time, so
   a baked-in `127.0.0.1` would make a visiting laptop call its own loopback.
   `lib/api.ts` therefore resolves at runtime: when the page is served from a
   **non-loopback** host it reuses `window.location.hostname` with the API port. One
   running server answers `localhost` and every LAN address at once, and a new DHCP
   lease needs no rebuild. An explicitly configured *remote* base (the Vercel/Render
   setup above) is still honoured verbatim, so production is unaffected.
3. **CORS** — the allow-list is exact-match and `allow_credentials=True` rules out `*`.
   `CORS_ALLOW_LAN=1` adds `settings.cors_origin_regex`, matching loopback on any port
   plus the three RFC-1918 ranges. **Default off**, so cloud deployments keep the strict
   list.
4. **Windows Firewall** — `launcher/allow-firewall.bat` adds inbound TCP 3000/8001 rules
   scoped to `profile=private`. It needs Administrator; the launcher's button raises the
   UAC prompt rather than applying anything silently.

Cookie flags need no change: `cookie_secure=False` / `samesite=lax` are already fine over
plain http on a LAN, and auth rides on the Bearer header anyway. Do **not** copy
`render.yaml`'s `COOKIE_SECURE=true` / `COOKIE_SAMESITE=none` into a LAN `.env` — the
cookie would be dropped silently.

One behaviour change worth knowing: `_is_local_dev()` in `api/routers/auth.py` returns
`False` for LAN clients, so the password-reset `debug_link` is suppressed for them.

**Concurrency and the database.** SQLite is the right choice at this scale — one writer,
many concurrent readers, and an office's booking rate is nowhere near the limit. Keep
`backend/fleet.db` on the host's **local disk**; SQLite over SMB or a OneDrive-synced
folder can corrupt under concurrent writes. The host machine must stay awake, and
everyone must be on the same router — there is no internet exposure and no port
forwarding.

### Production Stack

| Layer | Recommended Service |
|---|---|
| Database | Turso (libSQL, free tier) or Neon (Postgres) |
| Backend | Render or Railway (Docker; `backend/Dockerfile`) |
| Frontend | Vercel (auto-detects Next.js; root dir: `frontend/`) |

### Backend Dockerfile

`backend/Dockerfile` produces a self-contained image that runs:

```
uvicorn api.main:app --host 0.0.0.0 --port ${PORT:-8001}
```

All Python deps are installed from `requirements.txt`. The DB path defaults to a local file unless `DATABASE_URL` / `TURSO_DATABASE_URL` is set.

### Environment Checklist

**Backend (Render / Railway → Environment variables):**

```
TURSO_DATABASE_URL=libsql://your-db.turso.io
TURSO_AUTH_TOKEN=<token>
JWT_SECRET=<long random string>
JWT_TTL_DAYS=14
COOKIE_SECURE=true
COOKIE_SAMESITE=none
COOKIE_DOMAIN=.yourdomain.com
CORS_ORIGINS=https://your-frontend.vercel.app
```

**Frontend (Vercel → Environment variables):**

```
NEXT_PUBLIC_API_BASE=https://your-backend.onrender.com
```

### Health Checks

- Backend: `GET /api/health` — `{"ok": true}`
- DB: `GET /internal/db-health` — `{"ok": true, "dialect": "sqlite"|"postgres"|"libsql"}`

---

## 7. Environment Reference

### Backend `.env` (full)

```env
# Database — leave blank for local SQLite dev
DATABASE_URL=

# Or use managed Turso/libSQL:
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=

# JWT — REQUIRED in production; long random string
JWT_SECRET=change-me-in-production

# Session duration (days)
JWT_TTL_DAYS=14
JWT_TTL_DAYS_SHORT=1

# Cookie settings
COOKIE_NAME=bcr_session
COOKIE_SECURE=false          # true in production (HTTPS only)
COOKIE_SAMESITE=lax          # none for cross-site (requires SECURE=true)
COOKIE_DOMAIN=               # .yourdomain.com for cross-subdomain

# CORS — comma-separated allowed origins
CORS_ORIGINS=http://localhost:3000
```

### Frontend `.env.local` (full)

```env
# Backend API base URL — NO trailing slash
NEXT_PUBLIC_API_BASE=http://127.0.0.1:8001
```

---

## 8. Security & Runtime Hardening

> ## STATUS — Phases 0–3 shipped, 4–6 outstanding
>
> **Shipped:** the event-loop fix (C2), upload/body caps (H2), the JWT boot guard
> (C1), the db-health leak (H4), security headers (M1), proxy-aware client IPs (M2),
> the L1–L3 rate limiter, and the L4 concurrency semaphores. All verified by
> measurement — see 8.11.
>
> **NOT yet shipped:** session revocation (H1), the `admin`/`admin` bootstrap (C3),
> the lockout DoS (H3), the cookie migration + CSRF check (M9), and the performance
> work in 8.6. **The app is still not ready for public exposure** — C3 and H1 alone
> are disqualifying. Treat the current build as safe on a trusted LAN.
>
> Each item is tagged `[ ]` (outstanding) or `[x]` (shipped). Keep the tags current.

### 8.1 Threat Model & Deployment Shape

**Target:** a single VPS running Nginx as a reverse proxy in front of one uvicorn
process, serving the Next.js frontend and the FastAPI backend **from the same
origin** (frontend at `/`, backend proxied at `/api`). SQLite on local disk.

Same-origin deployment is a deliberate security choice, not just convenience — it
removes CORS from the picture entirely and makes `HttpOnly` cookies viable, which is
what closes the token-theft hole described in 8.5.

**Who we are defending against, in priority order:**

1. **Untargeted internet background noise** — credential stuffing, vulnerability
   scanners, and bots that will find the host within hours of it having a public DNS
   record. This is the threat that actually materialises, and it is what L0–L2 exist for.
2. **A malicious or compromised staff account** — the app is multi-tenant by role, and
   an `employer`-level account can already reach expensive endpoints. This is what L3,
   L4 and the per-account limits exist for.
3. **An accidental self-DoS** — a runaway browser tab, a retry loop, or twenty staff
   hitting a report at 09:00 on the first of the month. Empirically the most likely
   outage cause, and the reason limits must be per-account as well as per-IP.

**Explicitly out of scope:** a determined targeted attacker with resources, physical
access to the VPS, and supply-chain compromise of the dependency tree.

**One structural fact drives the whole limiter design:** a rental office NATs to a
*single public IP*, and staff on mobile data share a carrier CGNAT address with
thousands of strangers. Per-IP limiting alone is therefore both **too coarse** (one
staff member's runaway tab locks out the whole office) and **too leaky** (an attacker
on mobile data shares a bucket with innocent users). Per-account limiting is not a
refinement here — it is load-bearing.

### 8.2 Audit Findings

Ranked by severity. File references are to the state of the code at the time of the audit.

#### Critical — blocks public deployment

| # | Status | Finding | Location |
|---|---|---|---|
| C1 | `[x]` | `jwt_secret` defaults to `"dev-insecure-change-me-please"` and nothing checks it at boot. If `JWT_SECRET` is unset in production, **anyone can forge a `super_admin` token** and the entire RBAC layer is decorative. | `api/settings.py:24` |
| C2 | `[x]` | Four `async def` endpoints perform blocking CPU work **directly on the event loop** — Pillow encode/resize, `json.loads` of an arbitrary-size body, and a full database import. One staff member uploading eight car photos freezes the whole API for everyone. Note this also stalls any middleware-based rate limiter, since that shares the same loop. | `routers/photos.py:49`, `routers/settings_business.py:166,197,580` |
| C3 | `[x]` | ~~`ensure_default_admin()` seeds `admin`/`admin`~~ — replaced by `ensure_bootstrap_admin()`: env-seeded (`BOOTSTRAP_ADMIN_USER`/`PASSWORD`, required when `COOKIE_SECURE=true`), a `bootstrap_completed` marker in `app_settings` prevents any re-seed after the first boot, and dev falls back to a random logged-once password instead of a constant. `DEPLOY.md` was rewritten in Phase 6 for the single-VPS same-origin target and no longer references `admin`/`admin`. | `services/auth_service.py:148` |
| C4 | `[x]` | **No rate limiting of any kind** on any of the 140 endpoints. The only throttle in the system is a per-account login lockout, which is itself a DoS vector (see H3). | `api/main.py` |

#### High

| # | Status | Finding | Location |
|---|---|---|---|
| H1 | `[x]` | ~~Logout only clears the cookie~~ — sessions are now tracked by `jti` in the `sessions` table; `deps.py` validates the `jti` on every request (folded into the existing user re-read, no extra query), logout deletes just that session, and a new `logout-all` endpoint revokes every session for the account. Frontend still also persists a Bearer token in `localStorage` — closing that gap is M9 (cookie-only auth). | `api/security.py`, `api/deps.py`, `routers/auth.py:124` |
| H2 | `[x]` | `await file.read()` is unbounded on all four upload endpoints, and there is no request body size cap anywhere in the stack. A single request can exhaust process memory. | as C2 |
| H3 | `[x]` | ~~Failed-login lockout is keyed on username alone~~ — replaced with a new `login_attempts_ip` table keyed on `(username, ip)` with exponential backoff (15min base, doubling, capped at 4h), so an attacker can only ever lock out their own IP's attempts against a name. The old username-only table is now a delay-only global friction counter (2s once 20+ failures pile up across IPs) and can no longer lock anyone out. `_client_ip` unified with `api/middleware.py#client_ip` (proxy-aware). Rows purged past a 24h retention window regardless of lock status. | `services/auth_service.py:117`, `data/repositories/users.py:283` |
| H4 | `[x]` | `/internal/db-health` is unauthenticated and returns `str(exc)` on failure. For a connection error this can include the database host and credentials. | `api/main.py:91` |
| H5 | `[x]` | No concurrency cap on any route. 136 of 140 endpoints are synchronous `def` and share AnyIO's **default 40-thread** pool; a single timeline export can span 36 pages (`_MAX_MONTH_PAGES`). Forty concurrent heavy requests stall every subsequent request, and `backup.sqlite` additionally reads an entire generated database into memory. | `routers/timeline.py:37`, `ui/pdf.py`, `routers/settings_business.py` |

#### Medium

| # | Status | Finding | Location |
|---|---|---|---|
| M1 | `[x]` | No security headers — no HSTS, `X-Content-Type-Options`, frame-options, COOP, or CSP. | `api/main.py` |
| M2 | `[x]` | No `TrustedHostMiddleware` and no `X-Forwarded-For` handling. **Behind Nginx every request appears to originate from the proxy**, so any per-IP limit silently degrades into one shared global bucket — a self-inflicted outage waiting to happen. Must land *with* L1, never after. | `routers/auth.py:39` |
| M3 | `[x]` | ~~108 connection-open sites~~ — the 57 read sites (`get_engine().connect()`) now go through `core/db.py#db_read()`, which reuses ONE connection per GET/HEAD request via `api/middleware.py#RequestScopedDBMiddleware`. Scoped to reads only, per the sequencing note: writes keep independent `get_engine().begin()` transactions untouched, so no transaction semantics changed. The connection opens lazily inside the request's own sync execution (not in the async middleware itself) and closes via a worker thread — verified the contextvar propagates correctly across FastAPI's `run_in_threadpool` boundary. | `core/db.py`, `api/middleware.py#RequestScopedDBMiddleware` |
| M4 | `[ ]` | `list_customers` runs **7 correlated subqueries per row** and `list_customers_enriched` runs **4**, each re-scanning `rentals` for every customer. ⚠️ **Measured at 0.9 ms (8.11) — not a current problem.** Ranked too high on inspection alone; deferred. The shape is still O(customers x rentals), so revisit if the customer count grows ~10x. | `data/repositories/customers.py:98`, `:67` |
| M5 | `[ ]` | No pagination on the vehicles / customers / rentals list endpoints (17 `list_*` repository functions). Response size and query cost grow without bound as the business does. **Deliberately deferred** (Phase 5): several `list_*` functions already cap themselves (`limit=100-200` — audit, charges, compensations, vehicle_costs); the ones that don't (vehicles/customers/rentals) feed pages with no paging UI today, so adding backend limit/offset params alone would sit unused — real value needs a frontend paging design first, done together. | `data/repositories/` |
| M6 | `[x]` | ~~N+1 thumbnails~~ — new `GET /api/vehicles/thumbs/batch?ids=...` (`vehicle_photos.py#primary_photos_for`, one windowed query for N vehicles) + frontend `lib/useVehicleThumbs.ts` hook, wired into Fleet and Dashboard so a full card list issues ONE batched request instead of one per card. `VehicleThumb` keeps its old per-vehicle lazy fetch as a fallback for standalone use (`src` prop omitted). Verified: SQL tie-break matches the old single-vehicle query, and a full login→cookie-session→batch-endpoint round trip over real HTTP against an isolated DB copy. | `routers/vehicles.py`, `data/repositories/vehicle_photos.py`, `frontend/lib/useVehicleThumbs.ts` |
| M7 | `[ ]` | `busy_timeout = 5000` lets a request pin a thread for a full 5 seconds under write contention, doing nothing. | `core/db.py:126` |
| M8 | `[ ]` | `CORS_ALLOW_LAN=1` admits **any** RFC-1918 origin with `allow_credentials=True`. Acceptable for the launcher's LAN mode; must never be enabled on a public host. | `api/settings.py:77` |
| M9 | `[x]` | ~~No CSRF defence on the cookie path~~ — shipped together as required. `cookie_samesite` now defaults to `strict`; new `CSRFOriginMiddleware` (`api/middleware.py`) rejects any state-changing request that carries the auth cookie unless its Origin (falling back to Referer) is on the CORS allow-list — fails closed if both are absent. Frontend `lib/api.ts` no longer persists the token to `localStorage`/`sessionStorage`; the cookie is now the durable session, Bearer is kept in-memory-only and solely for an explicit remote `NEXT_PUBLIC_API_BASE`. `lib/auth.tsx#refresh` now always calls `/api/me` (cookie-driven) instead of gating on a stored token. LAN mode verified unaffected — `SameSite` ignores port. | `api/middleware.py`, `frontend/lib/api.ts`, `frontend/lib/auth.tsx` |

#### Verified sound — do not "fix" these

Recorded so future audits do not waste effort re-litigating them:

- **Invoice HTML is properly escaped** — `_html.escape` at `ui/invoice.py:40`, with an explicit `javascript:`/`data:` URL guard at `ui/invoice_links.py:88`.
- **All SQL is parameterised.** No string interpolation of user input into queries.
- **The dual-dialect layer is complete.** The only remaining references to `GLOB` / `INSERT OR IGNORE` / `lastrowid` are *comments* stating they were rewritten.
- **The password policy is strong** — 10 characters, 3 of 4 character classes, a common-password denylist, username-derived rejection, and correct 72-*byte* bcrypt truncation handling for multi-byte Turkish/Albanian characters.
- **`password_changed_at` genuinely invalidates older tokens** (`api/deps.py:49`), so a password reset really does terminate other sessions.
- **Re-reading the user row per request** means demotion and deactivation take effect immediately rather than lingering until token expiry. This costs one indexed read per request and is the right trade — and it is what makes the `jti` registry in 8.5 free.

### 8.3 Layered Rate Limiting (L0–L4)

Five layers, each catching what the layer above structurally cannot. The value is in
the **different keys**, not in stacking counters.

| Layer | Keyed on | Runs in | Catches | Cannot catch |
|---|---|---|---|---|
| **L0** | IP, connection | Nginx | Volumetric floods and oversized bodies, **before Python allocates memory**; survives app restarts | Anything requiring knowledge of who the user is |
| **L1** | Client IP | App middleware | Credential stuffing, scraping, unauthenticated abuse | Abuse from inside the office's shared NAT IP |
| **L2** | JWT subject (account) | App middleware | One user — or one compromised account — consuming the office's shared IP budget | Unauthenticated traffic (no subject exists yet) |
| **L3** | Route cost class | App middleware | Cheap-looking request counts hiding expensive work | Sustained *concurrent* load within budget |
| **L4** | Semaphores (user + global) | App dependency | **Concurrency**, not rate — N simultaneous long operations | Sheer request volume (that is L0–L3's job) |

**Why L4 is not redundant with L1–L3.** Rate limiting and concurrency limiting solve
different problems, and this distinction is the single most important idea in this
section. A limit of "10 PDF exports per minute" does nothing to stop ten *simultaneous*
36-page exports, because ten requests per minute is a perfectly legal rate. Those ten
requests occupy ten threads for the entire duration of the render. Only a semaphore
bounds that. **Rate limits bound arrivals; semaphores bound residency.**

**Algorithm choice.** L1–L3 use a **token bucket**, not the fixed-window counter used
in the v4.1 fork. A fixed window permits a **2× boundary burst** — 120 requests in the
final second of one window plus 120 in the first second of the next is 240 requests in
roughly two seconds, while never technically breaching "120 per minute". A token
bucket with an explicit burst allowance expresses the intent directly and degrades
smoothly.

**Route cost classes (L3).** Every route belongs to exactly one class. A route with no
declared class **inherits the strictest**, so forgetting to classify fails safe:

| Class | Contents | Budget |
|---|---|---|
| `cheap` | Reads, lookups, `/api/health`, i18n bundles | Generous |
| `write` | Ordinary CRUD mutations | Moderate |
| `heavy` | PDF exports, all `/api/data/*` backups, imports, photo uploads | Strict, and also gated by L4 |

**Storage.** The limiter is **in-process and must stay out of the database.** It is
deliberately dialect-agnostic so the Postgres migration in 8.8 cannot break it, and
keeping it out of SQLite avoids adding write contention to the very resource under
pressure. This is correct and exact for the single-process deployment in 8.1. Scaling
to multiple workers or instances requires a shared store (Redis) — see 8.7.

**Failure mode.** Every limiter rejection returns `429` with a `Retry-After` header,
and the frontend must surface it as a human message rather than a generic error.

### 8.4 Concurrency & Thread Saturation

Three distinct problems, three distinct fixes.

**1. Blocking work on the event loop (C2) — the acute bug.** Four endpoints are
declared `async def` and then call synchronous CPU-bound code. In an async framework
this is the worst case: unlike a sync endpoint, which at least runs in a worker thread,
this halts *everything* — every other request, every background task, and the rate
limiter itself. Fix: wrap the blocking call in
`starlette.concurrency.run_in_threadpool`.

> **This is the single highest-value fix in this document.** It is a handful of lines
> and it converts a whole-service outage into a slow request.

**2. An unbounded, untuned thread pool (H5).** 136 sync endpoints share AnyIO's default
40 threads. That default is a general-purpose guess, not a decision anyone made about
this workload. Fix: set the limit deliberately, informed by the Phase 0 measurements —
higher than 40 is appropriate for a pool that is mostly waiting on SQLite, but it must
be a chosen number with a rationale.

**3. No residency bound on expensive work (the actual ask).** Fix: two semaphores.

- A **global heavy semaphore** caps total concurrent expensive operations, protecting the box.
- A **per-user semaphore** caps how many one account may hold, so no single user can occupy the global pool. This is the "over-stimulated process threads" control specifically.

Behaviour at the cap is a short bounded wait, then `429` with `Retry-After` — never an
unbounded queue, which merely relocates the stall and exhausts memory while doing it.

### 8.5 Session & Authentication Model

**Current state.** A stateless JWT valid up to 14 days, held in `localStorage` and sent
as a Bearer header. Logout clears only the cookie, which the frontend does not use.
Net effect: **logout does not log you out**, and any XSS yields a two-week session that
can be exfiltrated and replayed from anywhere.

**Target state, in two coupled parts:**

**Part 1 — per-token revocation via `jti`.** Each JWT carries a unique token id; a
session registry lists live tokens per account. Logout revokes exactly that token;
"sign out everywhere" revokes all of them. Multiple concurrent devices remain
supported, which matters because a manager legitimately uses a desk PC and a phone.

The key property: `api/deps.py` **already reads the user row on every request**, so the
revocation check folds into a query that is already happening. Real revocation costs
essentially nothing. This is also why the stricter single-session pinning used in the
v4.1 fork was rejected — it buys little over a `jti` registry and bounces staff off
their own second device.

**Part 2 — move the token out of JavaScript's reach.** With Nginx serving both halves
from one origin, the token becomes an `HttpOnly`, `Secure`, `SameSite=Strict` cookie,
unreadable by any script. `SameSite=Strict` plus an `Origin` header check covers CSRF
(M9) without a token-exchange dance.

The Bearer path is **retained for LAN and dev mode only**, where the launcher serves the
frontend and API on different origins and cookies are genuinely awkward. This is why
M9 and Part 2 must ship together: enabling cookie auth without the Origin check trades
an XSS hole for a CSRF hole.

**Bootstrap and lockout (C3, H3):**

- The first admin is seeded from `BOOTSTRAP_ADMIN_USER` / `BOOTSTRAP_ADMIN_PASSWORD`, validated against the same password policy as any other account. Production refuses to boot without them. `admin`/`admin` is never created, and the silent re-seed on an empty users table is removed.
- Lockout is keyed on **IP and username together**, with **exponential backoff** rather than a flat lock, so a remote attacker can no longer lock a real user out of their own account. Failed attempts against unknown usernames are bounded and purged.

### 8.6 Runtime Performance

Ordered by value. The first item is worth more than the rest combined.

1. **One connection per request (M3).** Replace 108 independent `get_engine().connect()` calls with a request-scoped connection. This pays twice: it relieves SQLite lock contention and threadpool residency **now**, and it is what stops a future Postgres migration from feeling like a regression (see 8.8). Do this before, not after, any database change.
2. **Fix `list_customers` (M4).** Rewrite 7 correlated subqueries per row as window functions or a single join.
3. **Paginate the list endpoints (M5).** Cost currently grows with the size of the business.
4. **Batch the fleet thumbnails (M6).** One request per vehicle is one threadpool slot per vehicle.
5. **Revisit `busy_timeout` (M7)** once semaphores bound write concurrency — with contention controlled, a 5-second block should become unreachable rather than merely rarer.

### 8.7 Tuning Knobs

All values are env-configurable, and now carry **provisional shipped defaults** set
in `api/settings.py`. They are informed by the Phase 0 measurements in 8.11 but are
deliberately generous — they exist so the mechanism is live and fails safe, not
because this workload has been load-tested at production concurrency. Re-run
`backend/tools/bench_components.py` and `bench_http.py` after any change that moves
these numbers.

| Knob | Governs | Notes |
|---|---|---|
| `RATE_LIMIT_ENABLED` | Master switch | Off for LAN/dev, on in production |
| `RATE_LIMIT_IP_*` | L1 token bucket rate + burst | |
| `RATE_LIMIT_ACCOUNT_*` | L2 per-account rate + burst | |
| `RATE_LIMIT_COST_*` | L3 per-class budgets | One per cost class |
| `HEAVY_CONCURRENCY_GLOBAL` | L4 global semaphore | Start low; raise only with evidence |
| `HEAVY_CONCURRENCY_PER_USER` | L4 per-account semaphore | Start at 1 |
| `THREADPOOL_MAX` | AnyIO thread limit | Replaces the inherited default of 40 |
| `MAX_UPLOAD_BYTES` | Per-file upload cap | Enforced at Nginx **and** in the app |
| `MAX_REQUEST_BYTES` | Total body cap | |
| `TRUST_PROXY` | Whether to read `X-Forwarded-For` | **On behind Nginx, off otherwise.** Wrong either way breaks per-IP limiting — see M2 |
| `BOOTSTRAP_ADMIN_USER` / `_PASSWORD` | First-run admin | Required in production |

**Scaling note.** Every limiter value above is **per process**. Running more than one
uvicorn worker multiplies the effective limits by the worker count. Moving beyond a
single process requires a shared counter store first; do not raise the worker count
and assume the limits still hold.

### 8.8 SQLite → Postgres Migration Trigger

**Decision: stay on SQLite for now.** For an office-sized deployment on local disk it
is the fastest option available, because this application is *chatty* — the 108
connection-open sites in M3 mean a single page load makes many round-trips, which are
nearly free against a local file and costly against a network database. The managed
Turso/Neon path described in section 6 would measurably **slow the application down**
unless M3 lands first.

**Postgres is already a configuration change, not a project.** The dual-dialect layer
in `core/db.py` is complete: the only SQLite-specific SQL remaining in live queries is
`strftime` and `datetime('now')`, both covered by the `_PG_SHIMS` functions installed
on Postgres. Setting `DATABASE_URL=postgres://…` genuinely is the migration.

**Protect that property.** Nothing new may be added that assumes SQLite — in
particular the rate limiter stays in-process (8.3) rather than becoming a table.

**Migrate when measured, not when it feels slow.** The trigger is `SQLITE_BUSY` /
lock-wait events crossing a defined threshold in the monitoring added in Phase 2.
SQLite's single-writer lock is the real ceiling; concurrent *reads* are unaffected by
it, so read slowness is evidence for 8.6, **not** evidence for migrating.

**Shipped (Phase 6):** the trigger is now a real counter, not just a comment
promising one. `core/db.py#_instrument_sqlite_busy` attaches a SQLAlchemy
`handle_error` listener to the engine; a caught `database is locked` increments
`db.sqlite_busy` in `api/monitoring.stats`, visible at `/internal/stats`.
Verified against a real lock: two raw connections, one holding `BEGIN
EXCLUSIVE`, the other forced through with `busy_timeout=0` so it fails instead
of waiting out the 5s retry — the listener fired and the counter incremented.

### 8.9 Nginx Reference Configuration

Nginx provides L0 and the same-origin arrangement that 8.5 depends on. It contributes
three things the application cannot do for itself:

- **`client_max_body_size`** rejects oversized uploads before Python allocates a single byte (H2). An application-level check necessarily runs after the body has begun arriving.
- **`limit_req` / `limit_conn`** absorb volumetric floods outside the Python process, so an attack cannot consume the workers that would serve the 429s.
- **Limits that survive an application restart**, unlike the in-process buckets.

Two correctness requirements: Nginx must set `X-Forwarded-For`/`X-Real-IP` **and** the
app must set `TRUST_PROXY=true`. Setting neither means every request looks like it came
from the proxy and the entire company shares one bucket; setting only the latter lets a
client spoof its own IP and bypass L1 entirely.

**Shipped (Phase 6):** `nginx/balkan-fleet.conf.example` — TLS termination, the
`/api` proxy, `client_max_body_size`, `limit_req`/`limit_conn` (L0), and the
`X-Forwarded-For`/`X-Real-IP` headers `TRUST_PROXY=true` depends on. Paired
with `.env.production.example` (every backend knob, REQUIRED ones called out)
and `nginx/balkan-fleet-{api,web}.service.example` (systemd units — see
`DEPLOY.md`). Also closed in the same pass: `frontend/lib/api.ts#apiBase()`
had no way to express "same origin, no port" — with `NEXT_PUBLIC_API_BASE`
unset it fell back to `https://domain:8001`, bypassing Nginx and hitting a
port that isn't publicly exposed. A new `NEXT_PUBLIC_API_BASE=same-origin`
literal makes every API call a plain relative fetch instead (verified against
all four modes: same-origin, LAN, remote split-host, local dev — see
`frontend/.env.production.example`).

### 8.10 Phased Rollout & Verification

| Phase | Contents | Gate |
|---|---|---|
| **0 · Measure** | Time PDF builds, `backup.sqlite`, photo encode; count queries and connections per page load; record p50/p95 under simulated office load | **No limit or semaphore value is chosen before this.** These numbers are the acceptance baseline for every later phase |
| **1 · Critical** | C1 boot guard, C2 event-loop offload, H2 size caps, H4 db-health | `/api/health` stays responsive during a photo upload |
| **2 · Limiting** | L0–L3, `TRUST_PROXY` + `TrustedHostMiddleware` (M2), security headers (M1), request-id logging, generic errors | A single account cannot exhaust the office IP budget; a window-boundary burst is smoothed, not doubled |
| **3 · Concurrency** | L4 semaphores, deliberate thread limit, bounded exports | N concurrent 36-page exports cap cleanly; ordinary requests stay responsive; excess gets `429` + `Retry-After` |
| **4 · Auth** | `jti` registry, cookie migration + Origin check (M9), bootstrap admin (C3), IP-aware backoff (H3) | Logout kills that token immediately, other devices survive, "sign out everywhere" kills all |
| **5 · Performance** | M3 request-scoped connections, M4, M5, M6 | p95 for normal reads improves and does not regress |
| **6 · Deploy** | Nginx same-origin config, HSTS, `.env.production.example`, migration trigger | Full pass against the Phase 0 baseline |

**Sequencing constraints that are not negotiable:**

- **M2 ships with L1, never after.** A per-IP limiter behind an unconfigured proxy is worse than no limiter — it is a company-wide outage with extra steps.
- **M9 ships with the cookie migration.** Separating them trades an XSS hole for a CSRF hole.
- **M3 ships before any Postgres migration**, or the migration will read as a performance regression.
- **Phase 0 precedes everything.** Every number in 8.7 is otherwise a guess wearing a configuration file as a disguise.

**Testing.** The repository currently has **no test suite**. Each phase adds targeted
tests for the behaviour it introduces; the concurrency and limiter phases in particular
cannot be verified by inspection and need tests that actually generate load.

### 8.11 Phase 0 — Measured Baseline

Measured against an **isolated replica** of the live database (real data volume, a
throwaway admin account, real data never touched). Harness lives in
`backend/tools/` — `bench_components.py` (in-process timings + SQL counts) and
`bench_http.py` (concurrency behaviour over HTTP). Re-run both after every phase.

**Dataset at time of measurement:** 13 vehicles, 42 customers, 48 rentals — i.e. the
real scale of this business, which is small. Several conclusions below hold *because*
of that and would change at 10x.

#### Component timings

| Operation | p50 | max | SQL queries | connections |
|---|---|---|---|---|
| `list_vehicles()` | 0.2 ms | 0.3 ms | 1 | 1 |
| `list_customers()` — 7 correlated subqueries/row | **0.9 ms** | 1.3 ms | 1 | 1 |
| `list_customers_enriched()` — 4/row | 0.9 ms | 1.3 ms | 1 | 1 |
| `list_all_rentals_with_vehicle()` | 0.5 ms | 0.8 ms | 1 | 1 |
| Invoice HTML (1 deal) | 46 ms | 53 ms | 6 | 6 |
| **Invoice PDF (1 deal, 2 A4 copies)** | **201 ms** | 314 ms | 10 | 10 |
| Timeline PDF — 1 month | 110 ms | 457 ms | 0 | 0 |
| Timeline PDF — 36 months (`_MAX_MONTH_PAGES`) | 99 ms | 180 ms | 0 | 0 |
| `admin_ops.export_all()` (whole DB) | 9 ms | 24 ms | 10 | 1 |
| `encode_photo` — 2 MP | 33 ms | 36 ms | 0 | 0 |
| **`encode_photo` — 12 MP (modern phone)** | **125 ms** | 126 ms | 0 | 0 |

**Four findings that changed the plan's priorities:**

1. **The event-loop block was the only severe runtime issue, and it is quantified.**
   8 phone photos x 125 ms = ~1 second of fully frozen event loop per upload.
2. **M4 (`list_customers`' 7 correlated subqueries) is a non-issue at this scale** —
   0.9 ms. It was ranked too high on inspection alone. Revisit only if the customer
   count grows by an order of magnitude; the query shape is still O(customers x rentals).
3. **The 36-page timeline PDF is not the threat it looked like** — 99 ms, no worse
   than a 1-month export, because most months contain no rentals and render nearly
   empty. Page count is not the cost driver; font loading is (note the 457 ms max on
   the *first* PDF, which is DejaVu TTF parsing, then ~100 ms warm).
4. **Backups are cheap** (9 ms) at a 319 KB database. `backup.sqlite` reading the
   whole file into memory is fine now and scales linearly — worth revisiting only if
   photo volume grows substantially.

#### C2 — event-loop blocking, before vs after

Identical load (8 x 12 MP upload) against the same replica, measuring `/api/health`
latency *concurrently*:

| | health p50 | **health max** | probes served |
|---|---|---|---|
| Pre-fix (blocking `encode_photo`) | 15.5 ms | **958.5 ms** | 12 |
| Fixed (`run_in_threadpool`) | 13.6 ms | **29.4 ms** | 49 |

**32x better worst-case latency, and 4x more requests served in the same window.**
The 958 ms stall corroborates the component measurement almost exactly (8 x 125 ms),
which is the strongest evidence that the diagnosis was right: the event loop was
blocked for precisely as long as the encoding took.

#### L4 — concurrency cap

30 simultaneous invoice PDF requests from one account (`heavy_concurrency_global=3`,
`heavy_concurrency_per_user=1`, 5 s acquire timeout):

- **22 completed 200**, **8 shed as 429** with `Retry-After`. Nothing hung; nothing
  queued unboundedly. `/internal/stats` attributed all 8 to
  `concurrency.rejected.per_user`, which is the per-user cap doing exactly its job.
- At 8-way concurrency, all 8 completed (p50 1.5 s) — serialized by the per-user cap
  and still inside the timeout. **The cap sheds load only when it must**, which is
  the intended behaviour: bound residency first, reject only as a last resort.

#### L1–L3 — rate limiting

15 rapid requests to a public endpoint in the strict `auth` bucket returned
**5 x 200 then 10 x 429** with `Retry-After: 3`. Note the cut-in at 5, not 10: the
sustained rate is 10/min but the token-bucket *burst* is `limit // 2` = 5. Burst and
rate are separate dials, and the burst is what a user actually feels — worth setting
explicitly rather than deriving, when these are tuned for real.

#### Not yet measured

- Behaviour at 10x data volume (the M4/M5 pagination question).
- Sustained multi-user load over minutes rather than seconds.
- `SQLITE_BUSY` / lock-wait rates under concurrent writes — the 8.8 migration trigger.
  Reads are demonstrably fast; the write path is the open question.
