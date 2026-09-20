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

Two terminals. There is no launcher — it was removed when the project moved to a VPS
deployment, along with the LAN-hosting code paths (`CORS_ALLOW_LAN` and the RFC-1918
origin regex no longer exist; see "Security & Runtime Hardening" below).

### Backend (FastAPI)

```bash
cd backend
pip install -r requirements.txt
uvicorn api.main:app --reload --port 8001
```

- API base: `http://127.0.0.1:8001`
- First run creates `fleet.db` (SQLite) and seeds it from `fleet_master.csv`.
- Health check: `GET /api/health`

### Frontend (Vite + React)

```bash
cd frontend
npm install
npm run dev
```

- UI: `http://localhost:3000`
- **No `.env.local` needed.** The Vite dev server proxies `/api` to
  `127.0.0.1:8001` (`vite.config.ts`), so dev is same-origin exactly like
  production. Set `VITE_API_BASE` only for a genuinely remote API.

### Default admin credentials (first run)

Created automatically by `init_db()`, once, on a genuinely empty database — see
`services/auth_service.py` `ensure_bootstrap_admin()`. Set `BOOTSTRAP_ADMIN_USER` /
`BOOTSTRAP_ADMIN_PASSWORD` to pin the credentials (required when `COOKIE_SECURE=true`);
otherwise a random password is generated and logged once. There is no more
`admin`/`admin` default.

---

## Architecture at a Glance

```
frontend/          Vite 5 + React 18 SPA (TypeScript, Tailwind 3.4, React Router 6)
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
| `backend/core/db.py` | Engine init (SQLite / Turso libSQL / Postgres), `init_db()`, migrations, `_PG_SHIMS` |
| `backend/core/schema.sql` | 11 tables, 9 indexes |
| `backend/services/auth_service.py` | Password hashing, login, temp password |
| `backend/services/scheduling_service.py` | Availability check, return window |
| `backend/ui/invoice_links.py` | QR payloads + per-QR guided action buttons |
| `frontend/App.tsx` | The route table — every path in one file |
| `frontend/main.tsx` | Entry: BrowserRouter → Providers → App |
| `frontend/index.html` | Vite entry document; carries the pre-paint theme-boot script |
| `frontend/pages/` | One file per route + `AppLayout` (the auth gate, `<Outlet/>`) |
| `frontend/ErrorBoundary.tsx` | Replaces Next's `error.tsx`; wraps each route element |
| `frontend/lib/api.ts` | Fetch wrapper; `apiBase()` (same-origin / remote / loopback) + HttpOnly-cookie auth |
| `frontend/lib/auth.tsx` | `useAuth()` context |
| `frontend/lib/i18n.tsx` | `useT()` i18n context |
| `frontend/lib/toast.tsx` | `useToast()` — portal-rendered success/error/info toasts |
| `frontend/lib/currency.tsx` | `useCurrency()` / `useMoney()` — the display-currency context and the one money formatter every screen uses |
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
| `nginx/` | Production Nginx config + the two systemd units |
| `backend/api/routers/admin_panel.py` | `/api/admin/permissions` — the role matrix |
| `frontend/components/AdminPanel.tsx` | Admin Panel UI — mounted as Settings → Roles, not a route |

---

## Database

- **Dev:** SQLite (`fleet.db` in backend dir); no setup needed.
- **Prod:** SQLite on the VPS's local disk — the same engine, deliberately. See the
  Database note under "Security & Runtime Hardening" for why, and §8.8 for the measured
  trigger that would change it. `DATABASE_URL=postgres://…` switches to Postgres when
  that day comes.
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

**5. CORS is exact-match only. Never add an origin regex.**
`CORS_ALLOW_LAN` and `settings.cors_origin_regex` were deleted with the launcher. With
`allow_credentials=True` a pattern hands the session cookie to every host it spans, and
the same list backs the server's own CSRF Origin check (`middleware._origin_allowed`),
where there is no browser enforcing anything on top. If a new origin needs access, add
that exact origin to `CORS_ORIGINS`.

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
nearly free against a local file but costly against a network database — a *managed*
Postgres would make it **slower**. Postgres is already just `DATABASE_URL=postgres://…`:
the dual-dialect layer in `core/db.py` is complete, with only `strftime`/`datetime('now')`
needing the `_PG_SHIMS`. Migrate on the measured trigger in §8.8, now a concrete number
(**>10 `db.sqlite_busy` events/hour sustained across a working day**), not on a hunch —
SQLite's ceiling is its single *writer*, so slow reads are evidence for query work, not
for migrating. When the time comes, put Postgres on the **same box**; the latency
objection only applies to a remote one.

**The Postgres path is rehearsed, not theoretical.** It was run end to end against a
real Postgres 16 — schema, all migrations, both shims, a 962-row restore, and
byte-identical finance figures on both engines (DOCUMENTATION.md §8.8). Four defects
were found and fixed doing it, all invisible on SQLite: backup-restore desyncing every
sequence, the `strftime` shim silently returning unformatted input, a `DROP TABLE`
missing `CASCADE`, and TLS forced even on loopback (which made a same-box Postgres
unreachable). **Keep that property**: anything new that assumes SQLite — a rate-limiter
table, a `PRAGMA`, a new `strftime` format without a matching `WHEN` in `_PG_SHIMS` —
breaks it again.

---

## Coding Conventions

### Backend (Python)

- All SQL goes in `data/repositories/`. Routers never call `execute()` directly.
- Services have no DB I/O — they call repositories and contain business logic only.
- Money arithmetic: `int(round(value * 100))` for euros→cents input.
- Audit service calls are best-effort: wrap in try/except where they'd block the main flow.
- `audit_service` should be called in routers after a successful mutation, not inside services.
- Use `deps.require("perm")` — never hardcode role strings in router bodies.

### Frontend (TypeScript / React)

- **Routing:** add a route to `App.tsx` and a component under `pages/`. There is no
  file-system routing any more — a file in `pages/` that nothing references in
  `App.tsx` is simply dead code. Navigate with `useNavigate()` / `<Link to>` from
  `react-router-dom`; never `next/*`, and never `location.assign` for an in-app move
  (it throws away the SPA and reloads everything).
- **Route paths are the public contract.** `lib/nav.ts#routeFor` and every saved
  invoice link depend on them. Changing one is a breaking change, not a rename.
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

- **Frontend migrated off Next.js to Vite + React Router.** The app was already a
  client-side SPA wearing a Next shell — 50 of 61 files were `"use client"`, there
  were no API routes, no server actions, no ISR, and exactly one real server
  component (`app/layout.tsx`, which rendered `<html>` and a theme script). The
  payoff is in production: Nginx serves `frontend/dist` directly, so
  `balkan-fleet-web.service` and the Node runtime are both gone — **one systemd
  unit instead of two.**
  - **Structure.** `app/` became `pages/` (one file per route) plus `App.tsx` (the
    route table), `main.tsx`, `index.html` and `ErrorBoundary.tsx` at the frontend
    root; `app/globals.css` → `styles/globals.css`. `components/` and `lib/` did not
    move, so the `@/*` alias and ~47 files of imports are untouched. **URL paths are
    unchanged**, including `/invoices/:dealId` — every saved invoice link still works.
  - **`(app)` became a pathless layout route.** Same nesting, same auth gate, no URL
    segment — exactly what the parentheses meant. `error.tsx`/`global-error.tsx`
    became one `ErrorBoundary` class component wrapped around each route element.
  - **Dev is now same-origin too.** `vite.config.ts` proxies `/api` to
    `127.0.0.1:8001`, and `apiBase()` treats *unset* as same-origin rather than
    guessing `127.0.0.1:8001`. That removes a real trap: a page on `localhost:3000`
    calling `127.0.0.1:8001` is cross-site for cookie purposes, so `SameSite=Strict`
    dropped the session and you got a clean login followed by 401s. No `.env.local`
    is needed at all now.
  - **The theme-boot script moved into `index.html`**, where it runs while the head
    is parsed — earlier than Next could inject it, so the dark-mode flash is gone.
  - **Nginx now needs `try_files $uri $uri/ /index.html;`.** Verified the hard way:
    a plain static server returns **404** for `/finance` and `/invoices/<id>` while
    returning 200 for `/`. Clicking through to a page hides this; reloading exposes it.
    `/assets/` is marked `immutable` (filenames are content-hashed) and `index.html`
    `no-cache`, so a deploy needs no cache purge.


- **Display currency (EUR / Albanian Lek) now works app-wide.** The setting was
  display-only and half-wired; four defects fixed, and Lek now shows on every
  money surface instead of just Fleet/Customers/invoices.
  - **One formatter per side, used everywhere.** Backend
    `ui/components.format_invoice_money` → **`format_money_display`** (it is no
    longer invoice-only); the finance and customer report builders were calling
    bare `format_eur` and now go through it. Frontend gained **`useMoney()`** in
    `lib/currency.tsx` — the twin of that function — and all ~50 `formatEur`
    call sites across 9 files moved onto it (Finance, Dashboard, Reservations,
    BookingDialog, Timeline, VisitorHome, settings' LicenseTab). `formatEur` /
    `format_eur` stay as the raw EUR primitive underneath. **Rule: new money UI
    calls `useMoney()` / `format_money_display`, never `formatEur` directly.**
    Chart *tooltips* are currency-aware (`useChartTooltipFmt`); axis ticks stay
    bare numbers, since a dual-currency string does not fit them.
  - **The `ui/` package is now API-safe by construction.** What survives is
    `components.py`, `invoice.py`, `invoice_links.py`, `pdf.py`, `photos.py`,
    `theme.py` — each either free of streamlit or importing it *lazily inside a
    function*, which is what lets FastAPI use them. **Keep that property:** a
    module-level `import streamlit` in `ui/` puts the module out of the API's
    reach. One live exception remains: `ui/pdf.build_license_invoice_pdf` calls
    the session-based `t()` (not `t_lang()`), so it still needs streamlit at
    call time and nothing reachable invokes it — pre-existing, and it is the
    last EUR-only money path if software-license invoices are ever ported.
  - **The switch applies without a page reload.** `CurrencyProvider` fetched
    once on mount and had no way to refetch, so after saving in Settings the
    whole app kept formatting money the old way until a hard refresh. The
    context now exposes `refresh()`, awaited by the Settings save.
  - **PDF invoice columns are currency-aware** (`ui/pdf.py`). fpdf does not clip
    an over-wide `cell` — it bleeds the text left over the neighbouring column.
    `"€1,200 (110,400 L)"` is 33.9mm at 10pt DejaVuSans against a 33mm amount
    column, and the 13pt bold grand total needed 57mm against 55mm. Line items
    are now `76/16/44/44` under ALL (`90/25/32/33` under EUR) and the totals
    block `75·55/65` (`85·55/55`); both keep the 180mm row and the 195mm right
    edge. Verified by measuring every amount from €0 to €50,000 in both modes.
  - **A bad exchange rate is rejected, not silently swallowed.**
    `set_eur_all_rate()` substitutes the default for anything ≤0, so the old
    endpoint answered 200 while the stored rate reverted to 92 — and the
    Settings input posted `0` for a cleared box. `PUT /api/settings/business/currency`
    now 400s `invalid_exchange_rate` (new tr/en/sq key) on 0/negative/NaN/absurd
    values before writing anything; the input posts `NaN` rather than `0` and
    Save is disabled while the rate is unusable.
  - Cosmetic: a zero amount renders `€0`, not `€0 (0 L)`, on both sides.
  - **Six dead Streamlit-era `ui/` modules deleted** in the same pass, once the
    currency sweep surfaced them: `auth_view.py`, `booking.py`,
    `license_invoice.py`, `nav.py`, `notifications.py`, `timeline.py` (1,215
    lines). All six `import streamlit` at *module level*, so they raise on
    import and no live code could ever have loaded them; `requirements.txt`
    deliberately excludes streamlit. Every dependency arrow ran dead -> live
    (`booking -> components/invoice`, `license_invoice -> components/pdf`,
    `nav -> auth_view/notifications`), never the reverse, so the cluster was
    closed. Each has a shipped Next.js replacement — these are MIGRATION_SPEC's
    `rewrite_frontend` list, and that migration is done. Recover from git if
    ever needed.

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

  The report modal's remaining hardcoded strings (`Select all`, `Columns to
  include`, `Sorted by`, etc. — 20 keys in all) now have tr/en/sq entries too,
  so the whole modal localizes instead of just the labels this session added.

- **Mobile + tablet responsiveness pass.** See "Responsive Tiers" above. Phone
  gets a thumb-zone bottom bar + burger sheet, tablet gets the icon rail, and
  desktop (≥1024px) is unchanged — verified by measuring `<main>` padding,
  sidebar width, bento columns, `.neo-panel` padding, `Modal` geometry and the
  Timeline label gutter at 1024/1280 against the pre-pass values. Zero horizontal
  overflow, zero sub-44px targets and zero sub-16px form fields on all six pages
  at 375px and 768px. Night-mode fix: inactive sidebar labels were a hardcoded
  `#3F3F46` (~1.3:1 on the dark surface); light mode keeps that literal value and
  `dark:text-muted` layers on top (6.06:1).

- **Removed — the desktop launcher and every LAN-hosting code path.** Deleted:
  `launcher/` (launcher.py, allow-firewall.bat), `start.bat`, `stop.bat`, the repo-root
  `index.html`, `render.yaml` (a contradictory split Vercel/Render blueprint that set
  `COOKIE_SAMESITE=none`) and the superseded `backend/api/.env.example`. The deployment
  target is the single VPS described under "Deployment Targets"; nothing clicks a button
  to start the app there, and systemd owns the processes.
  - **`CORS_ALLOW_LAN` and `settings.cors_origin_regex` no longer exist.** The regex
    admitted every RFC-1918 address with `allow_credentials=True`. Gone with it: the boot
    guard in `main.py`, the `allow_origin_regex=` argument on `CORSMiddleware`, and the
    regex branch in `middleware._origin_allowed` — the CSRF Origin check is now exact
    match against `cors_origin_list` + `app_base_url` and nothing else.
  - **`apiBase()` lost its loopback-follow branch.** It existed so one build could serve
    both `localhost` and a DHCP-assigned LAN IP by reading `window.location.hostname`.
    Three cases remain: `"same-origin"` → `""` (a relative fetch, which is production),
    an explicit remote base used verbatim, and the loopback dev default.
  - **`NEXT_DIST_DIR` is gone** from `next.config.mjs` — only the launcher ever set it.
  - **Four Postgres defects fixed, and the migration rehearsed** against a real
    Postgres 16: backup-restore desynced every sequence (new
    `admin_ops._resync_sequences()`), the `strftime` shim silently returned unformatted
    input, `_migrate_users()` dropped without `CASCADE`, and TLS was forced even on
    loopback — which made the recommended same-box Postgres unreachable
    (`get_engine()` now decides via `_is_local_pg_host()`). A 962-row restore and
    byte-identical finance figures on both engines; DOCUMENTATION.md §8.8 has the
    detail and the now-concrete `db.sqlite_busy` threshold. **SQLite still ships.**
  - **Docs corrected where they had drifted from the code**: README still described
    `start.bat`, `admin`/`admin`, Turso and Vercel; DOCUMENTATION.md §8's status header
    still read "Phases 0–3 shipped, 4–6 outstanding" while every item beneath it was
    already tagged `[x]`.
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
| Frontend | **Static Vite build served by Nginx at `/`** — same origin as the API, no Node process |
| Edge | **Nginx** — TLS, `limit_req`/`limit_conn`, `client_max_body_size` (L0) |

Same-origin is a security requirement, not a convenience: it removes CORS entirely and
is what makes the `HttpOnly` cookie migration possible (DOCUMENTATION.md → §8.5).

**`DEPLOY.md` targets this single-VPS same-origin setup** — no Vercel/Render/Turso, no
`admin`/`admin`. Config templates live at `.env.production.example` (backend),
`frontend/.env.production.example` (frontend — `VITE_API_BASE=same-origin`), and
`nginx/` (the Nginx config + the one systemd unit, for the API).

`apiBase()` treats an unset base as same-origin, so every API call is a plain relative
fetch that the proxy in front resolves — Vite's in dev, Nginx's in production. Nginx
serves `frontend/dist` from disk, which is why **`try_files $uri $uri/ /index.html;`
is load-bearing**: client-side routes are not files, so without it they 404 on reload.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
