"""
Visual theme for the whole app.

Typeface system — ONE minimalistic sans-serif for the whole app (loaded from Google
Fonts, free, with full Turkish/Albanian glyph coverage):
  - Plus Jakarta Sans -> everything: brand wordmark, page titles, KPI numbers,
    labels, tables, controls. It's a clean geometric-humanist sans chosen to
    imitate Google Sans / the Gemini UI face (Google Sans itself isn't on Google
    Fonts), in keeping with the minimalist, monochrome navigation. Both
    --font-display and --font-body resolve to it; the two CSS variables are kept
    only so size/weight intent stays legible at call sites.

inject_theme() is called once in app.py and:
  - imports the fonts
  - defines the colour tokens as CSS variables
  - applies the fonts and a calm, minimal base style to Streamlit's widgets
"""

try:
    import streamlit as st  # used only by the Streamlit app's resolve_theme/inject_theme
except Exception:
    st = None  # FastAPI backend imports only TOKENS/THEME_DEFAULTS/THEME_FONTS

# Colour tokens — fully MONOCHROME (black / white / grey). There is NO brand colour:
# the whole app now wears the minimalist sidebar palette — a clean near-white canvas,
# near-black ink, neutral greys, hairline borders. The "accent" is ink (CTAs, links,
# focus, active states), and the former status hues are greyscale: each status still
# reads via its TEXT label (+ dot), so meaning is preserved without colour.
TOKENS = {
    "bg": "#FAFAF9",        # clean near-white content canvas
    "surface": "#F4F3F1",   # subtle surface for tiles / cards
    "text": "#1A1C1E",      # neutral near-black ink
    "muted": "#6B7280",     # cool grey
    "border": "#EAE8E3",    # hairline
    "accent": "#1A1C1E",    # ink — CTAs, links, focus (was emerald; now monochrome)
    "accent_hover": "#3F3F46",  # lifted grey on hover/press
    "ok": "#1A1C1E",        # status colours are greyscale now (text label carries meaning)
    "info": "#52525B",      # status: Rented (grey)
    "warn": "#71717A",      # status: Maintenance / due-soon (grey)
    "danger": "#DC2626",    # ALERT RED — the ONE accent kept, only for genuinely
                            # destructive (delete) + overdue cues; everything else monochrome

    "archived": "#9CA3AF",  # neutral grey
}

FONT_IMPORT = (
    "@import url('https://fonts.googleapis.com/css2?"
    "family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');"
)

# ── Theme customization (super-admin) + night mode ───────────────────────────
# A super-admin can override the FONT + colour ROLES below (Settings → Select
# Theme); defaults mirror the built-in monochrome tokens, so the app looks
# identical until customized. A per-session "Night mode" toggle (top of Home)
# then flips the neutral canvas to dark gray + soft black on top of those colours.
THEME_DEFAULTS = {
    "font": "Plus Jakarta Sans",
    "primary": TOKENS["accent"],          # CTAs, links, focus, active
    "secondary": TOKENS["accent_hover"],  # hover / secondary emphasis
    "success": TOKENS["ok"],              # success / available
    "warning": TOKENS["warn"],            # warning / due-soon / maintenance
    "alert": TOKENS["danger"],            # alert / overdue / destructive
    "disabled": TOKENS["archived"],       # disabled / archived
    "bg": TOKENS["bg"],                   # page background
}
# Curated picker list — all on Google Fonts with full TR/SQ glyph coverage and the
# 400;500;600;700 weights this app uses (fonts lacking those weights are excluded so
# the dynamic css2 request never 404s).
THEME_FONTS = [
    "Plus Jakarta Sans", "Inter", "Poppins", "Montserrat", "Roboto", "Open Sans",
    "Nunito", "Work Sans", "DM Sans", "Manrope", "Rubik", "Source Sans 3",
    "Lora", "Playfair Display",
]
# Night-mode palette — "dark gray and soft black".
_DARK = {"bg": "#17181A", "surface": "#232427", "text": "#E8E6E3",
         "muted": "#A1A1AA", "border": "#34343A"}


def _is_dark_color(hex_color: str) -> bool:
    """True if `hex_color` reads as dark (low luminance) — used to lift a near-black
    primary to light so it stays visible on the night-mode canvas."""
    try:
        h = hex_color.lstrip("#")
        if len(h) == 3:
            h = "".join(c * 2 for c in h)
        r, g, b = (int(h[i:i + 2], 16) for i in (0, 2, 4))
        return (0.299 * r + 0.587 * g + 0.114 * b) < 110
    except Exception:
        return False


def _font_import(font: str) -> str:
    fam = (font or "Plus Jakarta Sans").replace(" ", "+")
    return ("@import url('https://fonts.googleapis.com/css2?"
            f"family={fam}:wght@400;500;600;700&display=swap');")


def resolve_theme():
    """(tokens, font, is_dark): built-in defaults ← super-admin's stored theme ←
    night-mode palette (per-session). Imported lazily to avoid an import cycle."""
    from data.repositories import app_settings as app_cfg
    th = app_cfg.get_theme(THEME_DEFAULTS)
    dark = bool(st.session_state.get("dark_mode", False))
    tok = dict(TOKENS)
    tok["accent"] = th["primary"]
    tok["accent_hover"] = th["secondary"]
    tok["ok"] = th["success"]
    tok["info"] = th["secondary"]
    tok["warn"] = th["warning"]
    tok["danger"] = th["alert"]
    tok["archived"] = th["disabled"]
    tok["bg"] = th["bg"]
    if dark:
        tok.update(_DARK)
        if _is_dark_color(th["primary"]):     # keep a near-black primary visible
            tok["accent"], tok["accent_hover"] = "#E8E6E3", "#FFFFFF"
        for k in ("ok", "info", "warn", "archived"):   # lift dark mono status to light
            if _is_dark_color(tok[k]):
                tok[k] = "#D4D4D8"
    return tok, th["font"], dark


# Night-mode overrides for surfaces Streamlit/BaseWeb paint white (the variable
# layer can't reach those). Injected only when night mode is on.
_DARK_CSS = """
<style>
[data-testid="stAppViewContainer"], [data-testid="stMain"], .stApp,
[data-testid="stHeader"] { background: var(--bg) !important; }
[data-testid="stMain"], body, p, span, label, .stMarkdown,
h1, h2, h3, h4, h5, h6 { color: var(--text); }
section[data-testid="stSidebar"] { background: #1E1F22 !important; border-right-color: var(--border) !important; }
/* Inputs / selects / textareas */
[data-baseweb="input"], [data-baseweb="textarea"], [data-baseweb="base-input"],
[data-baseweb="select"] > div, [data-baseweb="input"] input, textarea, input {
  background: var(--surface) !important; color: var(--text) !important; }
[data-baseweb="select"] [role="button"] { color: var(--text) !important; }
[data-baseweb="popover"] [role="listbox"], [data-baseweb="menu"] { background: var(--surface) !important; color: var(--text) !important; }
/* Surfaces: cards, dataframes, expanders, dialogs, popovers, tabs */
[data-testid="stDataFrame"], [data-testid="stExpander"] details, div[role="dialog"],
[data-testid="stPopoverBody"], [data-testid="stTable"], [data-testid="stNotification"] {
  background: var(--surface) !important; color: var(--text) !important; }
/* Popover panel (account menu Settings/Logout) — a BaseWeb surface with no stable
   testid; it's the content div directly inside the stPopover wrapper. */
[data-testid="stPopover"] > div { background: var(--surface) !important; color: var(--text) !important;
  border: 1px solid var(--border) !important; }
/* Popover/account buttons get a dark-ink colour from a high-specificity polish rule;
   match it (this block is injected later, so equal specificity wins) for light text. */
section[data-testid="stSidebar"] [data-testid="stPopover"] button,
[data-testid="stPopover"] > div button { color: var(--text) !important; }
[data-testid="stPopover"] > div button:hover { background: rgba(255,255,255,.10) !important; }
.acct-name { color: var(--text) !important; }
/* Neumorphic active-rental highlight: dark-mode shadow pair. */
.active-hl { box-shadow: 5px 5px 12px rgba(0,0,0,.5), -5px -5px 12px rgba(255,255,255,.04) !important; }
[data-testid="stMain"] [data-testid="stLayoutWrapper"] > [data-testid="stVerticalBlock"] {
  background: var(--surface) !important; }
.kpi, .return-box { background: var(--surface) !important; }
/* Buttons: secondary on a dark surface, primary keeps the accent with dark text */
.stButton > button { background: var(--surface) !important; color: var(--text) !important;
  border: 1px solid var(--border) !important; }
.stButton > button[kind="primary"] { background: var(--accent) !important; color: #17181A !important;
  border-color: var(--accent) !important; }
/* Sidebar hover/active tints flip from dark-ink to light */
section[data-testid="stSidebar"] button { background: transparent !important; color: #D4D4D8 !important; }
section[data-testid="stSidebar"] button:hover,
section[data-testid="stSidebar"] [class*="st-key-nav_"] button[kind="primary"] {
  background: rgba(255,255,255,.10) !important; color: var(--text) !important; }
.rail-brand-mark { background: var(--accent) !important; color: #17181A !important; }
.rbt-name, .acct-name { color: var(--text) !important; }
hr { border-color: var(--border) !important; }
</style>
"""


# ── UX polish layer ──────────────────────────────────────────────────────────
# A second, plain-string stylesheet injected after the themed CSS above. Kept as a
# non-f-string so literal CSS braces need no escaping. It only refines depth,
# motion, focus and roundness on top of the existing tokens — no colour/brand
# changes — so it is safe across every page. Motion respects prefers-reduced-motion.
_POLISH_CSS = """
<style>
/* ===== Login screen: centre the card so credentials need NO scrolling =====
   _render_login emits a hidden .login-mode marker, and the auth gate st.stop()s
   before the sidebar/nav render — so the page is just this one card. Vertically
   centre it in the viewport and trim the page padding. `safe center` falls back to
   top-alignment on very short windows so a tall card is never clipped/unreachable. */
[data-testid="stMain"] .block-container:has(.login-mode) {
  /* leave room for Streamlit's top toolbar (~3rem) so the card never spills into a
     page scroll, even on shorter windows */
  min-height: calc(100vh - 5rem) !important;
  display: flex !important; flex-direction: column; justify-content: safe center;
  padding-top: 0.75rem !important; padding-bottom: 0.75rem !important;
}
.login-mode { display: none; }

/* Gentle, meaningful motion — only when the user hasn't asked to reduce it */
@media (prefers-reduced-motion: no-preference) {
  .stButton > button,
  .kpi,
  div[data-testid="stVerticalBlockBorderWrapper"],
  [data-testid="stExpander"] details { transition: transform .16s ease, box-shadow .16s ease, border-color .16s ease; }
}
@media (prefers-reduced-motion: reduce) {
  .stButton > button:hover, .kpi:hover,
  div[data-testid="stVerticalBlockBorderWrapper"]:hover { transform: none !important; }
}

/* Keyboard accessibility: clear focus rings (never removed) */
.stButton > button:focus-visible,
.stTextInput input:focus-visible,
.stNumberInput input:focus-visible,
[data-baseweb="select"] [role="button"]:focus-visible {
  outline: 2px solid var(--accent) !important; outline-offset: 2px !important;
}

/* Buttons: soft depth + tactile press */
.stButton > button { box-shadow: 0 1px 2px rgba(15,23,42,.06); }
.stButton > button:hover { transform: translateY(-1px); box-shadow: 0 6px 16px -8px rgba(15,23,42,.30); }
.stButton > button:active { transform: translateY(0); box-shadow: 0 1px 2px rgba(15,23,42,.12); }
.stButton > button[kind="primary"] { box-shadow: 0 2px 10px -3px rgba(15,23,42,.28); }
[class*="st-key-fldel_"] button,
[class*="st-key-dzreset_"] button,
[class*="st-key-usrdel_"] button { box-shadow: 0 2px 10px -3px rgba(220,38,38,.40) !important; }

/* Bordered containers read as real cards (vehicle info cards, etc.). Streamlit 1.58
   renders st.container(border=True) as a bordered stVerticalBlock wrapped in a
   stLayoutWrapper — the old stVerticalBlockBorderWrapper testid is gone, which left
   the previous rule dead. Target the 1.58 structure and give each card a MINIMAL
   vertical margin so adjacent card rows never visually collide/overlap. */
[data-testid="stMain"] [data-testid="stLayoutWrapper"] > [data-testid="stVerticalBlock"] {
  margin-top: 6px !important; margin-bottom: 6px !important;
  border-radius: 12px !important; box-shadow: 0 1px 2px rgba(15,23,42,.04);
}
/* Legacy fallback for older Streamlit (pre-1.58) that still emits the wrapper. */
div[data-testid="stVerticalBlockBorderWrapper"] {
  border-radius: 12px !important; box-shadow: 0 1px 2px rgba(15,23,42,.04); margin: 6px 0 !important;
}

/* KPI tiles lift slightly on hover */
.kpi:hover { transform: translateY(-2px); box-shadow: 0 12px 26px -14px rgba(15,23,42,.24); }

/* Inputs: rounder with an accent focus glow */
[data-baseweb="input"], [data-baseweb="select"] > div, [data-baseweb="textarea"] { border-radius: 10px !important; }
[data-baseweb="input"]:focus-within, [data-baseweb="select"] > div:focus-within {
  border-color: var(--accent) !important; box-shadow: 0 0 0 3px rgba(17,24,39,.14) !important;
}

/* Dataframes: contained and rounded */
[data-testid="stDataFrame"] { border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }

/* Tabs: tidy spacing, accented active tab */
.stTabs [data-baseweb="tab-list"] { gap: 4px; }
.stTabs [aria-selected="true"] { color: var(--accent) !important; }

/* Expanders + dialog: rounder, with a hover surface on the summary */
[data-testid="stExpander"] details { border-radius: 12px !important; }
[data-testid="stExpander"] summary:hover { background: var(--surface); }
div[role="dialog"] { border-radius: 16px !important; }

/* Quieter dividers, more readable captions, consistent links */
hr { opacity: .7; }
[data-testid="stCaptionContainer"] { line-height: 1.5; }
a { color: var(--accent); }

/* ===== Calendar (st.date_input popover): HOLLOW highlighted dates =====
   Streamlit's BaseWeb datepicker draws the selected day as a solid accent DISC via
   the gridcell's ::after pseudo-element (and white text). For a minimalist,
   monochrome look we make that highlight HOLLOW: keep the disc geometry but null its
   fill and give it a crisp ink ring, with the day number switched back to ink. The
   popover renders in the main DOM, so this lives in the global layer; the
   "Selected"/"Chosen" aria-label prefix (the picker uses an English a11y locale) is
   the stable hook. The hovered day gets a lighter grey ring the same way. */
[data-baseweb="calendar"] [role="gridcell"][aria-label^="Selected"]::after,
[data-baseweb="calendar"] [role="gridcell"][aria-label^="Chosen"]::after {
  background: transparent !important;
  background-color: transparent !important;
  border: 2px solid var(--text) !important;
  border-radius: 50% !important;
  box-sizing: border-box !important;
}
[data-baseweb="calendar"] [role="gridcell"][aria-label^="Selected"],
[data-baseweb="calendar"] [role="gridcell"][aria-label^="Selected"] > div,
[data-baseweb="calendar"] [role="gridcell"][aria-label^="Chosen"],
[data-baseweb="calendar"] [role="gridcell"][aria-label^="Chosen"] > div {
  color: var(--text) !important;
}
/* Hover/focus: a lighter hollow grey ring so the fill never goes solid */
[data-baseweb="calendar"] [role="gridcell"]:hover::after {
  background: transparent !important;
  background-color: transparent !important;
  border: 1.5px solid var(--muted) !important;
  border-radius: 50% !important;
  box-sizing: border-box !important;
}
[data-baseweb="calendar"] [role="gridcell"]:hover,
[data-baseweb="calendar"] [role="gridcell"]:hover > div {
  color: var(--text) !important;
}

/* Visitor home hero (customer-facing browse banner) */
.visitor-hero {
  background: linear-gradient(135deg, #1A1C1E 0%, #3F3F46 100%);
  color: #fff; border-radius: 18px; padding: 30px 28px; margin-bottom: 18px;
  box-shadow: 0 16px 40px -20px rgba(15,23,42,.45);
}
.visitor-hero .vh-brand { font-family: var(--font-display); font-weight: 700;
  font-size: 1.05rem; opacity: .9; letter-spacing: .02em; }
.visitor-hero .vh-title { font-family: var(--font-display); font-weight: 700;
  font-size: 1.95rem; margin-top: 6px; line-height: 1.1; }
.visitor-hero .vh-sub { font-size: 1rem; opacity: .92; margin-top: 8px; max-width: 640px; }
@media (max-width: 640px) {
  .visitor-hero { padding: 22px 18px; }
  .visitor-hero .vh-title { font-size: 1.45rem; }
}

/* ===== Minimalistic two-state navigation sidebar (Gemini-style) =====
   Always visible. A custom toggle (ui/nav.py → session_state['nav_expanded'])
   switches between an EXPANDED icon+label list and a slim COLLAPSED icon rail —
   never hidden, so the section icons stay reachable. Page content reflows in both
   states because the sidebar keeps a real (non-zero) flex width. Idle rows are
   muted grey with a rounded inset highlight on hover; the active section keeps a
   soft-emerald highlight. The per-state width / alignment / label-hiding, plus the
   mobile icon-rail, are injected per-run at the end of inject_theme(). */
section[data-testid="stSidebar"] {
  background: #FFFFFF !important;
  border-right: 1px solid var(--border);
  /* Always on screen — collapse is driven by our OWN toggle (ui/nav.py →
     session_state['nav_expanded']), never Streamlit's native hide. The width and
     row alignment for each state are injected per-run at the end of inject_theme(). */
  transform: none !important; visibility: visible !important; margin-left: 0 !important;
}
/* Hide Streamlit's native collapse/expand/resize controls — our toggle replaces them. */
[data-testid="stSidebarCollapseButton"], [data-testid="stExpandSidebarButton"],
section[data-testid="stSidebar"] [data-testid="stSidebarResizeHandle"] { display: none !important; }
/* The native sidebar HEADER only held that (now-hidden) collapse button, leaving a
   ~60px empty band at the top that pushed content down and forced a scrollbar.
   Collapse it to nothing so the rail starts flush at the top. */
section[data-testid="stSidebar"] [data-testid="stSidebarHeader"] {
  height: 0 !important; min-height: 0 !important; padding: 0 !important; margin: 0 !important;
}
/* Small inset so the rounded row highlight keeps a margin from the edges. Tight top
   padding so there's no wasted space above the toggle. */
section[data-testid="stSidebar"] [data-testid="stSidebarUserContent"] { padding: 6px 8px 14px !important; }

/* Keep page content clear of the sidebar. A sidebar at its natural width
   (~200px+) lets Streamlit's flex layout offset the main column correctly; the
   old 78px rail was far below that, so the absolutely-positioned stMain
   collapsed back to x=0 and rendered *under* the rail, clipping the page's left
   edge (titles, the timeline's vehicle names). The 236px width above resolves
   that. This positioning-context rule on the main wrapper is a belt-and-braces
   safeguard so stMain can never escape its flex column again. */
[data-testid="stAppViewContainer"] > div:has([data-testid="stMain"]) {
  position: relative !important;
}

/* Full-height flex column so the footer pins to the bottom (with a fallback gap).
   align-items:stretch lets rows fill the sidebar width. */
section[data-testid="stSidebar"] div[data-testid="stVerticalBlock"]:first-of-type {
  /* Fill the viewport minus the user-content paddings (6 top + 14 bottom) so the
     footer pins to the bottom; the small extra keeps content within the viewport so
     it never spills over into a scrollbar. */
  min-height: calc(100vh - 28px); display: flex; flex-direction: column; align-items: stretch; gap: 4px;
}
section[data-testid="stSidebar"] div[data-testid="stVerticalBlock"]:first-of-type > div:has(.rail-spacer) {
  flex: 1 1 auto;
}
.rail-spacer { min-height: 12px; }

/* Brand header: gradient mark + name + tagline, with a hairline divider below */
.rail-brand-row {
  display: flex; align-items: center; gap: 11px; width: 100%;
  padding: 2px 8px 4px;
  /* Minimal vertical breathing room so the logo doesn't touch the toggle above or
     the first nav row below (which it slightly overlapped). */
  margin: 6px 0 12px;   /* no border — clean, like the reference */
}
/* Monochrome mark — a near-black rounded square with the business initial in
   white. No brand colour / gradient, in keeping with the black-and-white rail. */
.rail-brand-mark {
  width: 30px; height: 30px; border-radius: 9px; flex: 0 0 auto;
  display: flex; align-items: center; justify-content: center;
  background: var(--text); color: #fff;
  font-family: var(--font-display); font-weight: 700; font-size: .85rem;
  box-shadow: 0 1px 3px rgba(15,23,42,.18);
}
.rail-brand-text { min-width: 0; }
.rbt-name { font-family: var(--font-display); font-weight: 700; font-size: .8rem; letter-spacing: -.01em;
  color: var(--text); line-height: 1.15; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rbt-tag { font-size: .55rem; letter-spacing: .14em; text-transform: uppercase;
  color: var(--muted); margin-top: 1px; }

/* Profile dropdown (st.popover) header card: name + role, shown at the top of the
   account menu above the Settings / Logout actions. (The old static .rail-user-row
   avatar block is gone — the account row is now the popover trigger.) */
.acct-card { padding: 0 2px 8px; border-bottom: 1px solid var(--border); margin-bottom: 6px; }
.acct-name { font-family: var(--font-display); font-weight: 700; font-size: .9rem; color: var(--text); line-height: 1.2; }
.acct-role { font-size: .72rem; color: var(--muted); margin-top: 1px; }

/* Nav / footer rows: left-aligned icon + label, rounded inset highlight.
   (Per-state alignment/width — and label-hiding in the collapsed rail — are set in
   the dynamic block at the end of inject_theme.) */
/* Nav / footer rows AND the profile-menu popover trigger share one row style.
   (The popover trigger has data-testid="stPopover…"; we match both so the account
   row lines up with the section rows.) Compact sizing per the brief. */
section[data-testid="stSidebar"] button[data-testid^="stBaseButton"],
section[data-testid="stSidebar"] [data-testid="stPopover"] button {
  width: 100% !important; min-width: 0 !important; height: auto !important;
  padding: 6px 10px !important; margin: 1px 0 !important;
  background: transparent !important; border: none !important; box-shadow: none !important;
  color: #3F3F46 !important; font-size: .78rem !important; font-weight: 500 !important; line-height: 1.25 !important;
  letter-spacing: 0 !important;
  border-radius: 999px !important; white-space: nowrap !important; text-align: left !important;
  display: flex !important; align-items: center !important; justify-content: flex-start !important;
  transition: background .14s ease, color .14s ease !important;
}
section[data-testid="stSidebar"] button[data-testid^="stBaseButton"]:hover,
section[data-testid="stSidebar"] [data-testid="stPopover"] button:hover {
  background: rgba(17,24,39,.05) !important; color: var(--text) !important;
  transform: none !important; box-shadow: none !important;
}
/* Streamlit centers a button's label via two nested flex wrappers (jc:center);
   pin them left so every row's icon lines up in one column. */
section[data-testid="stSidebar"] button[data-testid^="stBaseButton"] > div,
section[data-testid="stSidebar"] button[data-testid^="stBaseButton"] > div > span,
section[data-testid="stSidebar"] [data-testid="stPopover"] button > div,
section[data-testid="stSidebar"] [data-testid="stPopover"] button > div > span {
  justify-content: flex-start !important; width: 100% !important;
}
/* ALIGNMENT FIX: Streamlit renders the label as `<p>` (display:block) holding an
   inline-block Material icon (vertical-align:bottom) next to a bare text node, so
   the taller icon rode high above the text. Make the label container a flex row
   with centred items and pin the icon's vertical-align to middle so icon + page
   title sit on one line. */
section[data-testid="stSidebar"] button [data-testid="stMarkdownContainer"],
section[data-testid="stSidebar"] button [data-testid="stMarkdownContainer"] p {
  display: flex !important; align-items: center !important; line-height: 1 !important; margin: 0 !important;
  /* The label text lives in this <p>, which carries Streamlit's default 14px — a
     button-level font-size won't reach it, so set the compact size HERE (covers
     section rows AND the profile trigger). */
  font-size: .78rem !important;
}
/* Material icon inside a row: a touch larger than the label, with breathing room.
   Smaller than before per the brief; vertical-align:middle keeps it centred. */
section[data-testid="stSidebar"] button span[role="img"] {
  font-size: 1.05rem !important; margin-right: 9px !important; flex: 0 0 auto !important;
  vertical-align: middle !important; line-height: 1 !important;
}
/* Active section: a soft neutral-grey rounded pill (Gemini-style), dark icon +
   label — no brand colour, matching the reference screenshot's "Images" item. */
section[data-testid="stSidebar"] [class*="st-key-nav_"] button[kind="primary"] {
  background: rgba(17,24,39,.07) !important; color: var(--text) !important; font-weight: 600 !important;
}
section[data-testid="stSidebar"] [class*="st-key-nav_"] button[kind="primary"]:hover {
  background: rgba(17,24,39,.10) !important; color: var(--text) !important;
}
/* Notification bell: fully monochrome to match the black-and-white rail — no red
   alarm tint. When there are reminders it renders type="primary", so it gets the
   same soft-grey active pill as a selected section (the count in its label is the
   signal). The bell + logout share the same neutral hover as every other row. */
section[data-testid="stSidebar"] [class*="st-key-notif_bell"] button[kind="primary"] {
  background: rgba(220,38,38,.12) !important; color: var(--danger) !important; font-weight: 600 !important;
}
section[data-testid="stSidebar"] [class*="st-key-notif_bell"] button[kind="primary"]:hover {
  background: rgba(220,38,38,.18) !important; color: var(--danger) !important;
}
section[data-testid="stSidebar"] [class*="st-key-notif_bell"] button[kind="primary"] span[role="img"] {
  color: var(--danger) !important;
}
/* Keyboard focus ring (WCAG 2.4.7) — ink, not a brand colour, to stay monochrome */
section[data-testid="stSidebar"] button[data-testid^="stBaseButton"]:focus-visible,
section[data-testid="stSidebar"] [data-testid="stPopover"] button:focus-visible {
  outline: 2px solid var(--text) !important; outline-offset: 2px !important;
}

/* ===== Profile dropdown (st.popover) =====
   Trigger sits in the sidebar footer (account icon + name). Hide its dropdown caret
   so the row matches the section rows. The PANEL renders in a body-level portal, so
   its rules are global (not scoped under the sidebar): a tidy monochrome menu whose
   Settings / Logout rows look like left-aligned icon+label menu items. */
section[data-testid="stSidebar"] [data-testid="stPopover"] button svg { display: none !important; }
/* Profile trigger label: match the compact nav-row label size (its <p> carries an
   explicit font-size, so a button-level rule won't reach it). The collapsed rail
   hides it via an equal-specificity rule injected later (see rail_css). */
section[data-testid="stSidebar"] [data-testid="stPopoverButton"] [data-testid="stMarkdownContainer"] p {
  font-size: .78rem !important; font-weight: 500 !important;
}
[data-testid="stPopoverBody"] { padding: 8px !important; min-width: 184px !important; }
/* Menu label text: match the compact menu size and centre it with its icon (the
   label lives in a <p> with its own font-size, so set it here — a button-level
   font-size won't cascade into it). */
[data-testid="stPopoverBody"] button [data-testid="stMarkdownContainer"],
[data-testid="stPopoverBody"] button [data-testid="stMarkdownContainer"] p {
  display: flex !important; align-items: center !important; line-height: 1 !important;
  margin: 0 !important; font-size: .85rem !important;
}
[data-testid="stPopoverBody"] button[data-testid^="stBaseButton"] {
  width: 100% !important; justify-content: flex-start !important; text-align: left !important;
  background: transparent !important; border: none !important; box-shadow: none !important;
  color: var(--text) !important; font-weight: 500 !important; font-size: .85rem !important;
  padding: 8px 10px !important; border-radius: 8px !important;
  display: flex !important; align-items: center !important;
}
[data-testid="stPopoverBody"] button[data-testid^="stBaseButton"]:hover {
  background: rgba(17,24,39,.06) !important; color: var(--text) !important;
  transform: none !important; box-shadow: none !important;
}
[data-testid="stPopoverBody"] button span[role="img"] {
  font-size: 1.05rem !important; margin-right: 9px !important; vertical-align: middle !important;
}
</style>
"""


def inject_theme():
    tok, font, dark = resolve_theme()
    fam = f"'{font}', system-ui, -apple-system, 'Segoe UI', sans-serif"
    css = f"""
    <style>
    {_font_import(font)}

    :root {{
        --bg: {tok['bg']};
        --surface: {tok['surface']};
        --text: {tok['text']};
        --muted: {tok['muted']};
        --border: {tok['border']};
        --accent: {tok['accent']};
        --accent-hover: {tok['accent_hover']};
        --ok: {tok['ok']};
        --info: {tok['info']};
        --warn: {tok['warn']};
        --danger: {tok['danger']};
        --archived: {tok['archived']};
        --font-display: {fam};
        --font-body: {fam};
    }}

    /* Base font on the whole app */
    html, body, [data-testid="stAppViewContainer"], .stMarkdown, p, span, div,
    label, input, textarea, select, button, table {{
        font-family: var(--font-body);
    }}
    /* Force the app font onto Streamlit's native headings (st.title/header/
       subheader). Streamlit's theme applies its default "Source Sans" to h1–h6
       with class-level specificity, so an !important here is needed to keep the
       whole app on one Gemini-style face. */
    h1, h2, h3, h4, h5, h6 {{ font-family: var(--font-display) !important; letter-spacing: -0.01em; }}

    /* Sidebar brand */
    .bcr-brand {{ font-family: var(--font-display); font-weight: 700;
        font-size: 1.2rem; color: var(--text); line-height: 1.1; }}
    .bcr-brand small {{ display:block; font-family: var(--font-body); font-weight: 500;
        font-size: 0.72rem; letter-spacing: .12em; text-transform: uppercase;
        color: var(--muted); margin-top: 2px; }}

    /* Page header with hover help */
    .page-head {{ display:flex; align-items:center; gap:10px; margin: 2px 0 2px; }}
    .page-title {{ font-family: var(--font-display); font-weight: 600;
        font-size: 1.55rem; color: var(--text); }}
    .section-title {{ font-family: var(--font-display); font-weight: 600;
        font-size: 1.08rem; color: var(--text); margin: 6px 0 2px; display:flex;
        align-items:center; gap:8px; }}
    .info-dot {{ position: relative; display:inline-flex; align-items:center;
        justify-content:center; width:18px; height:18px; border-radius:50%;
        background: var(--surface); border:1px solid var(--border);
        color: var(--muted); font-size: 11px; font-weight:700; cursor: help; }}
    .info-dot:hover::after {{ content: attr(data-tip); position:absolute; left:24px; top:-4px;
        width: max-content; max-width: 320px; background: #0f172a; color: #f8fafc;
        padding: 8px 11px; border-radius: 8px; font-family: var(--font-body);
        font-weight: 400; font-size: 12px; line-height: 1.45; z-index: 9999;
        box-shadow: 0 10px 25px -5px rgba(0,0,0,.35); }}

    /* Status badge */
    .badge {{ display:inline-flex; align-items:center; gap:6px; padding: 2px 10px;
        border-radius: 999px; font-size: 0.78rem; font-weight: 600; }}
    .badge::before {{ content:''; width:7px; height:7px; border-radius:50%; background: currentColor; }}
    /* Monochrome badges: the same soft grey pill as the sidebar, in ink. The status
       TEXT (e.g. "Available" / "Rented" / "Overdue") carries the meaning — no colour.
       Overdue/danger gets a slightly stronger tint so it reads a touch heavier. */
    .badge.ok {{ color: var(--ok); background: color-mix(in srgb, var(--ok) 12%, transparent); }}
    .badge.info {{ color: var(--info); background: color-mix(in srgb, var(--info) 12%, transparent); }}
    .badge.warn {{ color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }}
    .badge.danger {{ color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); }}
    .badge.archived {{ color: var(--archived); background: color-mix(in srgb, var(--archived) 18%, transparent); }}

    /* Inline monochrome Material Symbols icon for use INSIDE custom HTML, where the
       Streamlit `:material/x:` directive isn't processed (KPI chips, lock chip, the
       photo placeholder). The font is already loaded app-wide by the sidebar icons;
       the glyph inherits the surrounding text colour, so it stays black/white. */
    .msym {{ font-family: 'Material Symbols Rounded'; font-weight: 400; font-style: normal;
        line-height: 1; vertical-align: -.18em; letter-spacing: normal; text-transform: none;
        white-space: nowrap; -webkit-font-smoothing: antialiased; -webkit-font-feature-settings: 'liga'; }}
    /* Locked-status chip on a fleet card (icon only; full message shown on hover). */
    .lock-chip {{ display: inline-flex; align-items: center; margin-left: 6px;
        color: var(--muted); cursor: help; }}
    .lock-chip .msym {{ font-size: 1.05rem; }}

    /* Users table (Settings → Users): column headers, dim placeholders, row rule. */
    .utbl-head {{ font-weight: 600; font-size: .72rem; letter-spacing: .05em;
        text-transform: uppercase; color: var(--muted); }}
    .utbl-dim {{ color: var(--muted); }}
    hr.utbl-row-sep {{ border: none; border-top: 1px solid var(--border);
        margin: 8px 0; opacity: .8; }}

    /* Active-customer card: fixed single-line rows (ellipsis) so a long value never
       changes the card height — neighbouring cards in the row stay aligned. */
    .cust-card {{ display: flex; flex-direction: column; gap: 3px; margin-bottom: 8px; }}
    .cust-card .cc-name {{ font-family: var(--font-display); font-weight: 700; font-size: .95rem;
        color: var(--text); line-height: 1.3;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
    .cust-card .cc-line {{ font-size: .8rem; color: var(--muted); line-height: 1.45;
        white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }}
    .cust-card .cc-line .msym {{ font-size: .95rem; margin-right: 5px; vertical-align: -.16em; }}

    /* KPI tile — uppercase label + optional icon chip on top, a large
       tabular-figure value below (tnum/lnum so digits align like a fintech stat). */
    .kpi {{ position: relative; background: var(--surface); border: 1px solid var(--border);
        border-radius: 14px; padding: 13px 15px 15px; display: flex; flex-direction: column;
        gap: 8px; min-height: 94px; margin: 4px 0 16px; box-shadow: 0 1px 2px rgba(15,23,42,.04); }}
    .kpi .kpi-head {{ display: flex; align-items: center; justify-content: space-between; gap: 8px; }}
    .kpi .kpi-label {{ font-size: 0.72rem; font-weight: 600; letter-spacing: .06em;
        text-transform: uppercase; color: var(--muted); line-height: 1.3; }}
    .kpi .kpi-chip {{ width: 30px; height: 30px; border-radius: 9px; flex: 0 0 auto;
        display: flex; align-items: center; justify-content: center; font-size: .92rem;
        line-height: 1; background: rgba(17,24,39,.06); }}
    .kpi .kpi-value {{ font-family: var(--font-display); font-weight: 700; font-size: 2rem;
        color: var(--text); line-height: 1; letter-spacing: -.02em;
        font-variant-numeric: tabular-nums lining-nums; font-feature-settings: "tnum" 1, "lnum" 1; }}
    .kpi.accent .kpi-value {{ color: var(--accent); }}
    .kpi.accent .kpi-chip {{ background: rgba(17,24,39,.10); }}

    /* Vehicle photo placeholder (🚘 avatar when no photo is uploaded) */
    .car-ph {{ display:flex; align-items:center; justify-content:center;
        background: var(--surface); border:1px solid var(--border);
        border-radius: 12px; font-size: 3.2rem; color: var(--muted); width:100%; }}

    /* Calculated return highlight */
    .return-box {{ background: linear-gradient(180deg, rgba(17,24,39,.06), rgba(17,24,39,.02));
        border:1px solid rgba(17,24,39,.18); border-radius: 14px; padding: 16px; }}
    .return-box .lbl {{ font-size:.74rem; font-weight:500; letter-spacing:.08em;
        text-transform:uppercase; color: var(--muted); }}
    .return-box .val {{ font-family: var(--font-display); font-weight:700;
        font-size: 1.35rem; color: var(--accent); }}

    /* Active-rental highlight — a rounded, soft (neumorphic) status-tinted block
       (round, not a hard left-stripe rectangle), with a little vertical span. The
       status colour comes in per card via the inline `--hl` custom property. */
    .active-hl {{ border-radius: 16px; padding: 12px 16px; margin: 2px 0 10px;
        background: color-mix(in srgb, var(--hl, var(--accent)) 9%, var(--surface));
        box-shadow: 5px 5px 12px rgba(16,24,40,.10), -5px -5px 12px rgba(255,255,255,.75); }}
    .active-hl > b {{ color: var(--text); }}

    /* Buttons: quiet, single accent */
    .stButton > button[kind="primary"] {{ background: var(--accent); border:none; border-radius:10px; }}
    .stButton > button[kind="primary"]:hover {{ background: var(--accent-hover); }}
    /* Nav buttons: keep the emoji+label on one line, ellipsis if truly cramped */
    .stButton > button {{ white-space: nowrap; }}
    /* Danger / alert buttons — Fleet Delete-Archive + the super-admin reset-data
       actions, targeted by widget key prefix (Streamlit emits `st-key-<key>`). */
    [class*="st-key-fldel_"] button,
    [class*="st-key-dzreset_"] button,
    [class*="st-key-usrdel_"] button,
    [class*="st-key-cnc_"] button {{
        background: var(--danger) !important; border:1px solid var(--danger) !important;
        color:#fff !important; border-radius:10px; }}
    [class*="st-key-fldel_"] button:hover,
    [class*="st-key-dzreset_"] button:hover,
    [class*="st-key-usrdel_"] button:hover,
    [class*="st-key-cnc_"] button:hover {{
        background:#B91C1C !important; border-color:#B91C1C !important; color:#fff !important; }}

    /* Trim default top padding */
    .block-container {{ padding-top: 2.2rem; }}

    /* Keep mobile browsers from auto-inflating text (a cause of pinch-zoom). */
    html {{ -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }}
    /* Per-field labels that appear ONLY on phones, so a stacked table cell still
       says what it is (e.g. "Plate: 34 ABC 12"). Hidden on desktop. */
    .m-label {{ display: none; }}

    /* ── Mobile responsiveness ───────────────────────────────────────────
       On phones, stack every column row vertically and clamp components to the
       viewport so the page fits without the user having to pinch-zoom out. */
    @media (max-width: 640px) {{
        [data-testid="stAppViewContainer"] {{ overflow-x: hidden; }}
        .block-container {{ padding: 0.8rem 0.6rem 2rem !important; max-width: 100% !important; }}
        /* Stack all st.columns rows (nav, KPIs, booking, cards, forms, fleet…) */
        div[data-testid="stHorizontalBlock"] {{ flex-wrap: wrap !important; gap: 0.4rem !important; }}
        div[data-testid="stHorizontalBlock"] > div[data-testid="stColumn"],
        div[data-testid="stHorizontalBlock"] > div {{
            flex: 1 1 100% !important; width: 100% !important; min-width: 0 !important; }}
        /* Nothing wider than the screen; wide tables scroll instead of overflowing */
        iframe, img {{ max-width: 100% !important; }}
        [data-testid="stDataFrame"], [data-testid="stTable"] {{
            max-width: 100% !important; overflow-x: auto !important; }}
        /* Comfortable tap targets (WCAG 44px); nav/action labels wrap when stacked */
        .stButton > button {{ white-space: normal; min-height: 44px; }}
        /* Reveal the per-field mobile labels; hide desktop-only table headers */
        .m-label {{ display: inline; font-weight: 600; color: var(--muted); margin-right: 4px; }}
        .hide-mobile {{ display: none !important; }}
        /* Tame display type so headings don't overflow */
        h1 {{ font-size: 1.5rem !important; }}
        .page-title {{ font-size: 1.25rem; }}
        .kpi .kpi-value {{ font-size: 1.6rem; }}
        /* KPI stat tiles (Total/Available/Rented/Garage vehicle counts): when the
           4-up row stacks on mobile, each tile (min-height 94px) is taller than its
           stacked column, so tiles overflowed and OVERLAPPED. Add bottom spacing to
           the tile's own column so consecutive tiles clear each other. */
        [data-testid="stMain"] div[data-testid="stHorizontalBlock"] > div[data-testid="stColumn"]:has(.kpi) {{
            margin-bottom: 18px !important; }}
        .inv-title h1, .brand {{ font-size: 1.3rem !important; }}
    }}
    </style>
    """
    st.markdown(css, unsafe_allow_html=True)
    st.markdown(_POLISH_CSS, unsafe_allow_html=True)

    # ── Per-run sidebar state: expanded label list ⇄ collapsed icon rail ──────
    # The custom toggle in ui/nav.py flips session_state['nav_expanded']; we inject
    # the matching width + row alignment here, so a toggle simply re-renders the
    # right state. The collapsed rail hides labels via the font-size:0 trick (the
    # icon <span> keeps its own size) rather than re-rendering icon-only in Python.
    # Phones are always the icon rail. Injected last, so it wins over the static
    # rules above on equal specificity.
    expanded = st.session_state.get("nav_expanded", True)
    rail_css = """
      section[data-testid="stSidebar"],
      section[data-testid="stSidebar"] > div:first-child { width: 62px !important; min-width: 62px !important; }
      /* COLLAPSED = a bare icon rail: no panel background, no border, no shadow —
         just monochrome icons floating on the page (per the brief). */
      section[data-testid="stSidebar"] {
        background: transparent !important; border-right: none !important; box-shadow: none !important; }
      /* Centre every icon-only control (section rows + the profile popover trigger). */
      section[data-testid="stSidebar"] button[data-testid^="stBaseButton"],
      section[data-testid="stSidebar"] [data-testid="stPopover"] button {
        justify-content: center !important; padding-left: 0 !important; padding-right: 0 !important; }
      section[data-testid="stSidebar"] button[data-testid^="stBaseButton"] > div,
      section[data-testid="stSidebar"] button[data-testid^="stBaseButton"] > div > span,
      section[data-testid="stSidebar"] [data-testid="stPopover"] button > div,
      section[data-testid="stSidebar"] [data-testid="stPopover"] button > div > span,
      section[data-testid="stSidebar"] button [data-testid="stMarkdownContainer"] { justify-content: center !important; }
      /* Hide the text label (icon stays) for both kinds of button. The profile
         trigger's label needs its own equal-specificity rule to beat the expanded
         .78rem set in _POLISH_CSS (this one is injected later, so it wins here). */
      section[data-testid="stSidebar"] button [data-testid="stMarkdownContainer"] p { font-size: 0 !important; }
      section[data-testid="stSidebar"] [data-testid="stPopoverButton"] [data-testid="stMarkdownContainer"] p { font-size: 0 !important; }
      section[data-testid="stSidebar"] button span[role="img"] {
        font-size: 1.15rem !important; margin-right: 0 !important; }
      /* The popover trigger's dropdown caret is noise in the icon rail — hide it. */
      section[data-testid="stSidebar"] [data-testid="stPopover"] button svg { display: none !important; }
      /* No background fills in the collapsed rail — not on hover, not on the active
         section, not on the bell, not on the profile trigger. The active/hover icon
         is signalled by ink colour (from the static rules), never by a coloured pill. */
      section[data-testid="stSidebar"] button[data-testid^="stBaseButton"]:hover,
      section[data-testid="stSidebar"] [data-testid="stPopover"] button:hover,
      section[data-testid="stSidebar"] [class*="st-key-nav_"] button[kind="primary"],
      section[data-testid="stSidebar"] [class*="st-key-nav_"] button[kind="primary"]:hover,
      section[data-testid="stSidebar"] [class*="st-key-notif_bell"] button[kind="primary"],
      section[data-testid="stSidebar"] [class*="st-key-notif_bell"] button[kind="primary"]:hover {
        background: transparent !important; }
      /* Collapsed rail shows no brand mark (matches the reference) — just the
         toggle, the section icons, the bell, and the account (profile) icon. */
      section[data-testid="stSidebar"] .rail-brand-row { display: none !important; }
    """
    expanded_css = """
      section[data-testid="stSidebar"],
      section[data-testid="stSidebar"] > div:first-child { width: 236px !important; min-width: 236px !important; }
    """
    state_css = expanded_css if expanded else rail_css
    st.markdown(
        f"<style>{state_css}\n@media (max-width: 640px) {{{rail_css}}}</style>",
        unsafe_allow_html=True,
    )

    # Night mode: overrides for surfaces the CSS-variable layer can't reach (white
    # sidebar, BaseWeb inputs, popovers…). Injected last so it wins.
    if dark:
        st.markdown(_DARK_CSS, unsafe_allow_html=True)
