"""
Primary navigation — a minimalistic **two-state sidebar** (Gemini-style) on the left.

Rendered with native Streamlit widgets inside ``st.sidebar``: a custom collapse
toggle on top, then a brand header (mark + name + tagline), the main sections as
left-aligned icon+label rows, and a bottom-pinned footer with the reminders bell
and a **profile menu** — an ``st.popover`` (account icon + name) that opens a
dropdown holding the Settings and Logout actions (which used to be standalone
footer buttons). A click on the toggle
flips ``session_state['nav_expanded']`` between an EXPANDED label list and a slim
COLLAPSED icon rail — the sidebar is never hidden, so the icons stay reachable, and
page content reflows because the rail keeps a real (non-zero) width. The styling is
fully monochrome (black/white icons, no brand colour): a white surface + rounded
hover highlight + soft neutral-grey active pill (Gemini-style) when EXPANDED, and a
bare icon rail with NO panel background / border / hover-fill when COLLAPSED. All of
that plus the per-state width lives in ui/theme.py (the collapsed rail hides labels
purely in CSS). Section modules still live in views/ (not pages/), so Streamlit
builds no native page menu.

We drive collapse ourselves (Streamlit's native «/» is hidden in ui/theme.py)
because the native control only does full-or-hidden and its state isn't readable
from Python — we need a slim icon rail and must know the state to size it.

Why native buttons (not streamlit-option-menu): that component renders in an iframe
that collapses to 0px on Streamlit 1.58, hiding the nav — native buttons can't fail
that way and style cleanly as sidebar rows.
"""
import html

import streamlit as st
from config.i18n import t, init_lang
from config.roles import can, ROLE_LABEL_KEY
from config.settings import APP_TAGLINE, APP_VERSION
from data.repositories import app_settings as app_cfg
from ui import auth_view
from ui.notifications import render_bell

# (page key, translation key, icon). Icons are Material Symbols rendered via
# Streamlit's `:material/<name>:` directive — clean, monochrome line icons that
# inherit the button's text colour (ink when idle, emerald when the section is
# active), matching the minimalist Gemini-style rail.
NAV_ITEMS = [
    ("dashboard",    "nav_dashboard",    ":material/home:"),
    ("reservations", "nav_reservations", ":material/calendar_month:"),
    ("fleet",        "nav_fleet",        ":material/directions_car:"),
    ("customers",    "nav_customers",    ":material/group:"),
    ("finance",      "nav_finance",      ":material/payments:"),
    ("settings",     "nav_settings",     ":material/settings:"),
]

# Pages a plain visitor must never see (management surface area).
_MANAGEMENT_PAGES = {"reservations", "fleet", "customers"}


def _initial(s: str, fallback: str = "B") -> str:
    s = (s or "").strip()
    return s[:1].upper() if s else fallback


def top_nav(user, cookie_mgr, cookies) -> str:
    """Render the two-state navigation sidebar: a collapse toggle, brand header,
    the main sections as icon+label rows (icons-only when collapsed), then a
    bottom-pinned footer with the reminders bell and the profile menu (an
    st.popover holding Settings + Logout). Returns the selected page key.

    Sections, role-gating, widget keys and routing are unchanged — only the
    presentation (expanded list ⇄ collapsed icon rail) is driven from here +
    ui/theme.py via session_state['nav_expanded']."""
    def _hidden(k: str) -> bool:
        # Visitors (level 0) get no management pages — Reservations/Fleet/Customers
        # are hidden, leaving Home + Settings. Finance stays admin+.
        if k == "finance" and not can(user, "view_finance"):
            return True
        if k in _MANAGEMENT_PAGES and not can(user, "view_management"):
            return True
        return False

    with st.sidebar:
        # Custom collapse/expand toggle. Streamlit's native one is hidden in
        # ui/theme.py and only does full/hidden; ours switches between an expanded
        # label list and a slim icon rail (and Python can't read the native state,
        # so we must own it). inject_theme() reads this same flag to size the rail.
        expanded = st.session_state.setdefault("nav_expanded", True)
        if st.button(":material/menu_open:" if expanded else ":material/menu:",
                     key="nav_toggle", use_container_width=True):
            st.session_state.nav_expanded = not expanded
            st.rerun()

        # Brand header: mark + name + tagline
        business = app_cfg.get_business_name()
        st.markdown(
            f'<div class="rail-brand-row" title="{html.escape(business)} · {APP_TAGLINE} v{APP_VERSION}">'
            f'<div class="rail-brand-mark">{_initial(business)}</div>'
            f'<div class="rail-brand-text">'
            f'<div class="rbt-name">{html.escape(business)}</div>'
            f'<div class="rbt-tag">{html.escape(APP_TAGLINE)}</div>'
            f'</div></div>',
            unsafe_allow_html=True,
        )

        valid = [k for k, _, _ in NAV_ITEMS if not _hidden(k)]
        if st.session_state.get("current_page") not in valid:
            st.session_state.current_page = "dashboard"

        # Main sections (icon-only; Settings is pinned in the footer below)
        for key, label_key, emoji in NAV_ITEMS:
            if key == "settings" or _hidden(key):
                continue
            is_active = st.session_state.current_page == key
            if st.button(f"{emoji} {t(label_key)}", key=f"nav_{key}", help=t(label_key),
                         type="primary" if is_active else "secondary",
                         use_container_width=True):
                if not is_active:
                    st.session_state.current_page = key
                    st.rerun()

        # Spacer pushes the footer group to the bottom of the rail
        st.markdown('<div class="rail-spacer"></div>', unsafe_allow_html=True)

        # Footer: reminders bell · profile menu (Settings + Logout in a dropdown)
        if can(user, "create_reservation"):
            render_bell(user)

        # Account row is now a CLICK-TO-OPEN dropdown (st.popover): the trigger shows
        # the account icon + name (icon-only when the rail is collapsed, via theme
        # CSS) and the panel holds the Settings and Logout actions — replacing the
        # old standalone footer settings/logout buttons. Esc / outside-click closes
        # it; either action st.rerun()s, which also dismisses the popover.
        name = user["full_name"] or user["username"]
        role_label = t(ROLE_LABEL_KEY.get(user["role"], "role_visitor"))
        with st.popover(f":material/account_circle: {name}", help=name,
                        use_container_width=True):
            st.markdown(
                f'<div class="acct-card">'
                f'<div class="acct-name">{html.escape(name)}</div>'
                f'<div class="acct-role">{html.escape(role_label)}</div>'
                f'</div>',
                unsafe_allow_html=True,
            )
            if st.button(f":material/settings: {t('nav_settings')}", key="menu_settings",
                         help=t("nav_settings"), use_container_width=True):
                st.session_state.current_page = "settings"
                st.rerun()
            if st.button(f":material/logout: {t('logout')}", key="logout_btn",
                         help=t("logout"), use_container_width=True):
                auth_view.logout(cookie_mgr, cookies)

    return st.session_state.current_page
