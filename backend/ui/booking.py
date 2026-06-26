"""
Booking panel + rental registration popup.

The availability search (dates -> list of free cars) stays inline. The actual
"Quick Rental Registration" form now lives in a centered **popup** (st.dialog)
opened by a primary button under the car list — and by a "Rent" button on each
available-vehicle card on the Overview page. The popup shows the start/return
dates dynamically and lets the operator pick the invoice language.

Creating a reservation is gated by the 'create_reservation' permission (Employee
role / id 'employer' and above).
"""

from datetime import datetime, time, timedelta

import streamlit as st

from config.i18n import t
from config.roles import can
from config.settings import DEFAULT_PICKUP_HOUR, DEFAULT_RENTAL_DAYS, CURRENCY_SYMBOL, LANGUAGES
from ui.components import section_header, format_eur
from ui.invoice import render_invoice
from services.scheduling_service import available_vehicles, is_vehicle_free
from services import audit_service
from services import licensing_service as lic
from data.repositories import rentals as rentals_repo

_DLG_KEYS = ("sd", "red", "stt", "nd", "rtt", "cn", "cp", "ci", "rate", "dep", "ilang")


def _uppercase_css(*field_keys: str):
    """Render the given text inputs in ALL CAPS (visual only) so staff never need to
    hold Caps Lock for the customer personal-info fields. Targets each widget by its
    Streamlit ``st-key-<key>`` wrapper class. The stored value is also upper-cased on
    save (see the form bodies), so the data — and the invoice — stay all-caps too."""
    sel = ", ".join(f".st-key-{k} input" for k in field_keys)
    st.markdown(f"<style>{sel} {{ text-transform: uppercase; }}</style>",
                unsafe_allow_html=True)


def _date_days_cluster(*, sd_key, rd_key, stt_key, nd_key, rtt_key,
                       default_start=None, default_days=None):
    """Render start date · return date · start time · number of days · return time,
    keeping the **return date** and **number of days** in two-way sync: change the
    day count and the return date follows; pick a return date and the day count
    recomputes. Both are clamped to the licensed window. Returns
    (req_start, req_end, num_days)."""
    today = datetime.today().date()
    start_default = default_start or today
    days_default = int(default_days or DEFAULT_RENTAL_DAYS)
    maxd = lic.max_date()

    st.session_state.setdefault(sd_key, start_default)
    st.session_state.setdefault(nd_key, days_default)
    st.session_state.setdefault(stt_key, time(DEFAULT_PICKUP_HOUR, 0))
    st.session_state.setdefault(rtt_key, time(DEFAULT_PICKUP_HOUR, 0))
    st.session_state.setdefault(rd_key, min(start_default + timedelta(days=days_default), maxd))

    def _from_days():
        sd = st.session_state[sd_key]
        nd = int(st.session_state[nd_key])
        rd = sd + timedelta(days=nd)
        if rd > maxd:                       # don't book past the licensed year
            rd, nd = maxd, max((maxd - sd).days, 1)
            st.session_state[nd_key] = nd
        st.session_state[rd_key] = rd

    def _from_return():
        sd = st.session_state[sd_key]
        rd = st.session_state[rd_key]
        nd = (rd - sd).days
        if nd < 1:                          # return must be after start
            nd = 1
            st.session_state[rd_key] = sd + timedelta(days=1)
        st.session_state[nd_key] = min(nd, 180)

    st.date_input(t("start_date"), key=sd_key, max_value=maxd, on_change=_from_days)
    st.date_input(t("return_date"), key=rd_key,
                  min_value=st.session_state[sd_key], max_value=maxd,
                  on_change=_from_return)
    d1, d2 = st.columns(2)
    d1.time_input(t("start_time"), key=stt_key)
    d2.number_input(t("days"), min_value=1, max_value=180, step=1,
                    key=nd_key, on_change=_from_days)
    st.time_input(t("return_time"), key=rtt_key)

    sd = st.session_state[sd_key]
    req_start = datetime.combine(sd, st.session_state[stt_key])
    req_end = datetime.combine(st.session_state[rd_key], st.session_state[rtt_key])
    return req_start, req_end, int(st.session_state[nd_key])


def _invoice_dialog_body(key_prefix: str, deal_id: str):
    """Popup contents: the print-ready invoice for the freshly created rental."""
    st.success(f'{t("register_ok")} · {deal_id}')
    render_invoice(deal_id, key_prefix=key_prefix)
    if st.button(t("close_btn"), key=f"{key_prefix}_close_inv",
                 use_container_width=True):
        st.session_state.pop(f"{key_prefix}_last_deal", None)
        st.rerun()


def _render_invoice_result(key_prefix: str):
    """After a rental is created, show its print-ready invoice in a popup dialog."""
    deal_id = st.session_state.get(f"{key_prefix}_last_deal")
    if not deal_id:
        return
    st.dialog(t("show_invoice"), width="large")(_invoice_dialog_body)(key_prefix, deal_id)


def _rental_form_body(user, key_prefix: str):
    """The popup contents: the date/time/rate selection (left) and the customer
    personal info (right) SIDE BY SIDE, then save — rather than one long vertical
    flow. Personal-info fields render in ALL CAPS."""
    veh = st.session_state.get(f"{key_prefix}_dlg_vehicle")
    if not veh:
        return
    def_start, def_days = st.session_state.get(f"{key_prefix}_dlg_def") or (None, None)

    st.markdown(
        f':material/directions_car: **{veh["vehicle_id"]} · {veh["make_model"]}** · '
        f'{veh.get("license_plate") or "—"} · {format_eur(veh["base_daily_rate"])}/{t("per_day")}'
    )
    _uppercase_css(f"{key_prefix}_dlg_cn", f"{key_prefix}_dlg_cp", f"{key_prefix}_dlg_ci")

    left, right = st.columns(2, gap="large")

    # Right = the date/time selection. Rendered first so `days` is available to the
    # live total in the left ("client form") column.
    with right:
        req_start, req_end, days = _date_days_cluster(
            sd_key=f"{key_prefix}_dlg_sd", rd_key=f"{key_prefix}_dlg_red",
            stt_key=f"{key_prefix}_dlg_stt", nd_key=f"{key_prefix}_dlg_nd",
            rtt_key=f"{key_prefix}_dlg_rtt",
            default_start=def_start, default_days=def_days)
        st.markdown(
            f'<div class="return-box"><div class="lbl">{t("calculated_return")}</div>'
            f'<div class="val">{req_start.strftime("%d.%m.%Y %H:%M")} &rarr; '
            f'{req_end.strftime("%d.%m.%Y %H:%M")}</div></div>',
            unsafe_allow_html=True,
        )

    # Left = the full client form: personal info, then rate / deposit / invoice
    # language / live total beneath it.
    with left:
        name = st.text_input(t("client_name"), key=f"{key_prefix}_dlg_cn")
        phone = st.text_input(t("client_phone"), key=f"{key_prefix}_dlg_cp")
        cidno = st.text_input(t("client_id"), key=f"{key_prefix}_dlg_ci")
        r1, r2 = st.columns(2)
        default_rate = int(round(veh["base_daily_rate"] / 100))
        rate = r1.number_input(f'{t("negotiated_rate")} ({CURRENCY_SYMBOL})', min_value=0,
                               value=default_rate, step=5, key=f"{key_prefix}_dlg_rate")
        deposit = r2.number_input(f'{t("deposit")} ({CURRENCY_SYMBOL})', min_value=0, value=0,
                                  step=10, key=f"{key_prefix}_dlg_dep")
        inv_lang = st.selectbox(t("invoice_language"), list(LANGUAGES),
                                format_func=lambda l: LANGUAGES[l],
                                key=f"{key_prefix}_dlg_ilang")
        rate_cents = int(rate) * 100
        total_cents = rate_cents * int(days)
        st.metric(t("live_total"), format_eur(total_cents),
                  delta=f'{int(days)} × {format_eur(rate_cents)}', delta_color="off")

    if st.button(t("register_btn"), type="primary", use_container_width=True,
                 key=f"{key_prefix}_dlg_save"):
        name_v, phone_v, id_v = name.strip().upper(), phone.strip().upper(), cidno.strip().upper()
        if not name_v or not phone_v:
            st.warning(t("register_need_fields"))
        elif not is_vehicle_free(veh["vehicle_id"], req_start, req_end):
            st.error(t("not_available_window"))
        else:
            deal_id = rentals_repo.create_rental(
                vehicle_id=veh["vehicle_id"], make_model=veh["make_model"],
                client_name=name_v, phone=phone_v, id_passport=id_v,
                start_dt=req_start, end_dt=req_end, days=int(days),
                daily_rate_cents=rate_cents, deposit_cents=int(deposit) * 100,
                created_by=user.get("username", ""),
                created_by_name=user.get("full_name") or user.get("username", ""),
                created_by_role=user.get("role", ""),
                invoice_lang=inv_lang,
            )
            audit_service.record(user, "create_rental", "rental", deal_id,
                                 f'{veh["vehicle_id"]} · {name_v}')
            st.session_state[f"{key_prefix}_last_deal"] = deal_id
            st.session_state.pop(f"{key_prefix}_dlg_vehicle", None)
            st.rerun()


def open_rental_dialog(user, key_prefix: str, vehicle: dict,
                       default_start=None, default_days=None):
    """Open the rental popup for `vehicle`. Call this from a button's if-block."""
    st.session_state[f"{key_prefix}_dlg_vehicle"] = vehicle
    st.session_state[f"{key_prefix}_dlg_def"] = (default_start, default_days)
    # clear any prior popup field state so it opens fresh
    for suf in _DLG_KEYS:
        st.session_state.pop(f"{key_prefix}_dlg_{suf}", None)
    # dynamic title via the dialog decorator applied at call time
    st.dialog(t("quick_register"), width="large")(_rental_form_body)(user, key_prefix)


def render_last_invoice(key_prefix: str):
    """Public hook: after an add-reservation save, show the print-ready invoice
    dialog (used by the Reservations page, which no longer renders the inline
    booking panel but still needs the post-save invoice popup)."""
    _render_invoice_result(key_prefix)


def _add_reservation_body(user, key_prefix: str):
    """Single-dialog 'Add reservation' flow: availability dates -> the cars free
    for that window -> customer details -> save. The date/time/rate selection (left)
    and the customer personal info (right) render SIDE BY SIDE rather than as one
    long vertical flow; personal-info fields are ALL CAPS. Merges the availability
    search and the rental form into ONE dialog so it never nests dialogs (the inline
    booking panel opens a second dialog from its Register button, which can't be
    done from inside a dialog)."""
    _uppercase_css(f"{key_prefix}_add_cn", f"{key_prefix}_add_cp", f"{key_prefix}_add_ci")

    def _label(c):
        return (f'{c["vehicle_id"]} · {c["make_model"]} · '
                f'{format_eur(c["base_daily_rate"])} · {c["license_plate"] or "—"}')

    left, right = st.columns(2, gap="large")

    # Right = date/time selection + the car free for that window. Rendered first so
    # `picked` / `num_days` are available to the left ("client form") column.
    with right:
        req_start, req_end, num_days = _date_days_cluster(
            sd_key=f"{key_prefix}_add_sd", rd_key=f"{key_prefix}_add_red",
            stt_key=f"{key_prefix}_add_stt", nd_key=f"{key_prefix}_add_nd",
            rtt_key=f"{key_prefix}_add_rtt")
        st.markdown(
            f'<div class="return-box"><div class="lbl">{t("calculated_return")}</div>'
            f'<div class="val">{req_start.strftime("%d.%m.%Y %H:%M")} &rarr; '
            f'{req_end.strftime("%d.%m.%Y %H:%M")}</div></div>',
            unsafe_allow_html=True,
        )
        cars = available_vehicles(req_start, req_end)
        if not cars:
            st.info(t("no_cars"))
            return
        picked = st.selectbox(t("select_car"), options=cars, format_func=_label,
                              key=f"{key_prefix}_add_car")

    # Left = the full client form: personal info, then rate / deposit / invoice
    # language / live total beneath it.
    with left:
        name = st.text_input(t("client_name"), key=f"{key_prefix}_add_cn")
        phone = st.text_input(t("client_phone"), key=f"{key_prefix}_add_cp")
        cidno = st.text_input(t("client_id"), key=f"{key_prefix}_add_ci")
        r1, r2 = st.columns(2)
        default_rate = int(round(picked["base_daily_rate"] / 100))
        # Rate widget is keyed by the picked car, so its default follows the selection.
        rate = r1.number_input(f'{t("negotiated_rate")} ({CURRENCY_SYMBOL})', min_value=0,
                               value=default_rate, step=5,
                               key=f'{key_prefix}_add_rate_{picked["vehicle_id"]}')
        deposit = r2.number_input(f'{t("deposit")} ({CURRENCY_SYMBOL})', min_value=0, value=0,
                                  step=10, key=f"{key_prefix}_add_dep")
        inv_lang = st.selectbox(t("invoice_language"), list(LANGUAGES),
                                format_func=lambda l: LANGUAGES[l], key=f"{key_prefix}_add_ilang")
        rate_cents = int(rate) * 100
        total_cents = rate_cents * int(num_days)
        st.metric(t("live_total"), format_eur(total_cents),
                  delta=f'{int(num_days)} × {format_eur(rate_cents)}', delta_color="off")

    if st.button(t("register_btn"), type="primary", use_container_width=True,
                 key=f"{key_prefix}_add_save"):
        name_v, phone_v, id_v = name.strip().upper(), phone.strip().upper(), cidno.strip().upper()
        if not name_v or not phone_v:
            st.warning(t("register_need_fields"))
        elif not is_vehicle_free(picked["vehicle_id"], req_start, req_end):
            st.error(t("not_available_window"))
        else:
            deal_id = rentals_repo.create_rental(
                vehicle_id=picked["vehicle_id"], make_model=picked["make_model"],
                client_name=name_v, phone=phone_v, id_passport=id_v,
                start_dt=req_start, end_dt=req_end, days=int(num_days),
                daily_rate_cents=rate_cents, deposit_cents=int(deposit) * 100,
                created_by=user.get("username", ""),
                created_by_name=user.get("full_name") or user.get("username", ""),
                created_by_role=user.get("role", ""),
                invoice_lang=inv_lang,
            )
            audit_service.record(user, "create_rental", "rental", deal_id,
                                 f'{picked["vehicle_id"]} · {name_v}')
            st.session_state[f"{key_prefix}_last_deal"] = deal_id
            st.rerun()


def open_add_reservation_dialog(user, key_prefix: str = "res"):
    """Open the combined add-reservation popup. Call from a button's if-block."""
    # Clear any prior field state so the popup opens fresh.
    for suf in ("add_sd", "add_red", "add_stt", "add_nd", "add_rtt", "add_car",
                "add_cn", "add_cp", "add_ci", "add_dep", "add_ilang"):
        st.session_state.pop(f"{key_prefix}_{suf}", None)
    # The negotiated-rate widget is keyed per vehicle (..._add_rate_<vid>) so the
    # default follows the selected car — that dynamic key can't be listed above,
    # so sweep any leftover rate keys too, else a custom rate typed last time
    # pre-fills instead of the newly-picked car's base rate.
    for k in [k for k in st.session_state if k.startswith(f"{key_prefix}_add_rate_")]:
        st.session_state.pop(k, None)
    st.dialog(t("quick_register"), width="large")(_add_reservation_body)(user, key_prefix)


def render_booking_panel(user, key_prefix: str = "bk"):
    _render_invoice_result(key_prefix)
    left, right = st.columns([1, 1.4], gap="large")

    with left:
        section_header("availability_title", "availability_help")
        req_start, req_end, num_days = _date_days_cluster(
            sd_key=f"{key_prefix}_sd", rd_key=f"{key_prefix}_red",
            stt_key=f"{key_prefix}_st", nd_key=f"{key_prefix}_nd",
            rtt_key=f"{key_prefix}_rt")
        start_date = req_start.date()
        st.markdown(
            f'<div class="return-box"><div class="lbl">{t("calculated_return")}</div>'
            f'<div class="val">{req_end.strftime("%d.%m.%Y")} · {req_end.strftime("%H:%M")}</div></div>',
            unsafe_allow_html=True,
        )

    with right:
        section_header("available_cars", "")
        cars = available_vehicles(req_start, req_end)
        if not cars:
            st.info(t("no_cars"))
            return

        def _label(c):
            return f'{c["vehicle_id"]} · {c["make_model"]} · {format_eur(c["base_daily_rate"])} · {c["license_plate"] or "—"}'

        picked = st.selectbox(t("select_car"), options=cars, format_func=_label, key=f"{key_prefix}_car")

        if not can(user, "create_reservation"):
            st.info(t("no_create_perm"))
            return

        if st.button(f':material/add: {t("open_rental_btn")}', type="primary",
                     use_container_width=True, key=f"{key_prefix}_open"):
            open_rental_dialog(user, key_prefix, picked,
                               default_start=start_date, default_days=num_days)
