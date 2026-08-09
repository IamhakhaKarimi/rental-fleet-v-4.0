"""Phase 0 component benchmark — DOCUMENTATION.md §8.10.

Times the expensive operations directly (no HTTP, no auth) and counts the SQL
work each one does. These numbers are what the provisional limits in
api/settings.py are supposed to be replaced with.

Run from the bench replica directory:  python bench_components.py
"""
from __future__ import annotations

import statistics
import time
from contextlib import contextmanager

from sqlalchemy import event

from core.db import get_engine, init_db

init_db()
ENGINE = get_engine()

_counters = {"queries": 0, "checkouts": 0}


@event.listens_for(ENGINE, "before_cursor_execute")
def _count_query(conn, cursor, statement, params, context, executemany):
    _counters["queries"] += 1


@event.listens_for(ENGINE, "checkout")
def _count_checkout(dbapi_conn, conn_record, conn_proxy):
    _counters["checkouts"] += 1


@contextmanager
def measure():
    _counters["queries"] = 0
    _counters["checkouts"] = 0
    started = time.perf_counter()
    box = {}
    yield box
    box["ms"] = (time.perf_counter() - started) * 1000.0
    box["queries"] = _counters["queries"]
    box["checkouts"] = _counters["checkouts"]


def run(label: str, fn, repeats: int = 5) -> dict:
    samples, q, c = [], 0, 0
    err = None
    for _ in range(repeats):
        try:
            with measure() as m:
                fn()
            samples.append(m["ms"])
            q, c = m["queries"], m["checkouts"]
        except Exception as exc:  # keep going; report what failed
            err = f"{type(exc).__name__}: {exc}"
            break
    if err:
        return {"label": label, "error": err}
    return {
        "label": label,
        "p50_ms": round(statistics.median(samples), 1),
        "max_ms": round(max(samples), 1),
        "queries": q,
        "checkouts": c,
    }


def main() -> None:
    from data.repositories import admin_ops
    from data.repositories import app_settings as app_cfg
    from data.repositories import rentals as rrepo
    from data.repositories import vehicles as vrepo
    from data.repositories import customers as crepo
    from ui.pdf import build_invoice_pdf, build_timeline_pdf
    from ui.invoice import build_invoice_html

    biz, logo, stamp = app_cfg.get_business_name(), app_cfg.get_logo(), app_cfg.get_stamp()
    deals = rrepo.list_all_rentals_with_vehicle()
    deal_id = deals[0]["deal_id"] if deals else None
    print(f"dataset: {len(vrepo.list_vehicles())} vehicles, "
          f"{len(crepo.list_customers())} customers, {len(deals)} rentals\n")

    results = []

    # ---- Read paths (what a page load costs) --------------------------------
    results.append(run("READ  list_vehicles()", lambda: vrepo.list_vehicles(), 10))
    results.append(run("READ  list_customers()  [7 correlated subqueries/row]",
                       lambda: crepo.list_customers(), 10))
    results.append(run("READ  list_customers_enriched()  [4/row]",
                       lambda: crepo.list_customers_enriched(), 10))
    results.append(run("READ  list_all_rentals_with_vehicle()",
                       lambda: rrepo.list_all_rentals_with_vehicle(), 10))

    # ---- Heavy paths --------------------------------------------------------
    if deal_id:
        ctx = (rrepo.get_rental_full(deal_id), rrepo.list_charges_for_deal(deal_id))

        results.append(run("HEAVY invoice HTML (1 deal)",
                           lambda: build_invoice_html(ctx[0], ctx[1], biz, "tr", logo, stamp), 5))
        results.append(run("HEAVY invoice PDF (1 deal, 2 A4 copies)",
                           lambda: build_invoice_pdf(ctx[0], ctx[1], biz, "tr", logo, stamp), 5))

    fleet = vrepo.list_vehicles()
    active = rrepo.list_active_rentals_with_vehicle()
    from datetime import datetime, timedelta
    now = datetime.now()

    def timeline(months: int):
        start = datetime(now.year, now.month, 1)
        windows = []
        for i in range(months):
            y, m = divmod((start.year * 12 + start.month - 1) + i, 12)
            m += 1
            nxt_y, nxt_m = divmod((y * 12 + m - 1) + 1, 12)
            windows.append((datetime(y, m, 1), datetime(nxt_y, nxt_m + 1, 1), f"{m}/{y}"))
        return lambda: build_timeline_pdf(fleet, active, windows, "tr", biz)

    results.append(run("HEAVY timeline PDF  1 month  (1 page)", timeline(1), 5))
    results.append(run("HEAVY timeline PDF  12 months (12 pages)", timeline(12), 3))
    results.append(run("HEAVY timeline PDF  36 months (_MAX_MONTH_PAGES)", timeline(36), 3))

    results.append(run("HEAVY admin_ops.export_all()  [whole DB snapshot]",
                       lambda: admin_ops.export_all(), 5))

    # ---- Photo encode (the event-loop offender) -----------------------------
    try:
        import io
        from PIL import Image
        from ui.photos import encode_photo

        class _B:
            def __init__(self, raw): self._raw = raw
            def getvalue(self): return self._raw

        for dim, name in ((1600, "2MP"), (4000, "12MP (modern phone)")):
            buf = io.BytesIO()
            Image.new("RGB", (dim, int(dim * 0.75)), (90, 120, 160)).save(buf, "JPEG", quality=88)
            raw = buf.getvalue()
            results.append(run(f"HEAVY encode_photo {name} ({len(raw)//1024} KB)",
                               lambda r=raw: encode_photo(_B(r)), 3))
    except Exception as exc:
        results.append({"label": "encode_photo", "error": str(exc)})

    # ---- Report -------------------------------------------------------------
    print(f"{'operation':<52} {'p50 ms':>9} {'max ms':>9} {'SQL':>6} {'conns':>6}")
    print("-" * 88)
    for r in results:
        if "error" in r:
            print(f"{r['label']:<52} {'ERROR':>9}  {r['error'][:40]}")
        else:
            print(f"{r['label']:<52} {r['p50_ms']:>9} {r['max_ms']:>9} "
                  f"{r['queries']:>6} {r['checkouts']:>6}")


if __name__ == "__main__":
    main()
