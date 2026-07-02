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
| Languages | Turkish, English, German, Italian, Spanish, Albanian |
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
│   │   ├── terms.py                # rental_terms(lang) — 13 rules × 6 languages
│   │   ├── i18n.py                 # TRANSLATIONS registry + t(key, lang)
│   │   ├── lang_de.py              # German
│   │   ├── lang_es.py              # Spanish
│   │   ├── lang_it.py              # Italian
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
| German | `de` | |
| Italian | `it` | |
| Spanish | `es` | |
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
