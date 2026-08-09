"""
Finance service — turns the raw ledgers into the numbers the Finance page shows.

Income comes from the `charges` table (rental + overdue_penalty + damage; the
deposit/refund types are excluded from revenue). Costs come from the
`vehicle_costs` table via the vehicle_costs repository. This module joins the two
so the UI can show income, cost, and net profit by month, by year, and by
vehicle — all in INTEGER cents.
"""
from sqlalchemy import text
from core.db import get_engine
from data.repositories import vehicle_costs as costs_repo
from data.repositories import compensations as comp_repo

# Charge types that count as revenue (deposits/refunds are NOT income).
# 'damage' plus the other compensation types (mechanic_fee, traffic_fine, …)
# are money billed back to a client — see data/repositories/compensations.py.
_REVENUE_TYPES = "('rental','overdue_penalty'," + ",".join(f"'{t}'" for t in comp_repo.COMPENSATION_TYPES) + ")"


_COMPENSATION_TYPES_SQL = "(" + ",".join(f"'{t}'" for t in comp_repo.COMPENSATION_TYPES) + ")"


# ── Income ───────────────────────────────────────────────────────────────────
def revenue_summary() -> dict:
    sql = f"""SELECT
        COALESCE(SUM(CASE WHEN type='rental'          THEN amount END),0) AS rental,
        COALESCE(SUM(CASE WHEN type='overdue_penalty' THEN amount END),0) AS penalty,
        COALESCE(SUM(CASE WHEN type IN {_COMPENSATION_TYPES_SQL} THEN amount END),0) AS compensation
    FROM charges WHERE deleted_at IS NULL"""
    with get_engine().connect() as conn:
        row = conn.execute(text(sql)).mappings().first()
    r, p, c = row["rental"], row["penalty"], row["compensation"]
    return {"rental": r, "penalty": p, "damage": c, "total": r + p + c}


def revenue_by_vehicle() -> list[dict]:
    sql = f"""SELECT c.vehicle_id, v.make_model,
               COALESCE(SUM(CASE WHEN c.type IN {_REVENUE_TYPES}
                                 THEN c.amount END),0) AS revenue
             FROM charges c
             LEFT JOIN vehicles v ON v.vehicle_id=c.vehicle_id
             WHERE c.deleted_at IS NULL
             GROUP BY c.vehicle_id,v.make_model
             HAVING revenue>0
             ORDER BY revenue DESC"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]


def revenue_by_customer() -> list[dict]:
    """Revenue collected per customer (name + phone), joining the charges ledger
    through rentals to customers. Only revenue charge types count; deposits and
    refunds are excluded. `damage` (all compensation types) and `penalty` break
    out the compensation and overdue (due-date) charges so they can be shown in
    their own columns. Sorted by revenue descending."""
    sql = f"""SELECT cu.customer_id, cu.full_name, cu.phone,
                     COALESCE(SUM(CASE WHEN c.type IN {_REVENUE_TYPES}
                                       THEN c.amount END),0) AS revenue,
                     COALESCE(SUM(CASE WHEN c.type IN {_COMPENSATION_TYPES_SQL}
                                       THEN c.amount END),0) AS damage,
                     COALESCE(SUM(CASE WHEN c.type='overdue_penalty'
                                       THEN c.amount END),0) AS penalty,
                     COUNT(DISTINCT r.deal_id) AS rentals
             FROM charges c
             JOIN rentals   r  ON r.deal_id     = c.deal_id
             JOIN customers cu ON cu.customer_id = r.customer_id
             WHERE c.deleted_at IS NULL
             GROUP BY cu.customer_id, cu.full_name, cu.phone
             HAVING revenue > 0
             ORDER BY revenue DESC"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]


def revenue_by_type_for_month(month: str) -> list[dict]:
    """Income grouped by charge type for a single calendar month ('YYYY-MM')."""
    sql = f"""SELECT type, COALESCE(SUM(amount),0) AS amount
              FROM charges
              WHERE type IN {_REVENUE_TYPES}
                AND deleted_at IS NULL
                AND strftime('%Y-%m', occurred_at) = :m
              GROUP BY type ORDER BY amount DESC"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql), {"m": month}).mappings().all()]


def month_breakdown(month: str) -> dict:
    """Full income/cost picture for one calendar month ('YYYY-MM'): headline
    income, cost and net totals plus the per-type breakdowns that drive the
    Monthly tab's month drill-down."""
    income_rows = revenue_by_type_for_month(month)
    cost_rows = costs_repo.cost_by_type_for_month(month)
    income = sum(r["amount"] for r in income_rows)
    cost = sum(r["amount"] for r in cost_rows)
    return {"month": month, "income": income, "cost": cost, "net": income - cost,
            "income_by_type": income_rows, "cost_by_type": cost_rows}


def revenue_by_month() -> list[dict]:
    sql = f"""SELECT strftime('%Y-%m', occurred_at) AS month,
                    SUM(CASE WHEN type IN {_REVENUE_TYPES}
                             THEN amount ELSE 0 END) AS revenue
             FROM charges
             WHERE deleted_at IS NULL
             GROUP BY month ORDER BY month"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]


def revenue_by_year() -> list[dict]:
    sql = f"""SELECT strftime('%Y', occurred_at) AS year,
                    SUM(CASE WHEN type IN {_REVENUE_TYPES}
                             THEN amount ELSE 0 END) AS revenue
             FROM charges
             WHERE deleted_at IS NULL
             GROUP BY year ORDER BY year"""
    with get_engine().connect() as conn:
        return [dict(r) for r in conn.execute(text(sql)).mappings().all()]


# ── Costs (delegated to the vehicle_costs repository) ────────────────────────
def cost_total() -> int:
    return costs_repo.cost_total()


def cost_by_type() -> list[dict]:
    return costs_repo.cost_by_type()


# ── Combined P&L (income − cost) ─────────────────────────────────────────────
def _merge(income_rows: list[dict], cost_rows: list[dict], key: str) -> list[dict]:
    """Union income and cost rows on a period key into income/cost/net rows."""
    inc = {r[key]: r.get("revenue", 0) or 0 for r in income_rows}
    cst = {r[key]: r.get("cost", 0) or 0 for r in cost_rows}
    periods = sorted(set(inc) | set(cst))
    out = []
    for p in periods:
        i, c = inc.get(p, 0), cst.get(p, 0)
        out.append({"period": p, "income": i, "cost": c, "net": i - c})
    return out


def pnl_summary() -> dict:
    income = revenue_summary()["total"]
    cost = cost_total()
    net = income - cost
    margin = (net / income * 100.0) if income else 0.0
    return {"income": income, "cost": cost, "net": net, "margin": margin}


def pnl_by_month() -> list[dict]:
    return _merge(revenue_by_month(), costs_repo.cost_by_month(), "month")


def pnl_by_year() -> list[dict]:
    return _merge(revenue_by_year(), costs_repo.cost_by_year(), "year")


def profit_by_vehicle() -> list[dict]:
    """Per-vehicle income, cost, and net profit — sorted by net descending."""
    inc = {r["vehicle_id"]: r for r in revenue_by_vehicle()}
    cst = {r["vehicle_id"]: r for r in costs_repo.cost_by_vehicle()}
    rows = []
    for vid in set(inc) | set(cst):
        i = (inc.get(vid) or {}).get("revenue", 0) or 0
        c = (cst.get(vid) or {}).get("cost", 0) or 0
        model = (inc.get(vid) or cst.get(vid) or {}).get("make_model") or "—"
        rows.append({"vehicle_id": vid, "make_model": model,
                     "income": i, "cost": c, "net": i - c})
    rows.sort(key=lambda r: r["net"], reverse=True)
    return rows
