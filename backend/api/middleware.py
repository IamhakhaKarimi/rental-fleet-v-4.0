"""Cross-cutting HTTP middleware: rate limiting, body caps, security headers, timing.

Implements layers **L1–L3** of the limiter described in DOCUMENTATION.md §8.3.
(L0 is Nginx; L4 is `api/concurrency.py` — semaphores, not counters.)

Written as **pure ASGI** rather than Starlette's ``BaseHTTPMiddleware``: the latter
spawns an anyio task group and a pair of memory object streams per request, which
is measurable overhead on exactly the hot path this module exists to protect (and
it interferes with background tasks). Pure ASGI is a little more verbose and
strictly cheaper.

Three keys, one bucket implementation. The value is in the different keys, not in
stacking counters:

  * **L1 per-IP** — credential stuffing, scraping, unauthenticated abuse.
  * **L2 per-account** — the layer that matters in an office, where every staff
    member shares one NAT'd public IP, so a per-IP limit is simultaneously too
    coarse (one runaway tab locks out everyone) and too leaky.
  * **L3 per-cost-class** — a 36-page PDF export must not cost the same as a
    health ping.

Algorithm is a **token bucket**, not a fixed window. A fixed window permits a 2x
boundary burst (N requests in the last second of one window plus N in the first
second of the next), while never technically breaching "N per minute".

The limiter is in-process and holds no database state — deliberately, so it stays
dialect-agnostic across the SQLite→Postgres migration (§8.8) and so it never adds
write contention to the resource already under pressure. That makes its counters
**per process**: more uvicorn workers multiply the effective limits.
"""
from __future__ import annotations

import re
import time
import uuid
from threading import Lock
from urllib.parse import urlsplit

from api.monitoring import get_logger, stats
from api.settings import settings

_rl_log = get_logger("ratelimit")
_access_log = get_logger("access")

# Liveness probes are exempt — uptime monitors hit them constantly and a 429 there
# would read as an outage. They expose nothing and cost nothing.
_EXEMPT_PATHS = frozenset({"/api/health"})

_AUTH_PREFIX = "/api/auth"

# ── Cost classes (L3) ────────────────────────────────────────────────────────
# `heavy` is an EXPLICIT list, because it cannot be inferred: an expensive route
# looks exactly like a cheap one from the outside. Anything that renders a PDF,
# serialises the whole database, or decodes an image belongs here.
#
# ⚠️ ADDING A NEW EXPENSIVE ROUTE MEANS ADDING IT HERE. A route that is not listed
# is classified by HTTP method (GET → cheap, otherwise → write), which is the
# right default for ordinary CRUD but will NOT protect a new heavy endpoint.
# Heavy routes must also take the L4 dependency in `api/concurrency.py`.
_HEAVY_SUFFIXES = (".pdf", ".csv", ".sqlite", ".zip")
_HEAVY_SUBSTRINGS = (
    "/data/backup",
    "/data/import",
    "/invoices-batch",
    "/photos",              # upload + gallery fetch (base64 blobs)
    "/settings/logo",
    "/settings/stamp",
)


def classify(method: str, path: str) -> str:
    """Return the cost class for a request: auth | heavy | write | cheap."""
    if path.startswith(_AUTH_PREFIX):
        return "auth"
    if path.endswith(_HEAVY_SUFFIXES) or any(s in path for s in _HEAVY_SUBSTRINGS):
        return "heavy"
    return "cheap" if method in ("GET", "HEAD") else "write"


def _class_limit(klass: str) -> int:
    return {
        "auth": settings.rate_limit_auth_per_min,
        "heavy": settings.rate_limit_heavy_per_min,
        "write": settings.rate_limit_write_per_min,
        "cheap": settings.rate_limit_cheap_per_min,
    }[klass]


# ── Token bucket ─────────────────────────────────────────────────────────────
class _Bucket:
    __slots__ = ("tokens", "last", "rate", "capacity")

    def __init__(self, rate_per_sec: float, capacity: float) -> None:
        self.rate = rate_per_sec
        self.capacity = capacity
        self.tokens = capacity
        self.last = time.monotonic()

    def take(self, now: float) -> tuple[bool, float]:
        """Consume one token. Returns (allowed, seconds_until_next_token)."""
        elapsed = now - self.last
        self.last = now
        self.tokens = min(self.capacity, self.tokens + elapsed * self.rate)
        if self.tokens >= 1.0:
            self.tokens -= 1.0
            return True, 0.0
        deficit = 1.0 - self.tokens
        return False, deficit / self.rate if self.rate > 0 else 60.0


class _BucketStore:
    """Keyed buckets with opportunistic pruning so the dict cannot grow forever
    on a public host seeing high-cardinality source IPs."""

    _PRUNE_AT = 10_000
    _IDLE_S = 300.0

    def __init__(self) -> None:
        self._lock = Lock()
        self._buckets: dict[str, _Bucket] = {}

    def take(self, key: str, per_min: int, burst: int) -> tuple[bool, float]:
        now = time.monotonic()
        with self._lock:
            b = self._buckets.get(key)
            if b is None:
                b = _Bucket(per_min / 60.0, float(max(burst, 1)))
                self._buckets[key] = b
            elif b.rate != per_min / 60.0 or b.capacity != float(max(burst, 1)):
                # Settings changed under us (tuning); re-shape without losing state.
                b.rate = per_min / 60.0
                b.capacity = float(max(burst, 1))
                b.tokens = min(b.tokens, b.capacity)
            allowed, retry = b.take(now)
            if len(self._buckets) > self._PRUNE_AT:
                stale = [k for k, v in self._buckets.items() if now - v.last > self._IDLE_S]
                for k in stale:
                    self._buckets.pop(k, None)
        return allowed, retry


_ip_buckets = _BucketStore()
_account_buckets = _BucketStore()
_class_buckets = _BucketStore()


# ── Scope helpers ────────────────────────────────────────────────────────────
def _header(scope, name: bytes) -> str:
    for k, v in scope.get("headers", []):
        if k == name:
            return v.decode("latin-1")
    return ""


def client_ip(scope) -> str:
    """Best-effort client IP.

    Behind Nginx every request arrives from the proxy, so the real client is the
    first hop of X-Forwarded-For — but ONLY when we are actually behind a proxy.
    Trusting the header unconditionally would let any client spoof its own IP and
    walk straight past L1. See DOCUMENTATION.md §8.2 M2.
    """
    if settings.trust_proxy:
        xff = _header(scope, b"x-forwarded-for")
        if xff:
            return xff.split(",")[0].strip()
        real = _header(scope, b"x-real-ip")
        if real:
            return real.strip()
    c = scope.get("client")
    return c[0] if c else "unknown"


def account_of(scope) -> str:
    """The JWT subject, or '' when unauthenticated.

    Verifies the signature (cheap HMAC) rather than trusting the payload — an
    unverified `sub` would let an attacker pick which account's bucket to spend.
    """
    tok = ""
    cookie = _header(scope, b"cookie")
    if cookie:
        for part in cookie.split(";"):
            name, _, value = part.strip().partition("=")
            if name == settings.cookie_name:
                tok = value
                break
    if not tok:
        auth = _header(scope, b"authorization")
        if auth.startswith("Bearer "):
            tok = auth[7:].strip()
    if not tok:
        return ""
    from api.security import decode_token
    payload = decode_token(tok)
    return (payload or {}).get("sub", "") or ""


async def _send_json(send, status: int, body: bytes, extra_headers=()) -> None:
    headers = [(b"content-type", b"application/json"),
               (b"content-length", str(len(body)).encode())]
    headers.extend(extra_headers)
    await send({"type": "http.response.start", "status": status, "headers": headers})
    await send({"type": "http.response.body", "body": body})


# ── L1–L3: rate limiting ─────────────────────────────────────────────────────
class RateLimitMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or not settings.rate_limit_enabled:
            return await self.app(scope, receive, send)

        path = scope.get("path", "")
        method = scope.get("method", "GET")
        # Preflight carries no credentials and must never be limited, or CORS
        # itself breaks in a way that looks like an app bug.
        if method == "OPTIONS" or path in _EXEMPT_PATHS:
            return await self.app(scope, receive, send)

        ip = client_ip(scope)
        account = account_of(scope)
        klass = classify(method, path)

        checks = [
            ("ip", _ip_buckets, ip,
             settings.rate_limit_ip_per_min, settings.rate_limit_ip_burst),
        ]
        if account:
            checks.append(("account", _account_buckets, account,
                           settings.rate_limit_account_per_min,
                           settings.rate_limit_account_burst))
        # L3 is scoped to the identity, not global — otherwise one user exhausting
        # the heavy budget would lock every other user out of PDFs entirely.
        limit = _class_limit(klass)
        checks.append((f"class:{klass}", _class_buckets,
                       f"{account or ip}:{klass}", limit, max(limit // 2, 1)))

        for layer, store, key, per_min, burst in checks:
            allowed, retry = store.take(key, per_min, burst)
            if not allowed:
                stats.event(f"ratelimit.{layer}")
                _rl_log.warning("limited layer=%s key=%s path=%s %s", layer, key, path, method)
                return await _send_json(
                    send, 429, b'{"detail":"rate_limited"}',
                    [(b"retry-after", str(max(1, int(retry) + 1)).encode())],
                )

        await self.app(scope, receive, send)


# ── CSRF: Origin check for cookie-authenticated writes (M9) ────────────────────
_SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


def _allowed_origins() -> list[str]:
    origins = list(settings.cors_origin_list)
    base = (settings.app_base_url or "").strip().rstrip("/")
    if base and base not in origins:
        origins.append(base)
    return origins


def _origin_allowed(value: str) -> bool:
    """Compare a request's Origin (or Referer, reduced to its origin) against the
    same allow-list CORS uses — exact matches plus the LAN regex when enabled.
    Ships together with the HttpOnly cookie migration: alone, the cookie move
    trades an XSS hole for a CSRF hole, since a forged cross-site page can no
    longer read the token but can still ride the ambient cookie unless the
    request's declared origin is checked server-side."""
    try:
        parts = urlsplit(value)
    except Exception:
        return False
    if not parts.scheme or not parts.netloc:
        return False
    origin = f"{parts.scheme}://{parts.netloc}"
    if origin in _allowed_origins():
        return True
    pattern = settings.cors_origin_regex
    if pattern and re.match(pattern, origin):
        return True
    return False


class CSRFOriginMiddleware:
    """Rejects state-changing requests riding the auth cookie unless their
    declared Origin (falling back to Referer) is on the allow-list.

    Scoped to cookie-authenticated requests only: a Bearer-header caller (an
    explicit remote API client, or dev before the cookie-only migration lands
    on the frontend) cannot be driven by a forged cross-site page in the first
    place — there is no ambient credential for the forged page to ride — so
    checking Origin there would only break legitimate cross-origin API use
    without closing any real gap.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        method = scope.get("method", "GET")
        if method in _SAFE_METHODS:
            return await self.app(scope, receive, send)

        cookie = _header(scope, b"cookie")
        has_session_cookie = False
        if cookie:
            for part in cookie.split(";"):
                name, _, value = part.strip().partition("=")
                if name == settings.cookie_name and value:
                    has_session_cookie = True
                    break
        if not has_session_cookie:
            return await self.app(scope, receive, send)

        candidate = _header(scope, b"origin") or _header(scope, b"referer")
        if not candidate or not _origin_allowed(candidate):
            path = scope.get("path", "")
            stats.event("csrf.blocked")
            _rl_log.warning("csrf blocked origin=%r path=%s %s", candidate, path, method)
            return await _send_json(send, 403, b'{"detail":"csrf_origin_rejected"}')

        await self.app(scope, receive, send)


# ── Request-scoped DB connection (Phase 5 / M3) ─────────────────────────────────
class RequestScopedDBMiddleware:
    """Lets `core.db.db_read()` reuse one connection across every read a
    GET/HEAD request makes, instead of the 57 repository call sites each
    opening their own. Scoped to safe methods only: writes keep their own
    independent `get_engine().begin()` transactions untouched (see core/db.py).

    The connection itself is opened LAZILY inside the request's own sync
    execution (see core/db.py's comment on `_ConnHolder`) — this middleware
    only binds a cheap empty holder before the request and, if something did
    open a connection, closes it afterwards via a worker thread. Both the
    binding and the `await self.app(...)` call stay non-blocking; only the
    close is a real (fast, local) blocking call, dispatched off the loop.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http" or scope.get("method", "GET") not in ("GET", "HEAD"):
            return await self.app(scope, receive, send)

        from core.db import bind_request_connection_holder, reset_request_connection_holder

        holder, token = bind_request_connection_holder()
        try:
            await self.app(scope, receive, send)
        finally:
            reset_request_connection_holder(token)
            if holder.conn is not None:
                import anyio.to_thread

                await anyio.to_thread.run_sync(holder.conn.close)


# ── Request body caps ────────────────────────────────────────────────────────
class BodySizeLimitMiddleware:
    """Reject oversized bodies from the declared Content-Length before reading.

    This is a fast path, not the guarantee: Content-Length may be absent under
    chunked transfer encoding, and a client can lie. The endpoints that read
    bodies enforce the real cap while streaming (see `_read_capped`). Nginx's
    `client_max_body_size` is the outer layer that stops the bytes ever arriving.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        raw = _header(scope, b"content-length")
        if raw.isdigit():
            path = scope.get("path", "")
            cap = (settings.max_import_bytes if "/data/import" in path
                   else settings.max_request_bytes)
            if int(raw) > cap:
                stats.event("body.too_large")
                return await _send_json(send, 413, b'{"detail":"request_too_large"}')
        await self.app(scope, receive, send)


# ── Security headers ─────────────────────────────────────────────────────────
class SecurityHeadersMiddleware:
    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def _send(message):
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                have = {k.lower() for k, _ in headers}
                def add(name: bytes, value: bytes):
                    if name not in have:
                        headers.append((name, value))
                add(b"x-content-type-options", b"nosniff")
                add(b"x-frame-options", b"DENY")
                add(b"referrer-policy", b"strict-origin-when-cross-origin")
                add(b"cross-origin-opener-policy", b"same-origin")
                # Legacy XSS auditor is itself exploitable; modern browsers use CSP.
                add(b"x-xss-protection", b"0")
                # Only advertise HSTS when actually on HTTPS — sending it over
                # plain HTTP on a LAN would pin staff browsers to a scheme the
                # launcher does not serve.
                if settings.cookie_secure:
                    add(b"strict-transport-security",
                        b"max-age=31536000; includeSubDomains")
            await send(message)

        await self.app(scope, receive, _send)


# ── Request id + timing (the Phase 0 instrument) ─────────────────────────────
class RequestContextMiddleware:
    """Assign a request id, time the request, record it, echo X-Request-ID.

    Outermost middleware, so the timings include limiter rejections and the id
    appears on every response — which is what ties a user's screenshot to a log line.
    """

    def __init__(self, app) -> None:
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        rid = uuid.uuid4().hex[:12]
        scope.setdefault("state", {})["request_id"] = rid
        started = time.perf_counter()
        status_holder = {"status": 500}

        async def _send(message):
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                message.setdefault("headers", []).append((b"x-request-id", rid.encode()))
            await send(message)

        try:
            await self.app(scope, receive, _send)
        finally:
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            method = scope.get("method", "?")
            # Key on the route TEMPLATE, not the concrete path, so 300 vehicles
            # produce one bucket instead of 300. path_params is populated by the
            # router during handling (scope is mutated in place).
            path = scope.get("path", "")
            for name, value in (scope.get("path_params") or {}).items():
                path = path.replace(str(value), "{%s}" % name)
            status = status_holder["status"]
            stats.record(f"{method} {path}", elapsed_ms, status)
            _access_log.info("%s %s -> %s %.1fms ip=%s id=%s",
                             method, scope.get("path", ""), status,
                             elapsed_ms, client_ip(scope), rid)
