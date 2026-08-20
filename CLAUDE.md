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

### The launcher (preferred on Windows)

Double-click `start.bat` → boots `launcher/launcher.py` on `127.0.0.1:8800` → serves the
repo-root `index.html`, which has two buttons:

- **This PC only** — API on `127.0.0.1`, `next dev -H 127.0.0.1`.
- **Local WiFi network** — API on `0.0.0.0`, `next start -H 0.0.0.0` (production build),
  `CORS_ALLOW_LAN=1`. Shows the `http://<lan-ip>:3000` address + QR for staff devices.

The launcher owns both child processes (`taskkill /T` on stop — `/T` matters, npm spawns
a node child), tails their output into the page, and refuses to start when a port is
already taken. See DOCUMENTATION.md → "Running on the local network" for the four gates
LAN mode has to open.

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

Created automatically by `init_db()`, once, on a genuinely empty database — see
`services/auth_service.py` `ensure_bootstrap_admin()`. Set `BOOTSTRAP_ADMIN_USER` /
`BOOTSTRAP_ADMIN_PASSWORD` to pin the credentials (required when `COOKIE_SECURE=true`);
otherwise a random password is generated and logged once. There is no more
`admin`/`admin` default.

---

## Architecture at a Glance

```
frontend/          Next.js 14 App Router (TypeScript, Tailwind 3.4)
backend/
  api/             FastAPI app layer (routers, settings, deps, security)
  config/          Shared config: roles, i18n (3 langs), rental terms
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
| `backend/api/middleware.py` | L1–L3 rate limiting (token bucket), body caps, security headers, request timing. Pure ASGI |
| `backend/api/concurrency.py` | L4 — `heavy_slot` dependency; global + per-user semaphores for expensive routes |
| `backend/api/uploads.py` | `read_capped()` — the only safe way to read an upload body |
| `backend/api/monitoring.py` | Loggers + `stats` (per-route p50/p95, served at `/internal/stats`) |
| `backend/tools/bench_*.py` | Phase 0 benchmark harness — re-run after every hardening phase |
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
| `frontend/components/ViewToggle.tsx` | Shared card/table view switch (Fleet, Reservations, Customers); `max-lg:hidden` |
| `frontend/components/BottomNav.tsx` | Phone-only thumb-zone bottom bar (`md:hidden`) + the More burger |
| `frontend/components/NavDrawer.tsx` | Phone burger sheet — Fleet, Reminders, Settings, Logout |
| `frontend/components/RecordCard.tsx` | Stacked stand-in for a table row below `lg` |
| `frontend/lib/nav.ts` | `routeFor` / `isNavActive` / `splitNav` — one source for both navs |
| `frontend/lib/useResponsiveView.ts` | Card/table pick, with table treated as desktop-only |
| `frontend/lib/useMediaQuery.ts` | SSR-safe `matchMedia`; only for widths CSS cannot reach |
| `frontend/lib/dates.ts` | ISO-day calendar model — the only place date maths lives |
| `frontend/components/DateField.tsx` | The app's single date input (replaces `type="date"`) |
| `frontend/components/TimeSelect24.tsx` | The app's single time input — same trigger as `DateField` |
| `backend/services/permissions_service.py` | Stored role/permission overrides + scope guards |
| `launcher/launcher.py` | Desktop launcher — serves `index.html`, supervises both servers, LAN mode |
| `index.html` | The launcher page (repo root); `__LAUNCHER_TOKEN__` is substituted at serve time |
| `launcher/allow-firewall.bat` | Private-profile inbound rules for 3000/8001 (needs UAC) |
| `backend/api/routers/admin_panel.py` | `/api/admin/permissions` — the role matrix |
| `frontend/components/AdminPanel.tsx` | Admin Panel UI — mounted as Settings → Roles, not a route |

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
- Levels are the **baseline**, not the last word: the Admin Panel can grant/revoke
  individual permissions per role on top of them. `can()` is still the single gate —
  it consults the override provider installed by `services/permissions_service.py`.
  A super_admin always holds everything, and the `administration` permission group is
  never overridable (see `LOCKED_PERMISSIONS`).

---

## Security & Runtime Hardening

> **Status: Phases 0–4, 5, and 6 all shipped.**
> Live now: the L1–L3 rate limiter (`api/middleware.py`), L4 concurrency semaphores
> (`api/concurrency.py`), bounded uploads (`api/uploads.py`), request timing
> (`api/monitoring.py`), security headers, the JWT boot guard, `jti`-based session
> revocation (logout / logout-all), env-seeded bootstrap admin (no more
> `admin`/`admin`), `(username, ip)`-keyed login lockout with exponential backoff,
> the `HttpOnly`-cookie + CSRF Origin check, request-scoped read connections
> (`core/db.py#db_read()` + `RequestScopedDBMiddleware`, M3), batched fleet
> thumbnails (M6), server-side pagination on the Fleet/Customers table views
> (M5), a real `db.sqlite_busy` counter for the §8.8 migration trigger, and the
> full Nginx/systemd single-VPS deployment config (Phase 6, see "Deployment
> Targets" below). Verified by measurement — DOCUMENTATION.md §8.11.
>
> **Still outstanding:** the pytest suite scoped to Phase 4 auth behaviour
> (`httpx` is not installed in this environment). Full audit and phased plan:
> **DOCUMENTATION.md → §8**.

The target deployment is a **single VPS + Nginx, same-origin** (frontend at `/`,
API proxied at `/api`), uvicorn single process, SQLite on local disk.

### Rules that must hold in new code

**1. Never call blocking code inside an `async def`.**
This is the rule that matters most. A blocking call in an `async` handler halts the
entire service — every request, every background task, and the rate limiter itself,
because they all share one event loop. A sync `def` handler at least gets a worker
thread. Wrap CPU-bound or blocking work in `starlette.concurrency.run_in_threadpool`.
Pillow encoding, PDF building, `json.loads` of a request body, and any database import
all count. Four endpoints violate this today (see §8.2 C2) — do not add a fifth.

**2. Every new route declares a cost class.**
`cheap` (reads) / `write` (CRUD) / `heavy` (PDF, backup, import, upload). An
unclassified route **inherits the strictest budget**, so forgetting fails safe. Any
route that can run for seconds, allocate large buffers, or produce multi-page output is
`heavy` and must also take the L4 concurrency semaphore — not just a rate limit.
Rate limits bound *arrivals*; semaphores bound *residency*. Ten simultaneous 36-page
PDF exports is a legal rate and still a stalled server.

**3. The rate limiter stays in-process and out of the database.**
It must remain dialect-agnostic so the eventual Postgres migration cannot break it, and
adding limiter writes to SQLite would put contention on the exact resource under
pressure. Its values are **per process** — more uvicorn workers multiply the effective
limits, so do not raise the worker count without a shared counter store first.

**4. Reuse the request-scoped connection; paginate new list endpoints.**
There are already 108 independent `get_engine().connect()` sites (§8.2 M3). Do not add
more. Every one contends for the SQLite write lock while pinning a threadpool slot, and
each becomes a network round-trip after a Postgres migration.

**5. Never re-enable `CORS_ALLOW_LAN` on a public host.**
It admits any RFC-1918 origin with `allow_credentials=True`. It exists for the desktop
launcher's LAN mode and nowhere else.

**6. Uploads are always bounded.**
Any new endpoint reading a request body needs a size cap. `await file.read()` with no
limit is memory exhaustion from a single request.

### Sequencing constraints

Three pairs must land together — splitting them makes things *worse*, not partially
better:

- **`TRUST_PROXY` ships with per-IP limiting.** Behind Nginx, `request.client.host` is the *proxy's* address, so an unconfigured per-IP limiter degrades into one shared bucket for the entire company — a self-inflicted outage. Trusting `X-Forwarded-For` without Nginx actually setting it lets clients spoof their own IP and skip the limiter entirely.
- **The CSRF Origin check ships with the `HttpOnly` cookie migration.** Alone, the cookie move trades an XSS hole for a CSRF hole.
- **Request-scoped connections ship before any Postgres migration**, or the migration reads as a performance regression.

### Environment knobs (planned)

`RATE_LIMIT_ENABLED`, `RATE_LIMIT_IP_*`, `RATE_LIMIT_ACCOUNT_*`, `RATE_LIMIT_COST_*`,
`HEAVY_CONCURRENCY_GLOBAL`, `HEAVY_CONCURRENCY_PER_USER`, `THREADPOOL_MAX`,
`MAX_UPLOAD_BYTES`, `MAX_REQUEST_BYTES`, `TRUST_PROXY`, `BOOTSTRAP_ADMIN_USER`,
`BOOTSTRAP_ADMIN_PASSWORD`.

**Defaults are intentionally unset** until the Phase 0 measurements exist — see §8.7.
A number invented before measuring is a guess wearing a config file as a disguise.

### Database

**SQLite stays for now.** This app is chatty (see rule 4), and those round-trips are
nearly free against a local file but costly against a network database — the managed
Turso/Neon path in `DEPLOY.md` would make it *slower*. Postgres is already just
`DATABASE_URL=postgres://…`: the dual-dialect layer in `core/db.py` is complete, with
only `strftime`/`datetime('now')` needing the `_PG_SHIMS`. Migrate on the measured
trigger in §8.8 (`SQLITE_BUSY` / lock-wait events), not on a hunch — SQLite's ceiling
is its single *writer*, so slow reads are evidence for query work, not for migrating.

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

- 3 languages: Turkish (`tr` — default), English (`en`), Albanian (`sq`).
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

## Responsive Tiers (phone / tablet / desktop)

Stock Tailwind breakpoints map to the three tiers, so `tailwind.config.ts` needs
no `screens` entry:

| Tier | Range | Prefix | Grid |
|---|---|---|---|
| Phone | `< 768px` | unprefixed | 4 columns |
| Tablet | `768–1023px` | `md:` | 8 columns |
| Desktop | `≥ 1024px` | `lg:` / `xl:` | 12 / the page's own grid — **frozen** |

**Desktop is frozen.** ≥1024px must render exactly as it did before the mobile
pass. Two rules make that hold:

1. **Every `md:` class needs an explicit `lg:` counterpart.** Tailwind
   breakpoints are min-width, so a `md:` value written for the tablet tier
   otherwise leaks upward and reshapes desktop.
   `grid-cols-2 md:grid-cols-4` → `grid-cols-4 md:grid-cols-8 lg:grid-cols-4`.
2. **Prefer `max-lg:` overrides to re-scoping desktop classes.** Leaving the
   desktop declaration a literal, unmodified string is safer, and it dodges the
   shorthand/longhand trap — `rounded-card` sets `border-radius` while
   `rounded-t-2xl` sets two longhands, so with both live at `lg` the winner
   depends on Tailwind's emit order, not on intent. See `components/Modal.tsx`.

### The mobile CSS layer

`app/globals.css` ends with a `@media (max-width: 1023.98px)` block, a
`@media (hover: none)` block and the `.df-pop.is-narrow` rules. **They must stay
last in the file** — a media query contributes no specificity, so rules declared
further down (`.seg-btn`, `.cal-bar:hover`) would win the source-order tie.

Two specificity gotchas that layer already solves:
- A bare `input`/`select` selector is (0,0,1) and **loses to Tailwind's
  `text-xs`** (0,1,0). The 16px anti-iOS-zoom rule uses
  `input:not([type="checkbox"]):not([type="radio"])` / `select:not([hidden])` to
  reach (0,2,1)/(0,1,1) and win.
- For a checkbox the `<label>` is the real tap target;
  `label:has(> input[type="checkbox"])` gives it the 44px floor app-wide.

### Navigation by tier

- **Phone** — `components/BottomNav.tsx`, a `md:hidden` fixed bottom bar:
  Dashboard / Reservations / Customers / Finance + **More**, which opens
  `components/NavDrawer.tsx` (bottom sheet: Fleet, Reminders, Settings, Logout).
  `lib/nav.ts#splitNav` does the split from the *server's* permission-filtered
  `/api/nav` payload — never a hardcoded list, so a visitor gets one slot + More.
  Reminders does **not** close the sheet: `Bell` owns its own Modal, so
  unmounting it would destroy the dialog in the same tick it opened.
- **Tablet** — `Sidebar` as a 64px icon rail holding everything; the burger
  expands it to the 236px labelled sidebar. No bottom bar.
- **Desktop** — `Sidebar` expanded at 236px, exactly as before.
- z-index ladder: `BottomNav` 40 < `NavDrawer` 50 = `Modal` 50 < pickers 60.

### Other tier-aware pieces

- `lib/useResponsiveView.ts` — Fleet / Reservations / Customers force the **card**
  view below `lg` (the table is desktop-only). It forces rather than CSS-hiding
  because `VehicleThumb` fetches a photo per vehicle on mount regardless of
  visibility. `ViewToggle` is `max-lg:hidden`.
- `components/RecordCard.tsx` — the stacked stand-in for a table row, used by
  pages that have **no** existing card view (Dashboard). `hidden lg:block` on the
  `<table>`, `lg:hidden` on the card list; one React state feeds both.
- `lib/useMediaQuery.ts` — only for widths that feed inline styles and that CSS
  cannot reach (`Timeline`'s `LABEL_W`: 150 desktop / 104 below). SSR-safe, so it
  returns `false` on the first render: use it to *upgrade* a layout, never to
  hide something the phone needs.
- `DateField`'s popover clamps its width to `innerWidth - 16` and sets
  `is-narrow`, which stacks the preset rail above the month. Both pickers now
  close on resize **only when the width changed** — the mobile keyboard fires a
  height-only resize and used to dismiss them instantly.

---

## Recent Updates (this session)

- **Customers page — report column order, list sort, and a delete that sticks.**
  The report modal (PDF + CSV) picks column ORDER by drag & drop, not just which
  columns: `_pick_columns()` keeps the caller's order instead of re-sorting into
  `_COLUMNS` order (an empty request still means "every column, registry order",
  so plain `GET /api/reports/customers.csv` is unchanged). The list gained a
  sort dropdown — `GET /api/customers?sort=name|start_date|price`, applied
  before the page slice so it orders the list rather than one page, driving the
  card deck and the paged table from one control. And `lib/deleteUndo.tsx` no
  longer loses the delete: `settle()` was returning the pending entry through a
  `setPending` updater — which React 18 runs on the NEXT render — so the 10s
  timer bailed out before it had anything and no DELETE was ever sent. It reads
  a ref now; `pagehide` flushes anything still pending (`keepalive`), and
  `isPending(key)` keeps a polled refetch from resurrecting a removed row.

- **Mobile + tablet responsiveness pass.** See "Responsive Tiers" above. Phone
  gets a thumb-zone bottom bar + burger sheet, tablet gets the icon rail, and
  desktop (≥1024px) is unchanged — verified by measuring `<main>` padding,
  sidebar width, bento columns, `.neo-panel` padding, `Modal` geometry and the
  Timeline label gutter at 1024/1280 against the pre-pass values. Zero horizontal
  overflow, zero sub-44px targets and zero sub-16px form fields on all six pages
  at 375px and 768px. Night-mode fix: inactive sidebar labels were a hardcoded
  `#3F3F46` (~1.3:1 on the dark surface); light mode keeps that literal value and
  `dark:text-muted` layers on top (6.06:1).

- **New — run on this PC or over the local wifi (`launcher/launcher.py`):** `start.bat`
  no longer opens two `cmd` windows and `index.html` over `file://`. It boots a stdlib
  control server on `127.0.0.1:8800` that serves the launcher page and supervises both
  servers. Two buttons pick the bind: **This PC only** (`127.0.0.1`, `next dev`) or
  **Local WiFi network** (`0.0.0.0`, production build, `CORS_ALLOW_LAN=1`), the latter
  showing the `http://<lan-ip>:3000` address + QR for staff devices. The page keeps
  working over `file://`, degrading to the old read-only ping view.
  - **`lib/api.ts` resolves the API host at runtime.** `NEXT_PUBLIC_API_BASE` is inlined
    at *build* time, so a baked-in loopback made LAN mode impossible. Now a loopback (or
    unset) value means "follow `window.location.hostname`", while an explicit *remote*
    base is still used verbatim — production is untouched, and one build serves every
    IP the machine ever has. `API_BASE` was replaced by `apiBase()`; the only two call
    sites are the `fetch` in `api.ts` and the logo/stamp `<img>` in `settings/page.tsx`.
  - **`CORS_ALLOW_LAN`** (new, default **off**) adds `settings.cors_origin_regex` —
    loopback on any port plus the three RFC-1918 ranges — because `allow_credentials=True`
    forbids a `*` wildcard. The launcher also passes `CORS_ORIGINS` with the machine's own
    NetBIOS name, which the regex can't express and which staff can reach the box by.
  - Windows details that matter: stop uses `taskkill /T` (npm spawns a surviving `node`
    child), LAN IP comes from a default-route UDP socket (a WSL/Hyper-V box has several
    IPv4s and `getaddrinfo` order is meaningless), and starting refuses outright when a
    port is already held by a foreign process instead of "succeeding" against it.
- **New — one date control everywhere:** `frontend/lib/dates.ts` (ISO-day model:
  `buildMonth()` 6×7 grid, `addDaysISO`, `daysBetweenISO`, localized labels) +
  `frontend/components/DateField.tsx`, a themed portal-rendered calendar popover.
  Every `<input type="date">` in the app is gone — Booking, Reservations edit,
  Dashboard availability, Finance costs (×2) and Settings licence all use `DateField`.
  Pass `rangeStart`/`rangeEnd` to tint the nights of a rental across both pickers.
  Pass `compact` for a content-sized trigger (icon + date, no weekday prefix or
  caret) — used wherever several date/time controls share a line. The popover is
  a fixed 362×293 card and never stretches to the trigger's width. The card is a
  **preset rail** (Today / Last week / Next week / Next month / Last month —
  disabled, never clamped, when `min`/`max` rules one out) beside one month whose
  header carries real **month and year `select`s** (`monthLabels()`,
  `yearOptions()` in `lib/dates.ts`), so a date a year out is two clicks instead
  of twelve chevrons.
- **Time picker matches the date picker:** `components/TimeSelect24.tsx` is no
  longer a pair of always-open scroll wheels (96px of vertical space in every row
  that had one). It wears the same `.df-trigger` face — clock icon + `HH:MM` —
  and opens a portal-rendered list of quarter-hours, centred on the current value.
  Still always 24h; a value off the 15-minute grid is spliced into the list rather
  than rounded away. Everywhere a date and a time describe one moment (booking
  dialog, reservation edit) the **time now sits under the date**, not beside it.
- **Booking form fits one screen:** `BookingDialog` is now
  `[rental period spanning the form | vehicle+pricing ‖ client info | live invoice preview]`,
  preview down the **right** edge. Client Information starts on the *same row* as
  the vehicle/rate block; the period band is one left-to-right line
  (pick-up → return → duration). `Modal` gained `size` (`md`/`lg`/`xl`/`full`) +
  `bodyClassName`; the booking modal uses `size="full"` (capped at 1180px, sized
  to the form rather than the viewport) and does not scroll at 1280×720.
- **New — `frontend/components/InvoicePreview.tsx`:** live miniature of the client's
  invoice, rendered purely from form state (no PDF build / API call per keystroke).
  Renders in the *invoice* language, which is independent of the UI language.
- **New — Admin Panel (Settings → Roles, `frontend/components/AdminPanel.tsx`,
  `backend/api/routers/admin_panel.py`):** staff grouped by role + a checkbox matrix
  of roles × permissions, categorized in rows. It is **not** a sidebar entry — it's
  configuration, so it lives with the other admin screens in Settings. Staff Accounts
  renders the role groups as one row of columns (`.staff-grid`, `auto-fit`), collapsing
  to fewer columns as space narrows. Super admin sees the full matrix; an admin sees
  only the client-registration slice for the roles below them. See DOCUMENTATION.md →
  "Admin Panel" for the guardrails.
- **New — role/permission override layer:** `config/roles.py` keeps the level baseline
  and stays DB-free; `services/permissions_service.py` injects stored overrides via
  `set_override_provider()` (installed in `api/main.py`'s lifespan). Overrides live as
  one JSON blob in `app_settings.role_permission_overrides`, cached 5s.
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

**Current plan of record — single VPS, same-origin:**

| Layer | Service |
|---|---|
| Database | **SQLite on local VPS disk** (Postgres later via `DATABASE_URL` — see §8.8) |
| Backend | **uvicorn, single process**, proxied at `/api` |
| Frontend | **Next.js served by Nginx at `/`** — same origin as the API |
| Edge | **Nginx** — TLS, `limit_req`/`limit_conn`, `client_max_body_size` (L0) |

Same-origin is a security requirement, not a convenience: it removes CORS entirely and
is what makes the `HttpOnly` cookie migration possible (DOCUMENTATION.md → §8.5).

**`DEPLOY.md` was rewritten in Phase 6** for this single-VPS same-origin target — no
more Vercel/Render/Turso, no more `admin`/`admin`. Config templates live at
`.env.production.example` (backend), `frontend/.env.production.example` (frontend —
`NEXT_PUBLIC_API_BASE=same-origin`), and `nginx/` (the Nginx config + two systemd
units). Fixed in the same pass: `frontend/lib/api.ts#apiBase()` had no way to express
"same origin, no port" — with the env var unset it fell back to guessing a port that
isn't publicly exposed behind Nginx. The new `same-origin` literal makes every API call
a plain relative fetch instead.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
