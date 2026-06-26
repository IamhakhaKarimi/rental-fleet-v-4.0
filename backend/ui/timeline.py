"""
Fleet occupancy timeline — the signature view.

One horizontal row per vehicle; each rental is a bar across a continuous time
axis. Premium, airy redesign (inspired by modern planning tools):
  - A toolbar on top: Day / Week / Month / Year zoom presets, a ‹ range › pager
    with a Today jump, a "Show done" toggle (also plots returned/closed rentals,
    greyed), and a compact search box (~2/12 width) that filters the bars.
  - Bars are minimal "cards": a white surface with a status-coloured LEFT accent
    (calm grey while safe, amber within 24h, red once overdue) and the client
    name in ink — flat colours, no gradients or connectors, dark-on-light text
    for contrast. Done rentals render muted.
  - A clean, labelled "now" line; mouse-wheel pans (never zooms) on desktop,
    pinch-zoom on touch. Motion respects prefers-reduced-motion.
Built on vis-timeline (MIT), loaded from a CDN in the browser.
"""

import html as _html
import json
from datetime import datetime, timedelta

import streamlit as st
import streamlit.components.v1 as components

from config.i18n import t
from config.settings import DEFAULT_LANG
from services.scheduling_service import return_state

# rental return-state -> CSS class on the timeline bar (active rentals only)
_STATE_CLASS = {"overdue": "overdue", "due_soon": "duesoon", "ok": "rented"}


def render_timeline(vehicles: list[dict], rentals: list[dict]):
    """Render the occupancy timeline. `rentals` may include closed/returned ones
    (status != 'Active'); those are tagged `done` and hidden until the toolbar's
    "Show done" toggle is on."""
    lang = st.session_state.get("lang", DEFAULT_LANG)

    def _group_label(v: dict) -> str:
        label = v["make_model"]
        plate = (v.get("license_plate") or "").strip()
        if plate:
            label += f' · {plate}'
        return label

    groups = [{"id": v["vehicle_id"], "content": _group_label(v)} for v in vehicles]

    now = datetime.now()
    items = []
    for r in rentals:
        status = r.get("status") or "Active"
        is_done = status != "Active"
        if is_done:
            cls = "done"
        else:
            state, _ = return_state(r["end_dt"], now)
            cls = _STATE_CLASS.get(state, "rented")
        tip = (
            f'<b>{r["client_name"]}</b><br>'
            f'{t("col_id")}: {r["vehicle_id"]} · {r.get("license_plate") or "—"} — {r["make_model"]}<br>'
            f'{t("client_phone")}: {r["phone"]}<br>'
            f'{r["start_dt"][:16].replace("T", " ")} → {r["end_dt"][:16].replace("T", " ")}<br>'
            f'{r["deal_id"]}'
        )
        search = " ".join(str(r.get(k) or "") for k in (
            "client_name", "vehicle_id", "make_model", "license_plate", "phone", "deal_id"
        )).lower()
        # Single-line label — client name + short period (dd.mm–dd.mm) inline — so
        # the bar stays slim and elegant (≈40% shorter than the old two-line card)
        # while the period rides quietly alongside the name.
        sdm = f'{r["start_dt"][8:10]}.{r["start_dt"][5:7]}'
        edm = f'{r["end_dt"][8:10]}.{r["end_dt"][5:7]}'
        content = (f'<span class="ti-name">{_html.escape(str(r["client_name"] or ""))}</span>'
                   f'<span class="ti-time">{sdm}–{edm}</span>')
        items.append({
            "id": r["deal_id"], "group": r["vehicle_id"],
            "start": r["start_dt"], "end": r["end_dt"],
            "content": content, "title": tip,
            "className": cls, "_done": is_done, "_search": search,
        })

    # Initial window ≈ one month centred on now (the "Month" preset).
    win_start = (now - timedelta(days=12)).strftime("%Y-%m-%d")
    win_end = (now + timedelta(days=19)).strftime("%Y-%m-%d")
    now_label = t("now_label")
    # Slimmer bars → tighter rows: was 120 + n*58, now a more compact rhythm.
    height_px = max(260, 108 + len(groups) * 46)

    labels = {
        "day": t("view_day"), "week": t("view_week"), "month": t("view_month"),
        "year": t("view_year"), "today": t("view_today"),
        "show_done": t("show_done"), "search": t("search"),
    }

    # Palette follows the app's night-mode toggle so the embedded timeline isn't a
    # bright block on a dark page. `on_ink` is the text colour on an --ink fill
    # (white on dark ink in day mode; dark on light ink in night mode).
    dark = bool(st.session_state.get("dark_mode", False))
    if dark:
        ink, text, muted, border = "#E8E6E3", "#E8E6E3", "#A1A1AA", "#34343A"
        surface, bg, done = "#232427", "#17181A", "#3A3B40"
        axis_txt, grid_minor, grid_major = "#A1A1AA", "#34343A", "#52535A"
        bg_duesoon, bg_overdue, tx_overdue, on_ink = "#3A2E1B", "#3A1F1F", "#FCA5A5", "#17181A"
        sh_dark = "rgba(0,0,0,.5)"
        stripe_col = "rgba(255,255,255,.05)"
        br_ok, br_warn, br_alert, br_done = "#E8E6E3", "#D97706", "#EF4444", "#52535A"
    else:
        ink, text, muted, border = "#1A1C1E", "#211C17", "#6B7280", "#EAE8E3"
        surface, bg, done = "#fff", "#FBFAF8", "#C7C3BA"
        axis_txt, grid_minor, grid_major = "#4B5563", "#D8D5CE", "#A9A399"
        bg_duesoon, bg_overdue, tx_overdue, on_ink = "#FDF1DF", "#FBE4E4", "#7F1D1D", "#fff"
        sh_dark = "rgba(16,24,40,.12)"
        stripe_col = "rgba(0,0,0,.045)"
        br_ok, br_warn, br_alert, br_done = "#1A1C1E", "#B45309", "#B91C1C", "#C7C3BA"

    html = f"""
    <!DOCTYPE html><html><head><meta charset="utf-8"/>
      <script src="https://unpkg.com/vis-timeline@7.7.3/standalone/umd/vis-timeline-graph2d.min.js"></script>
      <link href="https://unpkg.com/vis-timeline@7.7.3/styles/vis-timeline-graph2d.min.css" rel="stylesheet"/>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap');
        :root {{
          --ink:{ink}; --text:{text}; --muted:{muted}; --border:{border};
          --surface:{surface}; --bg:{bg};
          --ok:#6B7280; --warn:#D97706; --alert:#DC2626; --done:{done};
        }}
        * {{ box-sizing:border-box; }}
        body {{ margin:0; font-family:'Plus Jakarta Sans',system-ui,sans-serif; background:{bg}; color:var(--text); }}

        /* ── toolbar ─────────────────────────────────────────────────────── */
        #tlbar {{ display:flex; align-items:center; gap:12px; flex-wrap:wrap;
            padding:8px 4px 12px; }}
        .seg {{ display:inline-flex; background:var(--bg); border:1px solid var(--border);
            border-radius:11px; padding:3px; gap:2px; }}
        .seg button {{ border:none; background:transparent; color:var(--muted);
            font:600 12.5px 'Plus Jakarta Sans',sans-serif; padding:5px 12px; border-radius:8px;
            cursor:pointer; transition:background .18s ease, color .18s ease; }}
        .seg button:hover {{ color:var(--ink); }}
        .seg button.active {{ background:var(--ink); color:{on_ink}; }}
        .nav {{ display:inline-flex; align-items:center; gap:8px; }}
        .nav .arrow {{ width:30px; height:30px; border:1px solid var(--border); background:var(--surface);
            border-radius:9px; cursor:pointer; color:var(--ink); font-size:16px; line-height:1;
            display:flex; align-items:center; justify-content:center; transition:border-color .18s, background .18s; }}
        .nav .arrow:hover {{ border-color:var(--ink); background:var(--bg); }}
        #rangelbl {{ font:600 13px 'Plus Jakarta Sans',sans-serif; color:var(--ink);
            min-width:128px; text-align:center; font-variant-numeric:tabular-nums; }}
        #today {{ border:none; background:transparent; color:var(--muted); cursor:pointer;
            font:600 12.5px 'Plus Jakarta Sans',sans-serif; padding:5px 8px; border-radius:8px; }}
        #today:hover {{ color:var(--ink); background:var(--bg); }}
        .spacer {{ flex:1 1 auto; }}
        .toggle {{ display:inline-flex; align-items:center; gap:7px; color:var(--muted);
            font:600 12.5px 'Plus Jakarta Sans',sans-serif; cursor:pointer; user-select:none; }}
        .toggle input {{ appearance:none; -webkit-appearance:none; width:34px; height:19px; border-radius:999px;
            background:#D8D5CE; position:relative; cursor:pointer; transition:background .2s ease; outline:none; }}
        .toggle input::after {{ content:''; position:absolute; top:2px; left:2px; width:15px; height:15px;
            border-radius:50%; background:#fff; box-shadow:0 1px 2px rgba(0,0,0,.25); transition:left .2s ease; }}
        .toggle input:checked {{ background:var(--ink); }}
        .toggle input:checked::after {{ left:17px; }}
        #search {{ width:clamp(120px, 16%, 220px); border:1px solid var(--border); background:var(--surface);
            border-radius:9px; padding:7px 11px; font:500 12.5px 'Plus Jakarta Sans',sans-serif;
            color:var(--text); outline:none; transition:border-color .18s, box-shadow .18s; }}
        #search:focus {{ border-color:var(--ink); box-shadow:0 0 0 3px rgba(26,28,30,.08); }}
        #search::placeholder {{ color:#9AA1A9; }}

        /* ── the timeline surface ───────────────────────────────────────── */
        #tl {{ border:1px solid var(--border); border-radius:14px; padding:6px; background:var(--surface); }}
        .vis-timeline {{ border:none; font-family:'Plus Jakarta Sans',system-ui,sans-serif; }}
        .vis-labelset .vis-label {{ color:var(--ink); font-weight:600; font-size:12.5px; }}
        /* Day/month separating legends — darker so the calendar grid reads clearly. */
        .vis-time-axis .vis-text {{ color:{axis_txt}; font-size:11px; }}
        .vis-time-axis .vis-text.vis-major {{ color:var(--ink); font-weight:700; font-size:11.5px; }}
        .vis-time-axis .vis-grid.vis-minor {{ border-color:{grid_minor}; }}
        .vis-time-axis .vis-grid.vis-major {{ border-color:{grid_major}; }}

        /* Slim scheduler cards: a status-tinted surface with a hairline ink border
           (a darker shade of the status), whisper-soft diagonal texture, softly
           rounded rectangle corners and a single inline label (client + period).
           ~40% shorter than the old two-line card — quiet, premium, legible. */
        .vis-item {{ background-color:var(--surface);
            background-image:repeating-linear-gradient(45deg, transparent 0, transparent 8px, {stripe_col} 8px, {stripe_col} 16px);
            border:1.5px solid {br_ok}; border-radius:9px; color:var(--text);
            font-size:11px; font-weight:600; padding:2.5px 11px; min-height:0;
            box-shadow:0 1px 2px {sh_dark}, inset 0 1px 0 rgba(255,255,255,.35);
            transition:box-shadow .2s cubic-bezier(.22,1,.36,1), transform .2s cubic-bezier(.22,1,.36,1), border-color .2s ease; }}
        .vis-item:hover {{ box-shadow:0 6px 16px -8px {sh_dark}; transform:translateY(-1px); }}
        .vis-item.vis-selected {{ box-shadow:0 0 0 2px rgba(26,28,30,.5); }}
        .vis-item .vis-item-content {{ padding:0; display:flex; align-items:baseline;
            gap:7px; white-space:nowrap; overflow:hidden; }}
        .ti-name {{ font-weight:700; line-height:1.45; letter-spacing:-.01em;
            overflow:hidden; text-overflow:ellipsis; }}
        .ti-time {{ font-size:9.5px; font-weight:600; opacity:.58; line-height:1.45;
            font-variant-numeric:tabular-nums; flex:0 0 auto; }}
        .vis-item.rented  {{ background-color:var(--surface); border-color:{br_ok}; }}
        .vis-item.duesoon {{ background-color:{bg_duesoon}; border-color:{br_warn}; }}
        .vis-item.overdue {{ background-color:{bg_overdue}; border-color:{br_alert}; color:{tx_overdue}; }}
        .vis-item.done    {{ background-color:var(--bg); border-color:{br_done}; color:#9AA1A9; }}

        .vis-tooltip {{ font-family:'Plus Jakarta Sans',system-ui,sans-serif !important; font-size:12px !important;
            background:var(--ink) !important; color:{on_ink} !important; border:none !important;
            border-radius:9px !important; padding:9px 12px !important; line-height:1.5 !important;
            box-shadow:0 10px 25px -5px rgba(0,0,0,.35) !important; }}

        /* labelled "now" line: thin ink rule + a small pill at the top */
        .vis-custom-time.nowline {{ background-color:var(--ink); width:2px; }}
        .vis-custom-time.nowline .vis-custom-time-marker {{
            top:0 !important; bottom:auto !important; background:var(--ink); color:{on_ink};
            font-size:10px; font-weight:700; letter-spacing:.05em; padding:2px 7px;
            border-radius:6px; white-space:nowrap; cursor:default; }}

        /* tap-info panel (touch devices have no hover tooltip) */
        #tlinfo {{ display:none; margin-top:8px; background:var(--ink); color:{on_ink};
            border-radius:9px; padding:9px 12px; font-size:12px; line-height:1.5; position:relative; }}
        #tlinfo.show {{ display:block; }}
        #tlinfo .close {{ position:absolute; top:6px; right:10px; cursor:pointer; font-weight:700; color:#9CA3AF; }}

        @media (prefers-reduced-motion: reduce) {{
          .vis-item, .seg button, #search, .toggle input, .toggle input::after {{ transition:none !important; }}
        }}
        @media (max-width:640px) {{
          #rangelbl {{ min-width:96px; font-size:12px; }}
          #search {{ width:100%; order:9; }}
        }}
      </style>
    </head><body>
      <div id="tlbar">
        <div class="seg" id="views">
          <button data-span="day">{labels["day"]}</button>
          <button data-span="week">{labels["week"]}</button>
          <button data-span="month">{labels["month"]}</button>
          <button data-span="year">{labels["year"]}</button>
        </div>
        <div class="nav">
          <button class="arrow" id="prev" title="prev">&lsaquo;</button>
          <span id="rangelbl"></span>
          <button class="arrow" id="next" title="next">&rsaquo;</button>
          <button id="today">{labels["today"]}</button>
        </div>
        <div class="spacer"></div>
        <label class="toggle"><input type="checkbox" id="showdone"/>{labels["show_done"]}</label>
        <input id="search" placeholder="{labels["search"]}"/>
      </div>

      <div id="tlwrap"><div id="tl"></div></div>
      <div id="tlinfo"><span class="close" onclick="this.parentNode.classList.remove('show')">&times;</span><div id="tlinfo-body"></div></div>

      <script>
        var GROUPS = {json.dumps(groups)};
        var ALL    = {json.dumps(items)};
        var LANG   = {json.dumps(lang)};
        var SPAN_DAYS = {{ day:1.2, week:7, month:31, year:365 }};

        var groups = new vis.DataSet(GROUPS);
        var dataset = new vis.DataSet();
        var isTouch = window.matchMedia('(pointer: coarse)').matches || ('ontouchstart' in window);
        var options = {{
          stack:false, orientation:{{ axis:'top' }}, showCurrentTime:false,
          zoomable:isTouch, moveable:true, horizontalScroll:!isTouch,
          margin:{{ item:8, axis:8 }},
          start:'{win_start}', end:'{win_end}',
          tooltip:{{ followMouse:true, overflowMethod:'flip' }},
          xss:{{ disabled:true }}
        }};
        window.tl = new vis.Timeline(document.getElementById('tl'), dataset, groups, options);
        window.tl.addCustomTime(new Date(), 'nowline');
        window.tl.setCustomTimeMarker('{now_label}', 'nowline', false);

        var searchEl = document.getElementById('search');
        var doneEl = document.getElementById('showdone');
        function visibleItems() {{
          var q = (searchEl.value || '').trim().toLowerCase();
          var sd = doneEl.checked;
          return ALL.filter(function(it) {{
            if (it._done && !sd) return false;
            if (q && it._search.indexOf(q) === -1) return false;
            return true;
          }});
        }}
        function applyFilters() {{ dataset.clear(); dataset.add(visibleItems()); }}
        searchEl.addEventListener('input', applyFilters);
        doneEl.addEventListener('change', applyFilters);
        applyFilters();

        // ── view presets (Day/Week/Month/Year): re-centre on the current window ──
        function setView(span, animate) {{
          var w = window.tl.getWindow();
          var center = (w.start.getTime() + w.end.getTime()) / 2;
          var half = (SPAN_DAYS[span] * 864e5) / 2;
          window.tl.setWindow(new Date(center - half), new Date(center + half),
                              {{ animation: animate !== false }});
          document.querySelectorAll('#views button').forEach(function(b) {{
            b.classList.toggle('active', b.dataset.span === span);
          }});
        }}
        document.querySelectorAll('#views button').forEach(function(b) {{
          b.addEventListener('click', function() {{ setView(b.dataset.span); }});
        }});
        function shift(dir) {{
          var w = window.tl.getWindow(); var span = w.end.getTime() - w.start.getTime();
          window.tl.setWindow(new Date(w.start.getTime() + dir * span),
                              new Date(w.end.getTime() + dir * span), {{ animation:true }});
        }}
        document.getElementById('prev').addEventListener('click', function() {{ shift(-1); }});
        document.getElementById('next').addEventListener('click', function() {{ shift(1); }});
        document.getElementById('today').addEventListener('click', function() {{
          var w = window.tl.getWindow(); var span = w.end.getTime() - w.start.getTime();
          var now = Date.now();
          window.tl.setWindow(new Date(now - span / 2), new Date(now + span / 2), {{ animation:true }});
        }});

        // ── range label (localised), updated as the window moves ────────────
        var fmt;
        try {{ fmt = new Intl.DateTimeFormat(LANG, {{ day:'numeric', month:'short' }}); }}
        catch (e) {{ fmt = new Intl.DateTimeFormat('en', {{ day:'numeric', month:'short' }}); }}
        function updateLabel() {{
          var w = window.tl.getWindow();
          var end = new Date(w.end.getTime() - 1);
          document.getElementById('rangelbl').textContent = fmt.format(w.start) + ' – ' + fmt.format(end);
        }}
        window.tl.on('rangechanged', updateLabel);
        setView('month', false);
        updateLabel();

        // Touch devices have no hover tooltip — show details on tap/select.
        var infoBox = document.getElementById('tlinfo');
        var infoBody = document.getElementById('tlinfo-body');
        window.tl.on('select', function (props) {{
          if (props.items && props.items.length) {{
            var it = dataset.get(props.items[0]);
            if (it && it.title) {{ infoBody.innerHTML = it.title; infoBox.classList.add('show'); return; }}
          }}
          infoBox.classList.remove('show');
        }});
      </script>
    </body></html>
    """
    # toolbar (~52px) + timeline + tap-info room
    components.html(html, height=height_px + 190, scrolling=False)
