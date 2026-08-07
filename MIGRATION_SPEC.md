# MIGRATION_SPEC.md

> **Balkan Car Rentals — Fleet Console v3.x → FastAPI + Next.js/Tailwind**
> Single source of truth for porting the Streamlit app to a FastAPI backend + Next.js frontend. Same persistent DB (Neon Postgres in prod / SQLite local), **zero data migration**, full behavioral fidelity.

---

## 0. Ground truth & terminology

- **DB reality:** Despite `CLAUDE.md` mentioning Turso/libSQL, the **actual** `core/db.py` binds to **Postgres via pg8000** (Neon) when `DATABASE_URL` is set, else a **local SQLite file**. This spec follows the code. The DB is unchanged by the port; the new backend reuses the same engine, schema, and migrations.
- **Money:** INTEGER **cents** end-to-end. Format only at the display edge.
- **Dates:** ISO-8601 text (`YYYY-MM-DDTHH:MM:SS`); cost/license periods `YYYY-MM-DD`.
- **Roles/levels:** `visitor 0 < employer 1 < admin 2 < super_admin 3`. `employer` id is labelled **Agent/Acente**.
- **i18n:** 453 keys × 3 langs (tr/en/sq). `sq` is staff-only (`STAFF_ONLY_LANGS`).
- **User object everywhere:** `{username, full_name, role}` (+ `email`, `lang` on the JWT/session).

---

## 1. Architecture overview

### 1.1 Backend (FastAPI)

```
backend/
  app/
    main.py            # FastAPI() + lifespan(init_db once) + CORS + routers
    deps.py            # get_current_user, require(perm), require_super_admin, scope checks
    security.py        # JWT issue/verify, password cookie/session helpers
    settings.py        # pydantic BaseSettings: DATABASE_URL, JWT_SECRET, COOKIE_*, CORS_ORIGINS
    routers/
      auth.py customers.py vehicles.py rentals.py finance.py
      settings_router.py invoices.py i18n.py meta.py notifications.py
      dashboard.py licenses.py activity.py data_admin.py photos.py
    serializers/       # money/date formatting helpers, notification/qr serializers
  # REUSED VERBATIM (imported, not rewritten):
  config/    core/    data/    services/    ui/    assets/fonts/
```

**Key principle:** the backend **imports the existing `config/`, `core/`, `data/repositories/`, `services/`, and the Streamlit-free parts of `ui/`** directly. FastAPI routers are thin: they (1) resolve the auth user, (2) call `can(user, perm)`, (3) call the existing repo/service function, (4) `audit_service.record(...)`, (5) serialize plain dicts to JSON. No SQL or business logic is rewritten.

**Two backend files need edits** (see §7):
- `core/db.py` — drop the `st.secrets` branch in `_remote_db_url()` (env-only `DATABASE_URL`); call `init_db()` once in FastAPI **lifespan**, not implicitly per Streamlit rerun; keep the single module-global engine. Fix the latent `_migrate_photos()` bug (raw `PRAGMA` is not dialect-aware — guard to SQLite-only or port to `information_schema` on Postgres).
- `config/i18n.py` — provide a **session-free** `t(key, lang)` / `t_lang(key, lang)` that does **not** read `st.session_state`. Keep the existing `TRANSLATIONS` registry import. The backend always passes `lang` explicitly.

**Auth model (precise):**
- **Login** (`POST /api/auth/login`): verify via `auth_service` (bcrypt). On success issue a **JWT access token** (claims: `sub=username`, `full_name`, `role`, `email`, `lang`) returned in body **and** set as an **HttpOnly, Secure, SameSite=Lax cookie** (`bcr_session`), replacing the Streamlit remember-me cookie + priming-reruns mechanism. TTL configurable (default 14 days = remember-me).
- **Session restore:** the Next.js app calls `GET /api/me` on load; a valid cookie returns the user. This replaces the bounded priming `st.rerun()` loop entirely — there is no cookie round-trip race in a normal HTTP request.
- **Sessions table:** the existing `sessions` table (stores SHA-256 of token) and `purge_expired_sessions()` may be reused to back server-side revocation, or dropped in favor of stateless JWT. **Recommended:** stateless JWT for access + reuse `sessions` only if "log out everywhere" is required. Keep `purge_expired_sessions()` in `init_db()` (idempotent, harmless).
- **Per-endpoint gating:** a FastAPI dependency `require(perm)` wraps `config.roles.can(user, perm)`. **Every privileged route re-enforces server-side** — the client gate is advisory.

### 1.2 Frontend (Next.js App Router + Tailwind)

```
frontend/
  app/
    layout.tsx                 # <ThemeProvider> injects CSS vars from /api/theme; fonts
    login/page.tsx
    (app)/
      layout.tsx               # Sidebar nav + account popover + notification bell; auth guard
      page.tsx                 # Home/Dashboard (staff) | redirect visitor → /browse
      browse/page.tsx          # visitor home
      reservations/page.tsx
      fleet/page.tsx
      customers/page.tsx
      finance/page.tsx
      settings/page.tsx        # tabbed
      invoices/[dealId]/page.tsx   # rental invoice viewer (?lang=)
  components/                  # Sidebar, Bell, BookingPanel, KpiTile, StatusBadge,
                               # Dialog, DataTable, Timeline, InvoiceViewer, ColorPicker...
  lib/
    api.ts                     # fetch wrapper (credentials:'include', JSON, error keys)
    money.ts                   # format_eur (exact divmod logic)
    dates.ts                   # fmt_date, fmt_invoice_no
    i18n.ts                    # loads /api/i18n/{lang}.json, t(key)
    theme.ts                   # tokens → CSS vars, night-mode merge, _is_dark_color
    perms.ts                   # can(user, perm) mirror for UI gating
  styles/globals.css           # :root tokens, @media(max-width:640px) stacking, print CSS
  public/locales/*.json        # optional static fallback; canonical source is /api/i18n
```

- **Theme** is a global `:root` CSS-variable set fetched from `/api/theme`. Night mode is a **client-only** toggle (localStorage/context) that merges the `_DARK` palette + contrast-lift math on top.
- **i18n** is served as JSON per language by `/api/i18n/{lang}.json`; the client `t(key)` looks up the loaded map. Documents (invoices) are rendered **server-side** in their explicit document language.
- **API client** always sends the auth cookie (`credentials: 'include'`); error responses carry an i18n **key** (e.g. `pw_mismatch`) the client translates.

### 1.3 DB

Unchanged. Same Neon Postgres (prod) / SQLite (local). `core/schema.sql` reused as-is (11 tables, 9 indexes, CHECK constraints). `_to_pg()` DDL rewrite + `_PG_SHIMS` (`datetime()`, `strftime()`) keep SQLite-authored SQL running on Postgres. `init_db()` runs once at startup in the exact order: `_run_schema → _migrate_users → _migrate_rentals → _migrate_add_columns → _migrate_photos → seed(if empty) → ensure_default_admin → purge_expired_sessions`.

### 1.4 Deploy

- **Backend:** Railway or Render. Env: `DATABASE_URL` (Neon, `?sslmode=...` stripped — TLS via `ssl_context`), `JWT_SECRET`, `CORS_ORIGINS`, SMTP keys live in `app_settings` (DB), not env. **Bundle `assets/fonts/DejaVuSans*.ttf`** in the image (PDF glyphs). `pool_pre_ping=True` for Neon idle-suspend.
- **Frontend:** Vercel. `NEXT_PUBLIC_API_BASE` → backend URL. CORS allow-list + `credentials` cookies require backend and frontend on agreed domains (SameSite=Lax or a shared parent domain / proxy).
- **First-run:** fresh DB self-seeds the fleet from `fleet_master.csv` and creates `admin/admin`. Preserve seed-on-empty (`_is_fleet_empty()`), so emptying the fleet re-seeds on restart.

---

## 2. Consolidated REST API contract

Conventions: all money fields are **integer cents**. All mutating routes call `audit_service.record(user, action, entity, entity_id, detail)` after success. Permission names map to min role level via `PERMISSION_MIN_LEVEL`. Error bodies: `{detail: "<i18n_key>"}` + appropriate HTTP status.

### 2.0 Auth & session model

| Method | Path | Request | Response | Permission | Source |
|---|---|---|---|---|---|
| POST | `/api/auth/login` | `{username, password, remember?}` | `{user, token}` + Set-Cookie `bcr_session` | public | `auth_service.authenticate` / hash verify |
| POST | `/api/auth/logout` | — | `{ok}` clears cookie | authenticated | (revoke session if stateful) |
| GET | `/api/me` | — (cookie) | `{username, full_name, role, email, lang, role_label, can:{...}}` | authenticated | user dict + `can()` + `ROLE_LABEL_KEY` |
| POST | `/api/auth/forgot-password` | `{username}` | `{ok, sent, recipient, new_password}` or `403 recover_admin_only` / `400 login_failed` | public; `auth.self_recover` restricts to admin+ | `auth.self_recover` |

> Session = HttpOnly cookie JWT. `/api/me` replaces Streamlit's cookie-priming reruns. Per-user `lang` lives in the token and is the default for `t()` server-side and the i18n bundle the client loads.

### 2.1 Router: vehicles / fleet / photos

| Method | Path | Request | Response | Permission | Source |
|---|---|---|---|---|---|
| GET | `/api/vehicles` | `?include_deleted=false&q=` | `[{vehicle_id,make_model,year,license_plate,color,mileage,status,base_daily_rate,notes}]` (9 cols, no photo) ordered by id | `view_fleet` (0) | `vrepo.list_vehicles` |
| GET | `/api/vehicles/archived` | — | same shape where `status='DELETED'` | `edit_fleet` OR `soft_delete_vehicle` (2) | `list_vehicles(True)` filtered |
| GET | `/api/vehicles/active` | — | `[{vehicle_id,make_model}]` (picker) | `view_finance`/auth | `list_vehicles()` |
| GET | `/api/vehicles/counts` | — | `{total,available,rented,garage}` (nulls→0; garage = In Garage+Maintenance) | `view_fleet` (0) | `vrepo.fleet_counts` |
| GET | `/api/vehicles/{id}` | — | full vehicles row or 404 | `service_vehicle` (1) | `vrepo.get_vehicle` |
| POST | `/api/vehicles` | json/multipart `{make_model*,year=2022(1970-2035),license_plate,color,mileage>=0,status∈{Available,Maintenance},base_daily_rate_euros,notes, photos[]?}` | `{vehicle_id}` (new C###) | `edit_fleet` (2) | `add_vehicle` + `vphotos.add_photos` + audit `add_vehicle` |
| PUT | `/api/vehicles/{id}` | `{make_model*,year,license_plate,color,mileage,status,base_daily_rate_euros,notes}` (no photo) | `{ok}` | `service_vehicle` (1) | `update_vehicle` (photo omitted); audit `edit_vehicle`. **Lock:** if `vehicle_has_active_rental`, status forced to current |
| POST | `/api/vehicles/{id}/status` | `{status}` (`In Garage`→needs `edit_fleet`; `Maintenance`/`Available`→`service_vehicle`) | `{ok}` | see request; **blocked if active rental** | `set_status`; audit `set_status` detail=status |
| POST | `/api/vehicles/{id}/archive` | `{confirm:true}` | `{ok}` | `soft_delete_vehicle` (2) | `soft_delete`; audit `archive_vehicle` |
| DELETE | `/api/vehicles/{id}` | `{confirm:true}` | `{ok}` | `hard_delete_vehicle` (3) | `hard_delete`; audit `delete_vehicle` (orphan photos left — preserved) |
| POST | `/api/vehicles/{id}/restore` | — | `{ok}` | `edit_fleet` OR `soft_delete_vehicle` (2) | `restore_vehicle`; audit `restore_vehicle` |
| GET | `/api/vehicles/{id}/thumb` | `?v=version` | image/jpeg bytes or 204 | `view_fleet` (0) | `vphotos.primary_photo`; ETag/cache on `photos_version` |
| GET | `/api/vehicles/{id}/photos` | — | `[{photo_id,photo(b64),position}]` | `service_vehicle` (1) | `vphotos.list_photos` |
| GET | `/api/vehicles/{id}/photos/count` | — | `{count}` | `service_vehicle` (1) | `vphotos.photo_count` |
| GET | `/api/vehicles/{id}/photos/version` | — | `{version}` (MAX(photo_id)) | `view_fleet` (0) | `vphotos.photos_version` |
| POST | `/api/vehicles/{id}/photos` | multipart `files[]` (png/jpg/jpeg/webp) | `{ok, added:n}` | `service_vehicle` (1) | `encode_many`+`add_photos`; audit `add_photos` |
| DELETE | `/api/vehicles/photos/{photo_id}` | — | `{ok}` | `service_vehicle` (1) | `vphotos.delete_photo`; audit `delete_photo` |
| POST | `/api/seed/vehicles` | optional CSV | `{inserted_or_attempted:n}` | super_admin | `seed_vehicles_from_csv` (ON CONFLICT DO NOTHING) |

### 2.2 Router: customers
*(Customers subsystem inventory was not supplied separately; endpoints below are derived from the cross-references in finance/invoice/data inventories — implement against `data/repositories/customers.py`, `rentals.py`, and the customers card view.)*

| Method | Path | Request | Response | Permission | Source |
|---|---|---|---|---|---|
| GET | `/api/customers` | `?q=` | `[{customer_id,full_name,phone,rental_count,last_rental_date,registered_by,id_passport}]` | `view_customers`/`view_management` (1) | `custrepo.list_customers` |
| GET | `/api/customers/{id}` | — | customer row + rental history | `view_customers` (1) | `custrepo.get_customer` + rentals |
| PUT | `/api/customers/{id}` | `{full_name,phone,id_passport,...}` (ALL CAPS-normalized) | `{ok}` | `edit_customer` (1) | `custrepo.update_customer`; audit |
| PUT | `/api/rentals/{deal_id}/reassign` | `{username}` (registered-by) | `{ok}` | admin+ (2) | `rrepo.reassign_created_by`; audit |
| GET | `/api/customers/{id}/rentals` | — | rental-history rows (per-row invoice langs) | `view_customers` (1) | `rrepo.list_for_customer` |

### 2.3 Router: rentals / booking
*(Booking/scheduling inventory referenced cross-subsystem; implement against `services/scheduling_service.py` + `data/repositories/rentals.py`.)*

| Method | Path | Request | Response | Permission | Source |
|---|---|---|---|---|---|
| GET | `/api/rentals/active` | — | `list_active_rentals_with_vehicle()` | `view_management` (1) | `rrepo` |
| GET | `/api/rentals/all` | — | `list_all_rentals_with_vehicle()` (active+closed, for timeline) | `view_management` (1) | `rrepo` |
| GET | `/api/rentals/{deal_id}` | — | `get_rental_full` | `view_management`/`view_customers` (1) | `rrepo.get_rental_full` |
| POST | `/api/rentals/availability` | `{vehicle_id,start,end}` | `{free:bool}` | `create_reservation` (1) | `scheduling_service.is_vehicle_free` |
| POST | `/api/rentals` | `{personal fields (ALL CAPS), vehicle_id, start_date, start_time, days, return_time, daily_rate_cents, deposit_cents, invoice_lang}` | `{deal_id}` | `create_reservation` (1) | re-check `is_vehicle_free` → `create_rental`; audit |
| POST | `/api/rentals/{deal_id}/close` | — | `{ok}` | `create_reservation` (1) | `rrepo.close_rental`; audit |
| POST | `/api/rentals/{deal_id}/cancel` | — | `{ok}` | admin+ | `rrepo.cancel_rental`; audit `cancel_rental` |

### 2.4 Router: finance / costs

| Method | Path | Request | Response | Permission | Source |
|---|---|---|---|---|---|
| GET | `/api/finance/summary` | — | `{income,cost,net,margin}` (margin=net/income*100, 0 if income==0) | `view_finance` (2) | `finance_service.pnl_summary` |
| GET | `/api/finance/has-data` | — | `{has_income,has_costs}` | `view_finance` | `pnl_summary`+`cost_total` |
| GET | `/api/finance/revenue-summary` | — | `{rental,penalty,damage,total}` | `view_finance` | `revenue_summary` |
| GET | `/api/finance/cost-by-type` | — | `[{type,amount}]` DESC | `view_finance` | `cost_by_type` |
| GET | `/api/finance/pnl/monthly` | — | `[{period:'YYYY-MM',income,cost,net}]` asc | `view_finance` | `pnl_by_month` |
| GET | `/api/finance/pnl/yearly` | — | `[{period:'YYYY',income,cost,net}]` asc | `view_finance` | `pnl_by_year` |
| GET | `/api/finance/month-breakdown/{month}` | path `YYYY-MM` | `{month,income,cost,net,income_by_type[],cost_by_type[]}` | `view_finance` | `month_breakdown` |
| GET | `/api/finance/profit-by-vehicle` | — | `[{vehicle_id,make_model,income,cost,net}]` net DESC (client enriches plate/year via `/api/vehicles?include_deleted=true`) | `view_finance` | `profit_by_vehicle` |
| GET | `/api/finance/revenue-by-customer` | — | `[{customer_id,full_name,phone,revenue,damage,penalty,rentals}]` revenue DESC, revenue>0 | `view_finance` | `revenue_by_customer` |
| GET | `/api/finance/costs` | `?limit=100` | `[{cost_id,vehicle_id,make_model,license_plate,year,type,amount,period_date,note}]` period_date DESC, cost_id DESC | `view_finance` | `vehicle_costs.list_costs` |
| GET | `/api/finance/cost-total` | — | `{total}` | `view_finance` | `cost_total` |
| POST | `/api/finance/costs` | `{vehicle_id,cost_type(coerced→other if invalid),amount_euros>0,period_date(<=lic.max_date),note}` | `201 {ok}`; reject amount<=0 `fields_required` | `view_finance` | `add_cost`; audit `add_cost`. **API enforces date cap** |
| DELETE | `/api/finance/costs/{cost_id}` | — | `204` | `view_finance` | `delete_cost`; audit |
| POST | `/api/finance/reset` | `{confirm:'RESET'}` (case-insens after strip().upper()) | `{charges,vehicle_costs}` | `edit_business_settings` (3) | `admin_ops.reset_finance`; audit |
| GET | `/api/finance/report/{slug}.csv` | `?period=` | text/csv utf-8-sig (meta + blank + header + rows + optional TOTAL) | `view_finance` | CSV writer (server) |
| GET | `/api/finance/report/{slug}.pdf` | `?period=` | application/pdf | `view_finance` | `ui.pdf.build_report_pdf` (day-granular cache) |

slugs: `summary, cost_breakdown, monthly, yearly, by_vehicle, by_customer, recent_costs, month_<ym>`.

### 2.5 Router: settings — profile / users / business / theme / license / smtp / data

**Profile (self):**
| Method | Path | Request | Response | Perm |
|---|---|---|---|---|
| GET | `/api/profile` | — | `{username,full_name,email,role}` | self |
| PUT | `/api/profile/full-name` | `{full_name}` | `{ok}` | self |
| PUT | `/api/profile/email` | `{email}` | `{ok}` | self |
| PUT | `/api/profile/password` | `{current_password,new_password,confirm_password}` | `{ok}`/400 `pw_mismatch`\|`wrong_current`\|`password_too_short` | self |
| GET | `/api/profile/languages` | — | `{options:[{code,label}],current}` (sq only if level≥1) | self |
| PUT | `/api/profile/language` | `{lang}` (validated ∈ LANGUAGES) | `{ok}` | self |

> **Scope note:** `auth.set_user_email/set_user_full_name/set_user_lang` do **no** internal scope check (Streamlit gated them). Profile endpoints act on **self**; admin endpoints below enforce scope explicitly.

**Users (manage_users, admin+):**
| Method | Path | Request | Response | Notes |
|---|---|---|---|---|
| GET | `/api/users` | — | `[{username,full_name,email,role,is_active, is_me,in_scope,locked,can_act}]` filtered `ROLE_LEVEL<=viewer` | masking + scope computed server-side |
| GET | `/api/users/assignable-roles` | — | `[...]` per `assignable_roles(actor)` | |
| POST | `/api/users` | `{username*,password*,full_name,role,email}` | `{ok}`/400 `fields_required`\|`role_not_allowed`\|`password_too_short`\|`user_exists` | role ∈ assignable |
| PUT | `/api/users/{username}/role` | `{role}` | `{ok}`/400 `role_not_allowed`\|`last_super_admin` | last-super-admin guard |
| PUT | `/api/users/{username}/active` | `{active}` | `{ok}`/400 `last_super_admin` | |
| DELETE | `/api/users/{username}` | — | `{ok}`/400 `cannot_delete_self`\|`role_not_allowed`\|`last_super_admin` | |
| PUT | `/api/users/{username}/username` | `{new_username}` | `{ok}`/400 `fields_required`\|`user_exists` | |
| PUT | `/api/users/{username}/email` | `{email}` | `{ok}` | enforce scope at endpoint |
| POST | `/api/users/{username}/reset-password` | — | `{ok,sent,recipient,new_password}` | delivers to **acting admin** email; `sent=false`→show on screen |

**Business / branding (read admin+, name/iban/pay-qr edit super_admin):**
| Method | Path | Request | Response | Perm |
|---|---|---|---|---|
| GET | `/api/settings/business` (alias `/api/business`) | — | `{business_name,has_logo,has_stamp,phone,address,maps_url,email,iban,pay_qr_enabled}` | admin+ read |
| PUT | `/api/settings/business/name` | `{name}` (blank→APP_NAME) | `{business_name}` | super_admin |
| PUT | `/api/settings/business/contact` | `{phone,email,address,maps_url, pay_qr_enabled?, iban?}` | `{ok}` | contact admin+; **pay_qr+iban persisted only if super_admin** |
| PUT | `/api/settings/business/pay-qr` | `{iban?, pay_qr_enabled?}` | `{iban,pay_qr_enabled}` | super_admin |
| POST | `/api/settings/logo` | multipart image | `{has_logo:true}` | admin+ (`encode_logo` fit 280×100 PNG) |
| DELETE | `/api/settings/logo` | — | `{has_logo:false}` | admin+ |
| GET | `/api/settings/logo.png` | — | image/png or 404 | authed |
| POST | `/api/settings/stamp` | multipart image | `{has_stamp:true}` | admin+ (`encode_stamp` fit 260×180) |
| DELETE | `/api/settings/stamp` | — | `{has_stamp:false}` | admin+ |
| GET | `/api/settings/stamp.png` | — | image/png or 404 | admin+ |

**Theme:**
| Method | Path | Request | Response | Perm |
|---|---|---|---|---|
| GET | `/api/theme` | `?dark=bool` | `{tokens:{bg,surface,text,muted,border,accent,accent_hover,ok,info,warn,danger,archived}, font, defaults:{...}, font_list:[THEME_FONTS]}` | public/authed |
| GET | `/api/business/theme` | — | `{font,primary,secondary,success,warning,alert,disabled,bg, fonts:[...]}` | super_admin (editor) |
| PUT | `/api/settings/theme` | `{font?,primary?,secondary?,success?,warning?,alert?,disabled?,bg?}` (empty=default) | `{ok,theme}` | super_admin |
| POST/DELETE | `/api/settings/theme/reset` | — | `{ok,theme}` | super_admin |

**License + SMTP (super_admin):**
| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/license/status` | — | `{licensed_year,current_year,year_options:[cy..cy+10]}` |
| PUT | `/api/license/year` | `{year}` | `{ok}` (`set_licensed_year`) |
| GET | `/api/licenses` | — | `[{license_id,licensee,year,years,amount,purchase_date,notes,created_at}]` year DESC, id DESC |
| GET | `/api/licenses/{id}` | — | record or 404 |
| POST | `/api/licenses` | `{licensee,year(2020-2100),years(1-10),amount_eur,purchase_date,notes}` | `{ok,license_id}` (amount×100, then `extend_licensed_year(year+years-1)`) |
| PUT | `/api/licenses/{id}` | same | `{ok}` (extend-only cap) |
| DELETE | `/api/licenses/{id}` | — | `{ok}` |
| GET | `/api/smtp` | — | `{smtp_host,smtp_port,smtp_user,smtp_pass,smtp_from,is_configured,fallback_email}` |
| PUT | `/api/smtp` | `{host,port,user,password,sender}` | `{ok}` (sender defaults FALLBACK_EMAIL) |

**Data / danger zone (super_admin):**
| Method | Path | Request | Response |
|---|---|---|---|
| GET | `/api/data/finance-records` | — | `{income:[...200],expenses:[...200]}` |
| DELETE | `/api/data/charges/{charge_id}` | — | `{ok}` |
| DELETE | `/api/data/costs/{cost_id}` | — | `{ok}` |
| GET | `/api/data/clients` | — | `[{customer_id,full_name,phone,rental_count,id_passport}]` |
| DELETE | `/api/data/clients/{customer_id}` | `{confirm}` | `{ok,counts}` (cascade, frees Rented) |
| POST | `/api/data/reset/finance` | `{confirm:'RESET'}` | `{ok,counts}` |
| POST | `/api/data/reset/clients` | `{confirm:'RESET'}` | `{ok,counts}` |
| POST | `/api/data/reset/fleet` | `{confirm:'RESET'}` | `{ok,counts}` (+ photo cache invalidate; re-seeds on restart) |

**Settings meta:**
| GET | `/api/settings/meta` | — | `{tabs:[...]}` filtered by `can()` |

### 2.6 Router: invoices (rental + license)

| Method | Path | Request | Response | Perm |
|---|---|---|---|---|
| GET | `/api/rentals/{deal_id}/invoice` | — | `{deal,charges,subtotal_cents,deposit_cents,balance_due_cents,days,daily_rate_cents,inv_no,languages:LANGUAGES,default_lang,has_logo,has_stamp,qrs:[{key,label,caption,payload}],link_buttons:[{label,href}]}` | staff/`view_customers` |
| GET | `/api/rentals/{deal_id}/invoice.html` | `?lang=` (∈ langs, invalid→tr; default=invoice_lang) | text/html standalone doc (two A4 copies, inline print button + base64 logo/QR data-URIs) | same |
| GET | `/api/rentals/{deal_id}/invoice.pdf` | `?lang=` | application/pdf; `Content-Disposition: attachment; filename=invoice_{deal_id}_{lang}.pdf` | same |
| GET | `/api/rentals/{deal_id}/invoice/qr/{key}.png` | `key∈{contact,pay}` `?scale=5&lang=` | image/png or 404 (key absent) | same |
| GET | `/api/licenses/{id}/invoice.html` | `?lang=` | text/html | super_admin |
| GET | `/api/licenses/{id}/invoice.pdf` | `?lang=` | application/pdf; `license_invoice_{invoice_no}.pdf` | super_admin |

### 2.7 Router: i18n / meta / nav / dashboard / notifications

| Method | Path | Request | Response | Perm |
|---|---|---|---|---|
| GET | `/api/i18n/{lang}.json` | — | `{ <453 keys>: "<string>" }` for lang | public |
| GET | `/api/i18n/terms/{lang}` | — | `{title, rules:[...13]}` (RENTAL_TERMS) | public |
| GET | `/api/nav` | — | `[{key,label_key,label,icon}]` gated (finance→view_finance; reservations/fleet/customers→view_management; dashboard+settings always) | authed |
| GET | `/api/business/name` | — | `{business_name,initial,tagline,version}` | public |
| GET | `/api/dashboard` | — | `{title:{full_name,role_label},counts,active_rentals,all_rentals,fleet}` | `create_reservation` |
| GET | `/api/dashboard/available` | — | fleet rows where `status=='Available'` | authed (staff Rent gated) |
| GET | `/api/dashboard/fleet-table` | `?q=` | `[{id,model,year,plate,color,status,rate}]` + count | `create_reservation` |
| GET | `/api/visitor-home` | — | `{business_name,hero_title,hero_sub,available:[...]}` | visitor |
| GET | `/api/notifications` | — | `{badge,badge_label,overdue:[...],due_soon:[...],license:{...}\|null,due_soon_hours:24}` | `create_reservation`; license block only super_admin+`renewal_due` |

### 2.8 Activity (audit) — admin+

| Method | Path | Response |
|---|---|---|
| GET | `/api/activity` | `[{id,ts,username(masked),action,entity,entity_id,detail}]` + action-options + user-options (masked) |
| GET | `/api/activity/returnable` | `[{kind,entity_id,audit_id,label}]` (DELETED vehicle / Closed rental) |
| POST | `/api/activity/return/vehicle/{vehicle_id}` | `{ok}` (`restore_vehicle`) |
| POST | `/api/activity/return/rental/{deal_id}` | `{ok}` / `409 not_available_window` (`reactivate_rental`) |

### 2.9 Internal

| Method | Path | Response |
|---|---|---|
| POST | `/internal/init-db` | `{ok,dialect,seeded}` (startup hook; HTTP-expose only to super_admin) |
| GET | `/internal/db-health` | `{dialect,is_remote,ok}` (`SELECT 1`) |

**Conflict resolution notes:** `/api/settings/theme` (PUT) and `/api/business/theme` (GET) are the same store — keep both paths but back them by `app_settings.get_theme/set_theme/reset_theme`. `/api/business` and `/api/settings/business` are aliases — pick `/api/settings/business` canonical, keep `/api/business` for the Settings page if desired. Logo/stamp upload exists in both fleet-photos and settings inventories — canonical under `/api/settings/logo|stamp`.

---

## 3. Frontend page/component blueprint

### 3.1 Shared shell

**Sidebar (`components/Sidebar`)** — always visible, two states via `navExpanded`:
- Expanded 236px (white `#FFFFFF`, 1px right border `--border`, rounded hover pills). Collapsed 62px bare icon rail (transparent, icons only). Mobile (≤640px) always collapsed rail.
- Top: collapse toggle (icon `menu_open`/`menu`). Brand row (expanded only): 30×30 rounded-9px near-black square with business **initial** (first letter upper, fallback 'B') in white + brand name (ellipsis, .8rem 700) + tagline 'FLEET CONSOLE' (.55rem, letter-spacing .14em, muted).
- Section rows order: Home(`home`), Reservations(`calendar_month`), Fleet(`directions_car`), Customers(`group`), Finance(`payments`), Settings(`settings`). Each = icon + label, rounded-999px pill, .78rem/500, idle `#3F3F46`. Active = soft grey pill `rgba(17,24,39,.07)`, `--text`, 600. Hover `rgba(17,24,39,.05)`. **Settings lives inside the account popover, not a section row.** Collapsed: labels `font-size:0`, icons 1.15rem centered, no fills (state = ink color).
- Gating: finance hidden unless `view_finance`; reservations/fleet/customers hidden unless `view_management`; dashboard+settings always. Invalid page → dashboard.
- Footer: notification bell (staff) + account popover.

**Account popover** — trigger `account_circle` + name (icon-only collapsed). Panel: name card (.9rem 700) + role label (.72rem muted) + hairline; items Settings(`settings`) and Logout(`logout`). min-width 184px.

**Notification bell (`components/Bell`)** — staff only (`create_reservation`). Label `notifications` + 'Reminders'. **Primary (red-tinted: bg `rgba(220,38,38,.12)`, `--danger`) when (overdue OR license_due)** — a **due_soon-only state stays secondary** even though the badge shows. Real red circular badge top-right, min-width 18px, `--danger`, white 11px/700, 2px white ring; `'9+'` if n>9 else str; rendered only when n>0. Click → modal:
- Title 'Reminders'. Empty → success 'No reminders right now.'
- License block (top, if due): 'License Renewal' (`workspace_premium`) + card with `notif_license_msg` formatted `{date=dd.mm.yyyy, days}`.
- Overdue section 'Overdue returns (n)' (`error`); Due-soon 'Returns due within 24 h (n)' (`schedule`).
- Each row: icon + bold `client_name — vehicle_id · make_model`; caption `Period: → <end dd.mm hh:mm> · <when>` where when = `{h:.0f} h overdue` / `in {h:.0f} h`; copy-phone field (`phone_copy_hint`); if phone has digits → WhatsApp link (`chat`, prefilled `wa_reminder`) + Call link (`call`, wa.me **no text**).

**Night-mode toggle** — top of Home, every user, right-aligned (cols [8,1]). Icon-only `dark_mode`/`light_mode`; tooltip `night_mode`/`day_mode`. Flips client `darkMode` (localStorage), re-derives CSS vars. **Per-session, not persisted.**

**KpiTile** — card `.kpi` (surface, 1px border, radius 14px, min-height 94px, padding 13/15/15). Head: uppercase label (.72rem/600, ls .06em, muted) + optional 30×30 rounded-9px icon chip. Value: `--font-display` 700 2rem, tabular-nums. accent → value `--accent`, chip `rgba(17,24,39,.10)`. Mobile 1.6rem + margin-bottom 18px.

**StatusBadge** — pill `.badge` with token class `ok/info/warn/danger/archived` from `STATUS_TOKEN`; label translated for known statuses else raw; leading dot currentColor; bg color-mix 12–18%.

**Dialog** — real stacked modals (no single-dialog constraint). Each preserves confirm-then-act flows; ESC/✕ closes; on success refetch + close.

### 3.2 Dashboard / Home (staff)

Night toggle → title `👤 <full_name> — <role label>` (`person`) + caption `dashboard_help` → **Timeline** section (`calendar_month` + `timeline_title`; info `timeline_empty` when no active rentals; renders occupancy timeline of all rentals) → **4 KPI tiles**: Total(`directions_car`), Available(`check_circle`, accent), Rented(`vpn_key`), Garage(`build`) → divider → **Available-now cards** → divider → **Booking panel** (`key_prefix='dash'`) → divider → **Fleet table** (search, no thumbnails).

**Available-now cards** — subheader 'Available Now (n)' (`directions_car`); `no_available_now` when empty. 3-up grid (1-up mobile). Each: thumbnail h140 (`object-fit:cover`, lazy `/thumb?v=`; placeholder `directions_car`), bold make_model + optional ` · year`, caption `directions_car <id> · <plate or —>`, bold `format_eur(rate) / day`. If `create_reservation`: full-width primary 'Rent' (`add`) → opens rental dialog.

**Fleet table (Home bottom)** — subheader 'Fleet' (`directions_car`) + search (`dash_search`). Columns: col_id, col_model, col_year, col_plate('—'), col_color('—'), col_status(translated), col_rate(format_eur). Caption `n col_count`. **No thumbnails.** Search = case-insensitive substring across all column values.

### 3.3 Visitor home (`/browse`)

Hero `.visitor-hero` gradient `#1A1C1E→#3F3F46`, white text, radius 18px: business name, `visitor_hero`, `visitor_hero_sub`. 'Available Now (n)'; `no_available_now` empty. 3-up cards: thumbnail h150, bold make_model + year, caption `pin <plate or —> · speed <mileage:,> km`, price `format_eur(rate)` in `--accent` 1.15rem/700 + ` /day` muted. Divider + info `contact_to_book` (`call`). **No KPIs/booking/Rent.**

### 3.4 Reservations

Render order: **active rental cards (TOP)** → quick rental registration → **timeline/calendar (BOTTOM)**. Does **not** early-return when no active rentals (booking + calendar still render). Active-rental highlight `.active-hl` = neumorphic soft-shadow rounded style, status color via inline `--hl`.

### 3.5 Fleet (`/fleet`)

Header: title (`directions_car` + nav_fleet). 3:1 row — left caption `fleet_help`; right (if `edit_fleet`) full-width primary 'Add Vehicle' (`add` + fleet_add). Below: search input (`fl_search`, placeholder=search). Caption `n col_count`.

**Card grid** 2-up desktop (1-up ≤640px). Each bordered card:
1. Thumbnail h150 (primary photo cover-cropped, radius 12, 1px border; placeholder `.car-ph` `directions_car`).
2. 2:1 row — left bold make_model + caption `<year or —> · <id>`; right price block: big display-font bold accent `format_eur(rate)` + tiny uppercase muted `/per_day`.
3. Status badge; **inline lock chip on same line** when active rental (`.lock-chip` `lock` glyph, tooltip `status_locked_rented`) so heights stay uniform.
4. caption `pin <plate or —> · palette <color or —> · speed <mileage:,> km`.
5. Action buttons (full-width, stacked, icon+text), conditional:
   - `service_vehicle` → Edit (`edit`, primary).
   - `edit_fleet` AND status≠'In Garage' → To-Garage (`garage`, secondary, disabled if rented).
   - status≠'Maintenance' → To-Maintenance (`build`, secondary, disabled if rented).
   - status∈{In Garage,Maintenance} → Make-Available (`check_circle`, secondary, disabled if rented).
   - `soft_delete_vehicle` → Delete-Archive (`delete`, primary, red).
   - No-rights → no buttons.
   - Status toggles call `/status` immediately (toast `status_updated`); Edit/Delete open modals.

**Add dialog** (large): caption `fleet_add_help`. Form (clear-on-submit): make_model* + year(1970-2035, def 2022); plate/color/mileage(min0 step100); rate(€, min0 def30 step5) + status select [Available,Maintenance]; notes textarea; file uploader (png/jpg/jpeg/webp, multiple). Submit `add_btn`. Empty make_model → `fields_required`; else create + attach photos + toast `added_ok → <vid>`.

**Edit dialog** (large): current thumbnail h120; if active rental → info `lock + status_locked_rented`. Fields prefilled; rate prefill `max(0,round(cents/100))`; status select over `_EDITABLE_STATUSES` (rented→disabled, current only). Submit `update_btn` → toast `updated_ok`. **Photo manager** below: toggle `image + manage_photos (n)` (lazy — gallery loads only when expanded); gallery 4-up, each render_photo h90 + small delete; uploader + 'add_photos' button → toast `photos_added`; empty → `no_photos`.

**Delete/Archive dialog** (large): `**id** · make_model year · plate`; confirm checkbox; Archive button (disabled until confirmed) → `soft_deleted_done`; if `hard_delete_vehicle`: primary Delete (disabled until confirmed) → `hard_deleted_done`.

**Archived/restore** — privileged + non-empty: divider + expander `folder_open + archived_list (n)`; each row 2:2:1 → `**id** make_model`, plate caption, Restore (`rst_<id>`) → `restored_ok`.

Empty fleet → info `no_cars`.

### 3.6 Customers (`/customers`)

Card view: searchable 3-up grid of compact cards (name, phone, rental count, last-rental date, registered-by). Page-level 'Open Full Table' → table modal. Each card 'Open' → per-customer modal: edit form (employer+), rental history, reassign Registered-By (admin+; identify rental by **customer full name** label). Rental history 'Print Invoice' column = one small flag button per language (Albanian flag staff-only) → **route to `/invoices/{deal_id}?lang=`** (no session-state workaround needed in React).

### 3.7 Finance (`/finance`)

Header `payments + finance_title` + `finance_help`; if !`view_finance` → `access_denied`, stop. Empty (income==0 AND cost_total==0) → info `no_finance_data` + **only Costs tab**.

Headline 4 KPIs: total_revenue(accent), total_cost, net_profit(accent iff net≥0), profit_margin(`<:.0f>%`). P&L summary report (4-row metric/amount table + CSV+PDF). Divider.

6 tabs: Overview(`insights`), Monthly(`calendar_month`), Yearly(`calendar_month`), By Vehicle(`directions_car`), By Customer(`group`), Costs(`receipt_long`).
- **Overview:** 3 KPIs rental/penalty/damage; cost-breakdown table (`cost_<type>` + € + TOTAL row) or `no_costs`; CSV/PDF.
- **Monthly/Yearly:** bar chart Income vs Cost (euros, x=period); table Period/Income/Cost/Net + TOTAL; CSV/PDF with range `first → last`; 3 KPI tiles below. Monthly adds **month drill-down**: select over months reversed, `_month_label` = localized month+year; 3 KPIs income(accent)/cost/net; two tables income-by-charge-type / cost-by-type.
- **By Vehicle:** donut (income share, innerRadius 70, only income>0, biggest first; legend/text color adapts to dark; h320); table ID/Model/Plate/Year/Income/Cost/Net (plate/year incl. archived, '—') + TOTAL.
- **By Customer:** table client_name/phone/rentals/income/damage/penalty + TOTAL; 3 KPIs revenue/damage/penalty.
- **Costs:** danger-red header; add-cost form (clear-on-submit): vehicle select (`C001 · Make Model`), cost_type select (7 types, `cost_<x>`), amount(€ min0 step10), date(def today, **max=lic.max_date()**), note; submit `add_cost_btn`; amount>0→insert+`cost_added` else `fields_required`. Recent costs: total_cost KPI + CSV/PDF + rows with per-row Delete; column widths `[1.5,2.0,1.3,0.9,1.6,1.4,2.0,1.4,0.9]`.

**Reset finance** (super_admin): expander `warning + reset_finance_btn`; input + primary button disabled until `strip().upper()=='RESET'` → reset + `reset_done`.

### 3.8 Settings (`/settings`)

Tabs (fixed order, gated via `/api/settings/meta`): Business(manage_users), Users(manage_users), License(edit_business_settings), Data(edit_business_settings), Language(always), Profile(always), Activity(manage_users).

- **Language:** horizontal radio of allowed codes (label=flag+endonym), default=current; Save → `lang_saved`. sq filtered for visitors.
- **Business:** Theme launcher (super_admin) → theme modal (font select over THEME_FONTS + 7 color pickers in 2-up rows: primary|secondary, success|warning, alert|disabled, bg full-width + Save/Reset). Business name form (super_admin). Logo: preview 120px + uploader form (saves only if file) + remove. Stamp: same pattern. Business contact+QR form: phone|email, address, maps_url (admin+); if super_admin: pay_qr checkbox + IBAN.
- **Users:** Create-user form (clear-on-submit): username*|full_name, password*|role select(`assignable_roles`, label `ROLE_LABEL_KEY`), email; `add_user_btn`. Users table: widths `[2.6,1.2,1.3,1.3,1.0,1.3]`, headers login_username/role/change_role/col_status/delete_btn/manage_account. Each row col0 `**username**` / full_name or '—' / `mail email or —`; col1 role label. Per-cell popovers (if `can_act`): Change Role (select + confirm), Status (toggle), Delete (confirm checkbox + disabled-until). Manage Account (if `in_scope`): rename form, email form, reset-password button (success→`recover_sent(to=recipient)` if sent else warning `recover_fallback`). **Last-super-admin:** caption `last_super_admin` + role/status/delete forced read-only.
- **License:** info `license_status` + year select(cy..+10) + Save. Records table widths `[1,1.4,2,1.4,1.6,2,2.6]`: year, period(`year` or `year–year+years-1`), licensee('—'), `format_eur(amount)`, purchase_date('—'), notes('—'), 3 actions (Edit/Delete/Print modals). Add form: licensee(def business_name), year(2020-2100)/years(1-10)/amount(€ step50), purchase_date(today)/notes → `license_added` + `extend_licensed_year`. **SMTP section** (inside this tab): status badge + form host/port(def587)/user/password/sender(def FALLBACK_EMAIL) → `business_saved`.
- **Data:** finance records (income+expense blocks with per-row Delete); client records (Delete popover w/ confirm, cascade); **danger zone** 3 columns Finance/Clients/Fleet, each input + button disabled unless `=='RESET'` → `reset_done` (Fleet also invalidates photo cache).
- **Profile** (all roles): full_name form → `profile_saved` (+update session); email form → `email_saved`; change-password form (current/new/confirm; client checks `new==confirm`→`pw_mismatch`) → `pw_changed`.
- **Activity:** Return Activity block (undoable archived vehicle / cancelled rental → Return button; rental may warn `not_available_window`). Filter radio action|user (multiselect of distinct actions / **masked** usernames). Table: col_when(ts[:19], T→space), col_user(masked), col_action, col_entity(`entity entity_id`), col_detail. **Actors strictly above viewer level masked as system_admin_label.**

### 3.9 Invoice viewer (`/invoices/[dealId]`)

Language selector = horizontal radio over all 6 LANGUAGES (flag+endonym), default = `invoice_lang` or 'tr'. Embedded preview: render `/invoice.html?lang=` in an `<iframe srcDoc>` (the doc is a full `<!DOCTYPE html>` with its own `<style>` + Google-Fonts import — isolation matters), showing **both stacked A4 copies**. Full-width Download → `/invoice.pdf?lang=` (`invoice_{deal_id}_{lang}.pdf`). Print button → `window.print()` (or print route). Changing language re-renders preview + PDF link.

**Document layout** (served by `build_invoice_html`, max-width 640px sub-A4): brand header (logo + business_name + tagline uppercased) | inv-title (heading, inv_no, date, **issued_by = employee NAME only, role hidden**). Two columns BILL TO / VEHICLE (+ period). Line-items table DESC/QTY/UNIT/AMOUNT. Totals: Subtotal, **`− Deposit` row only if deposit>0**, bold Total = balance_due. Signed/unsigned chip. Quick-links (≤2 QR cards 92×92 + WhatsApp/location pill buttons; omitted if none). Terms (numbered ol, 2-col). Signature section (customer line; authorized line with **seal = stamp or logo** above it). Footer. Two copies stacked, each `.copy-label` (Customer/Office), `page-break-after:always` (last auto).

### 3.10 Booking panel (`components/BookingPanel`, reused dashboard + reservations)

Two `st.columns`-equivalent layout (not single vertical flow):
- **Right column rendered first** (so `days`/picked car feed left total): start date, time, days, return; + available-car select (reservations dialog).
- **Left column:** full client form — personal info (name/phone/ID) in **ALL CAPS** (`text-transform:uppercase` on the input **and** `.upper()` on save → stored + invoice stay uppercase), then rate/deposit/invoice-language(all 6) + live total beneath.
- Date pickers cap at `lic.max_date()`. On save: re-check `is_vehicle_free` → `create_rental(..., invoice_lang)`. Then route to invoice viewer (`/invoices/{deal_id}`).

### 3.11 Responsive (≤640px)

`block-container` padding 0.8/0.6/2rem, max-width 100%. Every column row stacks (`flex-wrap`, children `flex 1 1 100%`). iframe/img max-width 100%. Tables overflow-x auto. Buttons `white-space:normal`, min-height 44px (WCAG). KPI columns margin-bottom 18px (no overlap). h1 1.5rem, page-title 1.25rem, kpi 1.6rem. Sidebar = collapsed rail.

---

## 4. Theme + i18n port

### 4.1 CSS variable tokens (defaults — carry verbatim into Tailwind `:root`)

| Var | Default | Role-mapping source |
|---|---|---|
| `--bg` | `#FAFAF9` | bg |
| `--surface` | `#F4F3F1` | surface |
| `--text` | `#1A1C1E` | text |
| `--muted` | `#6B7280` | muted |
| `--border` | `#EAE8E3` | border |
| `--accent` | `#1A1C1E` | primary |
| `--accent-hover` | `#3F3F46` | secondary |
| `--ok` | `#1A1C1E` | success |
| `--info` | `#52525B` | secondary/info |
| `--warn` | `#71717A` | warning |
| `--danger` | `#DC2626` | alert |
| `--archived` | `#9CA3AF` | disabled |
| `--font-display` / `--font-body` | chosen font | both = same font |

`THEME_DEFAULTS` (customizer): font='Plus Jakarta Sans', primary=`#1A1C1E`, secondary=`#3F3F46`, success=`#1A1C1E`, warning=`#71717A`, alert=`#DC2626`, disabled=`#9CA3AF`, bg=`#FAFAF9`.

**Merge order** (replicate `resolve_theme`): built-in TOKENS ← stored `theme_*` (empty = keep default) ← per-session `_DARK`. Mapping: `accent=primary, accent_hover=secondary, ok=success, info=secondary, warn=warning, danger=alert, archived=disabled, bg=bg`.

**Night palette `_DARK`** (client-only): bg=`#17181A`, surface=`#232427`, text=`#E8E6E3`, muted=`#A1A1AA`, border=`#34343A`. **Contrast lift** (verbatim math): `_is_dark_color` expands 3-digit hex, luminance `0.299R+0.587G+0.114B`, threshold `<110`. If stored primary dark → accent=`#E8E6E3`, accent_hover=`#FFFFFF`. For each of ok/info/warn/archived, if dark → lift to `#D4D4D8`.

**THEME_FONTS:** Plus Jakarta Sans, Inter, Poppins, Montserrat, Roboto, Open Sans, Nunito, Work Sans, DM Sans, Manrope, Rubik, Source Sans 3, Lora, Playfair Display. Google import: `family=<font, spaces→+>:wght@400;500;600;700&display=swap` (Plus Jakarta Sans also adds 800). Fallback stack: `'<font>', system-ui, -apple-system, 'Segoe UI', sans-serif`.

**STATUS_TOKEN** badge colors must be exposed to the frontend (Available/Rented/In Garage/Maintenance/DELETED → ok/info/warn/danger/archived). Polish details: h1-h6 forced font + ls -0.01em; buttons soft shadow + hover translateY(-1px); danger-key buttons red `#DC2626`/hover `#B91C1C`; calendar selected day **hollow** (transparent fill + 2px ink ring); focus rings 2px; motion gated by `prefers-reduced-motion`.

### 4.2 i18n export

- **Frontend strings:** `config/i18n.TRANSLATIONS` (453 keys × 3 langs; TR/EN inline, SQ from `config/lang_sq.py` `UI` dict) → serialized by `GET /api/i18n/{lang}.json`. Client `t(key)` looks up the loaded map for the user's `lang` (from JWT). `sq` filtered for visitors at the **selector** level, but the bundle itself can be served.
- **Documents (server-side):** invoices always render in their explicit document lang via the **session-free** `t_lang(key, lang)`. **License invoice uses UI `t()`** (not per-document lang) — keep this distinction.
- **RENTAL_TERMS:** `config/terms.rental_terms(lang)` → `{title, rules:[...13]}` served at `GET /api/i18n/terms/{lang}` and embedded server-side in invoice HTML/PDF. Terms language follows invoice lang, not UI lang.
- **Adding a language** remains: extend `LANGUAGES` + add `config/lang_<code>.py` (UI+TERMS). Keep key-set parity (453 × 6).

---

## 5. Critical business rules to preserve (master list)

1. **Money = INTEGER cents** end-to-end. Form euros → `int(x)*100`; edit prefill `max(0,round(cents/100))`. `format_eur`: `whole,rem=divmod(abs(cents),100)`; thousands sep; **drop decimals when rem==0** (`3000→€30`, `3050→€30.50`, `-3050→-€30.50`); sign prefix; `€0` for 0/None. **Never store floats.** `_to_cents` = strip €/$/commas → `int(round(float*100))`.
2. **Dates ISO-8601 text;** cost/license periods `YYYY-MM-DD`. `fmt_date` ISO→`23 June 2026` (month_name per lang); `fmt_invoice_no`: `RENT-202606-025`→display `RENT-2026-06-025` (stored id unchanged).
3. **IDs:** vehicles `C{max+1:03d}` via GLOB `C[0-9]*` + max (not COUNT — gaps skipped, never reused below max). Rentals `RENT-YYYYMM-NNN`. customers/charges/costs/users/audit/photos/licenses = INTEGER PK AUTOINCREMENT (SERIAL on PG). sessions PK = token_hash.
4. **Availability/return math:** `is_vehicle_free` gates booking; **re-check on save** before `create_rental`. `return_state(end_dt, now=datetime.now() naive, soon_hours=24)`: parse error→`('ok',0)`; hours<0→`('overdue', -hours)`; hours≤24→`('due_soon', hours)`; else `('ok',hours)`. Overdue sorted -hours; due_soon +hours. `DUE_SOON_HOURS=24`. **Keep server timezone consistent (naive local).**
5. **Deposit subtraction:** `billable = charges where type != 'deposit'`; `deposit = Σ type=='deposit' or deal.deposit`; `grand_total/subtotal = Σ billable or deal.total_amount`; **balance_due = grand_total − deposit**; `− Deposit` row only when deposit>0. Empty-charges fallback = one synthetic rental row.
6. **Revenue** counts only `rental/overdue_penalty/damage` (deposit/refund **excluded** everywhere). **Net = income − cost** (integer, can be negative). **Margin = net/income*100 if income else 0.0**, shown `:.0f%`.
7. **`_merge` period union:** `periods = sorted(set(income)|set(cost))`, missing side→0 (cost-only month still appears). Income groups on `charges.occurred_at`, cost on `vehicle_costs.period_date` (**different columns**). Uses `strftime('%Y-%m'/'%Y', col)` (PG shim provides these).
8. **Permission levels** `visitor0<employer1<admin2<super_admin3`; `can(user,perm)=level>=PERMISSION_MIN_LEVEL[perm]`; unknown perm→deny (level 99). Gate **every** privileged route server-side. `assignable_roles`: super_admin→[super_admin,admin,employer,visitor], admin→[employer,visitor], else none.
9. **Status vocabularies duplicated** in `schema.sql` CHECK + `config/settings.py` — change together. vehicles: Available/Rented/In Garage/Maintenance/DELETED (default Available). Manually settable = only Available/Maintenance; 'In Garage' via quick action (admin+); 'Rented' lifecycle-driven only. rentals: Active/Closed. charges: rental/overdue_penalty/damage/deposit/refund. vehicle_costs: 7 types (unknown→`other`). users.role: super_admin/admin/employer/visitor.
10. **Active-rental lock:** `vehicle_has_active_rental` → edit status select disabled+forced, all quick-status buttons disabled, `status_locked_rented` notice. Soft-delete=status DELETED; restore=Available; hard_delete physically removes row (**leaves orphan photos** — preserved).
11. **Audit every mutation:** `audit_service.record(user, action, entity, entity_id, detail)` after success; best-effort (swallows errors, never rolls back/500s).
12. **Last-super-admin guard:** `is_last_active_super_admin` — cannot demote/deactivate/delete the final active super_admin. **Recompute at action time** server-side (UI gate advisory).
13. **Licensing date cap:** `licensed_year()=max(stored, current_year)` (extend-only). `max_date()=Dec 31` caps booking/cost date pickers app-wide **and the cost API rejects** period_date beyond it (repo doesn't — validate in API). License purchase-date picker **not** capped. `extend_licensed_year(year+years-1)` on add+edit (extend-only; editing to earlier year does not lower).
14. **Photo encode:** `encode_photo` ImageOps.fit **crop** to `PHOTO_SIZE=(640,480)` JPEG q80; logo/stamp `_encode_fit` **fit not crop** (280×100 / 260×180 PNG). Errors swallowed → store raw bytes (never raise). Validate types png/jpg/jpeg/webp server-side. position appended at MAX+1; primary = ORDER BY position, photo_id. `photos_version=COALESCE(MAX(photo_id),0)`.
15. **QR rules:** contact vCard only if ≥1 of phone/email/address/maps_url; SEPA pay only if `pay_qr_enabled AND iban AND balance>0`; ≤2 QRs; IBAN stored compact (spaces stripped). segno error='m', scale 5.
16. **Seed gate** = `_is_fleet_empty()` (COUNT==0), ON CONFLICT DO NOTHING; €/$ header fallback; status coercion. Re-seeds whenever fleet emptied.
17. **Reset/delete:** child-first (FK-safe), frees Rented→Available; all require literal `'RESET'` (case-insens) **server-enforced** + super_admin.
18. **Invoice:** two A4 copies always; role hidden (name only); seal=stamp or logo above authorized line only; lang coerced to 'tr' if invalid; PDF bundled DejaVu font first (Turkish/Albanian glyphs) with ASCII-fold fallback.

---

## 6. Streamlit-isms → REST equivalents

| Streamlit pattern | REST/Next.js equivalent |
|---|---|
| Remember-me cookie + bounded priming `st.rerun()` loop + `time.sleep(0.6)` | HttpOnly JWT cookie; `GET /api/me` on app load restores session — no round-trip race, no priming. Login sets cookie then redirects. |
| `st.session_state.user` mutated after profile edits | Mutation endpoints return updated user; client refreshes auth context; re-issue JWT with new claims (full_name/email/lang). |
| `st.dialog` (one at a time, Save→`st.rerun()`) | Independent stacked modals; on mutation success → refetch affected queries + close. Preserve confirm-then-act + disabled-until-confirmed. |
| One-shot `session_state['cust_invoice']` + rerun dispatch | Plain client routing: `/invoices/{deal_id}?lang=`. |
| `@st.cache_data` photo thumbnail cache keyed on `photos_version` + `invalidate_cache()` | HTTP/browser caching: `/thumb?v=<version>` + ETag; client re-fetches when version changes; listings omit photo bytes (lazy). |
| `t()`/`t_lang()` reading `st.session_state['lang']` | Backend `t(key, lang)` session-free; client loads `/api/i18n/{lang}.json` (lang from JWT). Documents render in explicit doc lang. |
| `resolve_theme()` re-injecting CSS each rerun | Compute merged tokens once → bind to `:root` CSS vars; night mode merges client-side. |
| Notification badge as CSS `::after` hack | Real badge element; keep `'9+'` cap, render only when count>0, primary-red only when (overdue OR license_due). |
| `st.code(phone)` built-in copy | Copy-to-clipboard button + `phone_copy_hint`. |
| `st.download_button(pdf_bytes)` | `Response(content=bytes, media_type='application/pdf', Content-Disposition)`. |
| `init_db()` via implicit script rerun | FastAPI **lifespan** calls `init_db()` exactly once at startup (never per-request); single process-global engine. |
| `:material/<name>:` directives | Material Symbols Rounded icon set; map names verbatim (home, calendar_month, directions_car, group, payments, settings, notifications, error, schedule, workspace_premium, account_circle, logout, dark_mode, light_mode, add, check_circle, vpn_key, build, lock, garage, image, delete, edit, archive, folder_open). |
| Streamlit `clear_on_submit` | Reset React form state on success. |

---

## 7. Reuse map

### Reuse **as-is** (import directly into FastAPI — Streamlit-free)
- `core/schema.sql`, `data/seed/import_csv.py`
- `config/roles.py`, `config/settings.py`, `config/terms.py`
- `data/repositories/*`: `vehicles.py`, `vehicle_photos.py`, `vehicle_costs.py`, `charges.py`, `customers.py`, `rentals.py`, `users.py`, `licenses.py`, `audit.py`, `app_settings.py`, `admin_ops.py`
- `services/*`: `finance_service.py`, `scheduling_service.py`, `licensing_service.py`, `email_service.py`, `audit_service.py`
- `ui/invoice_links.py`, `ui/pdf.py` (return bytes; bundle `assets/fonts/*.ttf`)

### **adapt_minor**
- `services/auth_service.py` — reuse all functions, but **add self-vs-admin scope checks at the endpoints** (set_user_email/full_name/lang have no internal scope check).
- `ui/components.py` — extract `format_eur`/`fmt_date`/`fmt_invoice_no` into a **Streamlit-free** helper (pass `lang` explicitly, drop `st.session_state`); reimplement in TS for the client.
- `ui/photos.py` — extract pure encoders (`encode_photo/encode_logo/encode_stamp/encode_many/_encode_fit`, `PHOTO_SIZE/LOGO_MAX/STAMP_MAX/PHOTO_TYPES`) into a Streamlit-free module for server-side upload; drop the `@st.cache_data` thumbnail helpers.
- `config/settings.py` (DB_PATH, SEED_CSV) — ensure paths resolve relative to backend package root.

### **rewrite_frontend** (Streamlit UI → Next.js/Tailwind; reuse only orchestration logic)
- `views/fleet.py`, `views/finance.py`, `views/customers.py`, `views/reservations.py`, `views/dashboard.py`, `views/settings.py`
- `ui/theme.py` (port `resolve_theme`/tokens/`_DARK`/`_is_dark_color`/THEME_FONTS to a backend helper + TS), `ui/nav.py`, `ui/notifications.py`, `ui/booking.py`
- `ui/invoice.py` `build_invoice_html` + `ui/license_invoice.py` `build_license_invoice_html` → keep as **backend HTML generators**; `render_invoice`/`render_license_invoice` become Next.js viewers. Move `_license_invoice_payload` (currently in `views/settings.py`) into a service helper.

### Backend files needing edits (short list)
1. **`core/db.py`** — (a) `_remote_db_url()`: drop `import streamlit; st.secrets` branch, env-only `DATABASE_URL`; (b) call `init_db()` in FastAPI lifespan, not implicit rerun; (c) keep module-global single engine, pg8000, `ssl_context`, `pool_pre_ping=True`, SQLite pragma listener; (d) **fix `_migrate_photos()`** raw `PRAGMA` to be dialect-aware (SQLite-only guard or `information_schema` on PG) — latent bug.
2. **`config/i18n.py`** — add session-free `t(key, lang)` / keep `t_lang(key, lang)`; remove `st.session_state` reads (or wrap so the backend never touches Streamlit). Keep `TRANSLATIONS` registry.

---

## 8. Phased build order (checkable steps)

**Phase 0 — Backend skeleton & DB**
- [ ] Create `backend/` FastAPI app importing existing `config/core/data/services`.
- [ ] Edit `core/db.py`: env-only `DATABASE_URL`, lifespan `init_db()`, fix `_migrate_photos` dialect guard.
- [ ] Edit `config/i18n.py`: session-free `t(key, lang)`.
- [ ] `pydantic Settings` (DATABASE_URL, JWT_SECRET, COOKIE_*, CORS_ORIGINS).
- [ ] `GET /internal/db-health` returns `{dialect,is_remote,ok}`; confirm Postgres + SQLite both boot, fleet self-seeds, `admin/admin` exists.

**Phase 1 — Auth**
- [ ] `POST /api/auth/login` (bcrypt verify → JWT cookie), `POST /api/auth/logout`, `GET /api/me`, `POST /api/auth/forgot-password`.
- [ ] `deps.py`: `get_current_user`, `require(perm)`, scope helpers, last-super-admin recheck.
- [ ] Verify role-gating returns 401/403 with correct keys.

**Phase 2 — Read endpoints**
- [ ] vehicles (list/counts/archived/get/active), dashboard, visitor-home, nav, business/name, theme, i18n bundles, terms.
- [ ] finance read endpoints (summary/has-data/revenue/cost-by-type/pnl/breakdowns/profit/by-customer/costs/cost-total).
- [ ] customers list/get, rentals active/all/get.
- [ ] notifications (port `_classify/_wa_link/_digits` serializer; verify badge math + sort order + primary-red rule).

**Phase 3 — Mutations + media**
- [ ] vehicles create/update/status/archive/restore/hard-delete (lock + audit + id-gen verified).
- [ ] photos add/delete/list/count/version + `/thumb` (ETag on version) + encoders server-side.
- [ ] rentals availability + create (re-check `is_vehicle_free`, ALL-CAPS save) + close/cancel.
- [ ] finance costs add (date-cap rejection) / delete; finance reset (RESET literal).
- [ ] settings: profile, users (full CRUD + last-super guard), business contact/name/logo/stamp, theme, license CRUD + extend cap, smtp, data/danger-zone resets.
- [ ] activity (masking + returnable + return actions).

**Phase 4 — Documents**
- [ ] Invoice JSON + HTML + PDF + per-QR PNG; license HTML + PDF. Verify Turkish/Albanian glyphs (DejaVu bundled), two copies, deposit subtraction, seal precedence, role hidden.
- [ ] finance report CSV (utf-8-sig + meta + TOTAL) + PDF (day-granular cache).

**Phase 5 — Frontend shell & theme/i18n**
- [ ] Next.js App Router + Tailwind; `globals.css` tokens + responsive + print CSS.
- [ ] `lib/`: api client (credentials), money.ts (exact format), dates.ts, i18n.ts, theme.ts (merge + night-mode + contrast lift), perms.ts.
- [ ] Auth guard layout, login page, `/api/me` restore.
- [ ] Sidebar (two-state) + account popover + notification bell.

**Phase 6 — Pages**
- [ ] Dashboard (timeline, KPIs, available cards, booking panel, fleet table) + night toggle.
- [ ] Visitor `/browse`.
- [ ] Fleet grid + Add/Edit(+lazy photo manager)/Delete/Archive modals + restore.
- [ ] Customers card grid + per-customer modal + invoice flag routing.
- [ ] Reservations (active cards → booking → timeline).
- [ ] Finance tabs (charts: bar + donut, TOTAL rows, add-cost date cap, reset).
- [ ] Settings tabbed (all 7 tabs, popovers, disabled-until-confirm, masking).
- [ ] Invoice viewer (`<iframe srcDoc>` + lang radio + PDF download + print).

**Phase 7 — Booking panel & polish**
- [ ] BookingPanel two-column (right-first), ALL-CAPS inputs, live total, date cap, invoice route-on-create.
- [ ] Status badges, KPI tiles, dialogs, responsive ≤640px verification.
- [ ] Accessibility (contrast ≥4.5:1, 44px tap targets, focus rings, `prefers-reduced-motion`).

**Phase 8 — Deploy**
- [ ] Backend → Railway/Render (DATABASE_URL Neon, JWT_SECRET, CORS, bundled fonts, `init_db` on startup).
- [ ] Frontend → Vercel (`NEXT_PUBLIC_API_BASE`, cookie SameSite/domain).
- [ ] Smoke: fresh DB seeds + `admin/admin` login; create rental → invoice PDF; finance KPIs; theme + night mode; 6-language switch; last-super-admin guard; danger-zone RESET.

---

*End of MIGRATION_SPEC.md*