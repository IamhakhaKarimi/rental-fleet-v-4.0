"""L4 — concurrency limiting for expensive operations.

**Rate limits bound arrivals; semaphores bound residency.** This distinction is the
whole reason this module exists separately from `api/middleware.py`. A limit of
"10 PDF exports per minute" does nothing to stop ten *simultaneous* 36-page
exports, because ten per minute is a perfectly legal rate — and those ten requests
occupy ten worker threads for the entire duration of the render. Only a semaphore
bounds that. See DOCUMENTATION.md §8.4.

Two semaphores, acquired in a deliberate order:

  * **per-user** — so no single account can occupy the global pool. This is the
    "one user's over-stimulated process threads" control specifically.
  * **global** — so the box as a whole cannot be saturated.

Per-user is taken *first*: it is normally uncontended and cheap, and acquiring the
scarce global slot before a cheap one we might not get would mean holding the
scarce resource while waiting on the plentiful one.

At the cap, a request waits a bounded time and then gets 429 + Retry-After. It is
never queued indefinitely — an unbounded queue does not remove the stall, it just
relocates it and burns memory on the way.
"""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import Depends, HTTPException, status

from api.deps import get_current_user
from api.monitoring import get_logger, stats
from api.settings import settings

_log = get_logger("concurrency")

_global_sem: asyncio.Semaphore | None = None
_user_sems: dict[str, asyncio.Semaphore] = {}
_lock = asyncio.Lock()


def _global() -> asyncio.Semaphore:
    global _global_sem
    if _global_sem is None:
        _global_sem = asyncio.Semaphore(max(1, settings.heavy_concurrency_global))
    return _global_sem


async def _for_user(username: str) -> asyncio.Semaphore:
    async with _lock:
        sem = _user_sems.get(username)
        if sem is None:
            sem = asyncio.Semaphore(max(1, settings.heavy_concurrency_per_user))
            _user_sems[username] = sem
        return sem


async def _acquire(sem: asyncio.Semaphore, timeout: float, layer: str) -> None:
    try:
        await asyncio.wait_for(sem.acquire(), timeout=timeout)
    except (asyncio.TimeoutError, TimeoutError):
        stats.event(f"concurrency.rejected.{layer}")
        _log.warning("heavy slot exhausted layer=%s", layer)
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            detail="server_busy",
            headers={"Retry-After": str(max(1, int(timeout)))},
        )


@asynccontextmanager
async def heavy_operation(username: str):
    """Hold a heavy-operation slot for the duration of the block."""
    timeout = settings.heavy_acquire_timeout_s
    user_sem = await _for_user(username or "anonymous")
    await _acquire(user_sem, timeout, "per_user")
    try:
        await _acquire(_global(), timeout, "global")
    except BaseException:
        # Never leak the per-user slot when the global acquire fails or is cancelled.
        user_sem.release()
        raise
    try:
        yield
    finally:
        _global().release()
        user_sem.release()


async def heavy_slot(user: dict = Depends(get_current_user)):
    """FastAPI dependency gating an expensive route.

    Use on every route classified `heavy` in `api/middleware.classify` — PDF
    builds, `/api/data/*` backups, imports, photo uploads. The slot is held for
    the whole handler, so a sync `def` endpoint keeps it while running in the
    worker thread, which is exactly the residency we are bounding.
    """
    async with heavy_operation(user.get("username", "")):
        yield user
