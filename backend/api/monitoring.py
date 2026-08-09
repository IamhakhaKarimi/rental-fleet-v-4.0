"""Request logging + in-process latency statistics.

Two jobs:

  * ``get_logger`` — named loggers with a consistent format, so an access line and
    a rate-limit rejection are greppable together.
  * ``RequestStats`` — a bounded, in-memory latency recorder keyed by route
    template. This is the **Phase 0 measurement instrument** (DOCUMENTATION.md
    §8.10): every tuning number in §8.7 is supposed to come from real timings, and
    this is what produces them. It is deliberately cheap enough to leave running in
    production, which also makes it the evidence source for the SQLite→Postgres
    migration trigger in §8.8.

Keyed by the route *template* (``/api/vehicles/{vehicle_id}/thumb``), never the
concrete path, so 300 vehicles produce one bucket instead of 300.
"""
from __future__ import annotations

import logging
import sys
import threading
from bisect import insort
from collections import defaultdict

_configured = False

# Keep at most this many samples per route. Percentiles over a bounded reservoir
# are close enough for tuning decisions and cap memory at a known ceiling.
_MAX_SAMPLES = 1000


def _configure() -> None:
    global _configured
    if _configured:
        return
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter(
        "%(asctime)s %(levelname)-7s %(name)-18s %(message)s",
        datefmt="%H:%M:%S",
    ))
    root = logging.getLogger("bcr")
    root.setLevel(logging.INFO)
    root.handlers = [handler]
    root.propagate = False
    _configured = True


def get_logger(name: str) -> logging.Logger:
    _configure()
    return logging.getLogger(f"bcr.{name}")


class RequestStats:
    """Latency samples per (method, route template), plus slow/error counters."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._samples: dict[str, list[float]] = defaultdict(list)
        self._count: dict[str, int] = defaultdict(int)
        self._errors: dict[str, int] = defaultdict(int)
        # Non-latency counters worth watching: limiter rejections, concurrency
        # rejections, and SQLite lock waits (the §8.8 migration trigger).
        self._events: dict[str, int] = defaultdict(int)

    def record(self, key: str, ms: float, status: int) -> None:
        with self._lock:
            self._count[key] += 1
            if status >= 500:
                self._errors[key] += 1
            bucket = self._samples[key]
            if len(bucket) < _MAX_SAMPLES:
                insort(bucket, ms)
            else:
                # Reservoir is full: keep the tail that matters. Replacing the
                # median keeps the distribution's shape while letting new
                # outliers in, which is what tuning cares about.
                mid = len(bucket) // 2
                if ms > bucket[mid]:
                    bucket.pop(mid)
                    insort(bucket, ms)

    def event(self, name: str) -> None:
        with self._lock:
            self._events[name] += 1

    @staticmethod
    def _pct(sorted_samples: list[float], pct: float) -> float:
        if not sorted_samples:
            return 0.0
        idx = min(len(sorted_samples) - 1, int(round((pct / 100.0) * len(sorted_samples)) - 1))
        return sorted_samples[max(0, idx)]

    def snapshot(self) -> dict:
        """Current percentiles per route, slowest first — the Phase 0 report."""
        with self._lock:
            routes = []
            for key, samples in self._samples.items():
                routes.append({
                    "route": key,
                    "count": self._count[key],
                    "errors": self._errors[key],
                    "p50_ms": round(self._pct(samples, 50), 1),
                    "p95_ms": round(self._pct(samples, 95), 1),
                    "p99_ms": round(self._pct(samples, 99), 1),
                    "max_ms": round(samples[-1], 1) if samples else 0.0,
                })
            events = dict(self._events)
        routes.sort(key=lambda r: r["p95_ms"], reverse=True)
        return {"routes": routes, "events": events}

    def reset(self) -> None:
        with self._lock:
            self._samples.clear()
            self._count.clear()
            self._errors.clear()
            self._events.clear()


stats = RequestStats()
