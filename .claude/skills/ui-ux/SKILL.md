---
name: ui-ux
description: Balkan Car Rentals — Fleet Console's UI/UX conventions — responsive breakpoints, navigation by device tier, shared components, i18n/money/toast rules, invoice/PDF visual rules. Load when touching frontend layout, responsiveness, or component styling.
---

# UI/UX Conventions — Fleet Console

## Responsive Tiers

Stock Tailwind breakpoints map to three device tiers (`tailwind.config.ts` needs no `screens` entry):

| Tier | Range | Prefix | Grid |
|---|---|---|---|
| Phone | `< 768px` | unprefixed | 4 columns |
| Tablet | `768–1023px` | `md:` | 8 columns |
| Desktop | `≥ 1024px` | `lg:` / `xl:` | 12 / the page's own grid — **frozen** |

**Desktop is frozen** — ≥1024px must render exactly as it did before the mobile pass. Two rules enforce that:

1. **Every `md:` class needs an explicit `lg:` counterpart.** Tailwind breakpoints are min-width, so a `md:` value written for tablet otherwise leaks upward and reshapes desktop.
   `grid-cols-2 md:grid-cols-4` → `grid-cols-4 md:grid-cols-8 lg:grid-cols-4`.
2. **Prefer `max-lg:` overrides to re-scoping desktop classes.** Leaving the desktop declaration a literal, unmodified string is safer, and it dodges the shorthand/longhand trap — `rounded-card` sets `border-radius` while `rounded-t-2xl` sets two longhands, so with both live at `lg` the winner depends on Tailwind's emit order, not intent. See `components/Modal.tsx`.

## The Mobile CSS Layer

`app/globals.css` ends with a `@media (max-width: 1023.98px)` block, a `@media (hover: none)` block, and the `.df-pop.is-narrow` rules. **They must stay last in the file** — a media query contributes no specificity, so rules declared further down (`.seg-btn`, `.cal-bar:hover`) would win the source-order tie.

Two specificity gotchas that layer already solves:
- A bare `input`/`select` selector is (0,0,1) and **loses to Tailwind's `text-xs`** (0,1,0). The 16px anti-iOS-zoom rule uses `input:not([type="checkbox"]):not([type="radio"])` / `select:not([hidden])` to reach (0,2,1)/(0,1,1) and win.
- For a checkbox the `<label>` is the real tap target; `label:has(> input[type="checkbox"])` gives it the 44px floor app-wide.

## Navigation by Tier

- **Phone** — `components/BottomNav.tsx`, a `md:hidden` fixed bottom bar: Dashboard / Reservations / Customers / Finance + **More**, which opens `components/NavDrawer.tsx` (bottom sheet: Fleet, Reminders, Settings, Logout). `lib/nav.ts#splitNav` does the split from the *server's* permission-filtered `/api/nav` payload — never a hardcoded list, so a visitor gets one slot + More. Reminders does **not** close the sheet: `Bell` owns its own Modal, so unmounting it would destroy the dialog in the same tick it opened.
- **Tablet** — `Sidebar` as a 64px icon rail holding everything; the burger expands it to the 236px labelled sidebar. No bottom bar.
- **Desktop** — `Sidebar` expanded at 236px, exactly as before.
- z-index ladder: `BottomNav` 40 < `NavDrawer` 50 = `Modal` 50 < pickers 60.

## Other Tier-Aware Pieces

- `lib/useResponsiveView.ts` — Fleet / Reservations / Customers force the **card** view below `lg` (the table is desktop-only). It forces rather than CSS-hiding because `VehicleThumb` fetches a photo per vehicle on mount regardless of visibility. `ViewToggle` is `max-lg:hidden`.
- `components/RecordCard.tsx` — the stacked stand-in for a table row, used by pages with **no** existing card view (Dashboard). `hidden lg:block` on the `<table>`, `lg:hidden` on the card list; one React state feeds both.
- `lib/useMediaQuery.ts` — only for widths that feed inline styles and that CSS cannot reach (`Timeline`'s `LABEL_W`: 150 desktop / 104 below). SSR-safe, so it returns `false` on the first render — use it to *upgrade* a layout, never to hide something the phone needs.
- `DateField`'s popover clamps its width to `innerWidth - 16` and sets `is-narrow`, which stacks the preset rail above the month. Both pickers close on resize **only when the width changed** — the mobile keyboard fires a height-only resize and used to dismiss them instantly.

## Frontend Coding Conventions (UI/UX-relevant)

- All API calls go through `lib/api.ts` — never use `fetch()` directly in components.
- Money display: always use `formatEur(cents)` from `lib/money.ts`.
- Permission checks in UI: use `can(user, "perm")` from `lib/perms.ts`.
- i18n: always use `t("key")` / the `tf(key, fallback)` pattern from `useT()` — never hardcode English strings in JSX without a fallback.
- CRUD confirmations: use `useToast()` from `lib/toast.tsx`, not `alert()`.
- Customer name input must be uppercased before API submission.
- A page offering both a detail-card list and a table view of the same rows should use the shared `ViewToggle` component, with the choice persisted per-page in `localStorage`.

## Key Shared UI Components

| Path | What it is |
|---|---|
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
| `frontend/lib/toast.tsx` | Portal-rendered toast notifications (`useToast().success/error/info`), replaces `alert()` |

## Invoice & PDF Visual Rules

- Invoices always render **2 A4 copies** side-by-side (customer + office), each on its own page.
- Seal: stamp image takes precedence over logo if both exist.
- QR codes: up to 2 per invoice — a **contact vCard** and/or a **SEPA payment** QR. When no business contact info is configured, a **fallback rental-summary QR** (built purely from the deal) takes the contact QR's place, so every invoice always shows at least one QR.
- Each QR's encoded actions (call / WhatsApp / map / IBAN / email) also render as **tappable, labelled buttons** directly beneath it, so a digital reader can act without scanning.
- SEPA QR only generated when `pay_qr_enabled = true` AND `iban` is set AND `balance_due > 0`.
- PDF fonts: DejaVuSans (bundled in `backend/assets/fonts/`) for Turkish/Albanian glyphs.
