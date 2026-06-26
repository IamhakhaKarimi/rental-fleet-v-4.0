"""
Return reminders — a notification bell with a numbered badge.

The bell sits in the top bar for staff (Employee and above). Its badge counts
rentals that are overdue (:material/error: alarm) or due back within 24 h (:material/schedule: alert). Clicking
it opens a minimalist popup listing each one with the customer's phone (copyable)
and one-tap WhatsApp message/call links so staff can chase the return.
"""

import re
import urllib.parse

import streamlit as st

from config.i18n import t
from config.roles import can
from services.scheduling_service import return_state, DUE_SOON_HOURS
from services import licensing_service as lic
from data.repositories import rentals as rrepo


def _digits(phone: str) -> str:
    return re.sub(r"\D", "", phone or "")


def _wa_link(phone: str, message: str = "") -> str:
    d = _digits(phone)
    if not d:
        return ""
    url = f"https://wa.me/{d}"
    if message:
        url += "?text=" + urllib.parse.quote(message)
    return url


def _classify(active_rentals):
    overdue, soon = [], []
    for r in active_rentals:
        state, hrs = return_state(r["end_dt"])
        if state == "overdue":
            overdue.append((r, hrs))
        elif state == "due_soon":
            soon.append((r, hrs))
    overdue.sort(key=lambda x: -x[1])
    soon.sort(key=lambda x: x[1])
    return overdue, soon


def _license_renewal_row():
    """A renewal reminder shown when the license deadline is within the notice
    window. Only rendered for users who can manage the license."""
    days = lic.days_until_deadline()
    deadline = lic.max_date().strftime("%d.%m.%Y")
    with st.container(border=True):
        st.markdown(f':material/workspace_premium: **{t("notif_license_title")}**')
        st.caption(t("notif_license_msg").format(date=deadline, days=days))


def _notifications_body(active_rentals, show_license=False):
    overdue, soon = _classify(active_rentals)
    license_due = show_license and lic.renewal_due()
    if not overdue and not soon and not license_due:
        st.success(t("no_reminders"))
        return

    if license_due:
        st.markdown(f'#### :material/workspace_premium: {t("notif_license_title")}')
        _license_renewal_row()

    def _row(r, hrs, kind):
        icon = ":material/error: " if kind == "overdue" else ":material/schedule: "
        when = (t("notif_overdue_by") if kind == "overdue" else t("notif_due_in")).format(h=hrs)
        end = (r["end_dt"] or "")[:16].replace("T", " ")
        msg = t("wa_reminder").format(name=r["client_name"], car=r["make_model"], due=end)
        with st.container(border=True):
            st.markdown(f'{icon} **{r["client_name"]}** — {r["vehicle_id"]} · {r["make_model"]}')
            st.caption(f'{t("col_period")}: → {end} · {when}')
            st.caption(t("phone_copy_hint"))
            st.code(r.get("phone") or "—", language=None)   # built-in copy button
            wa = _wa_link(r.get("phone"), msg)
            if wa:
                cwa, ccall = st.columns(2)
                cwa.link_button(f':material/chat: {t("whatsapp_msg")}', wa, use_container_width=True)
                ccall.link_button(f':material/call: {t("whatsapp_call")}', _wa_link(r.get("phone")),
                                  use_container_width=True)

    if overdue:
        st.markdown(f'#### :material/error: {t("notif_overdue_title")} ({len(overdue)})')
        for r, h in overdue:
            _row(r, h, "overdue")
    if soon:
        st.markdown(f'#### :material/schedule: {t("notif_due_soon_title").format(n=DUE_SOON_HOURS)} ({len(soon)})')
        for r, h in soon:
            _row(r, h, "due_soon")


def render_bell(user):
    """Top-bar notification bell + a dynamic numbered badge; opens the reminders
    popup on click."""
    active = rrepo.list_active_rentals_with_vehicle()
    overdue, soon = _classify(active)
    # License-renewal nudge: only for users who can manage the license, and only
    # within the renewal-notice window (60 days before the licensed-year deadline).
    show_license = can(user, "edit_business_settings") and lic.renewal_due()
    n = len(overdue) + len(soon) + (1 if show_license else 0)
    # Material line icon (matches the nav rail) + a text LABEL so the bell reads as a
    # proper row when the sidebar is expanded (the label is hidden in the collapsed
    # icon rail by ui/theme.py). The pending count now rides a real badge (below)
    # instead of being appended to the label, so it shows in the collapsed rail too.
    text = t("notifications_title")
    label = f":material/notifications: {text}"
    btn_type = "primary" if (overdue or show_license) else "secondary"

    # Dynamic numbered badge: a small red counter pinned to the bell's top-right.
    # Streamlit tags the button's container with the CSS class `st-key-notif_bell`;
    # we attach a ::after badge whose number is injected per run (the live count is
    # known here). It shows for both overdue and due-soon items, caps at "9+", and is
    # click-through (pointer-events:none) so it never blocks the button.
    if n:
        badge = "9+" if n > 9 else str(n)
        st.markdown(
            f"""<style>
            [class*="st-key-notif_bell"] {{ position: relative; }}
            [class*="st-key-notif_bell"]::after {{
                content: "{badge}";
                position: absolute; top: 1px; right: 7px;
                min-width: 18px; height: 18px; padding: 0 5px;
                background: var(--danger, #DC2626); color: #fff;
                font-family: var(--font-display, sans-serif);
                font-size: 11px; font-weight: 700; line-height: 18px;
                text-align: center; border-radius: 999px;
                box-shadow: 0 0 0 2px #fff; z-index: 5; pointer-events: none;
            }}
            </style>""",
            unsafe_allow_html=True,
        )

    if st.button(label, key="notif_bell", help=t("notifications_title"),
                 type=btn_type, use_container_width=True):
        st.dialog(t("notifications_title"), width="large")(_notifications_body)(active, show_license)
