/**
 * Tiny fetch wrapper for the FastAPI backend.
 *
 * Auth: the HttpOnly `bcr_session` cookie is the normal path — same-origin
 * (production) or same-host-different-port (dev), where `SameSite=Strict`
 * still flows, because SameSite ignores the port. The token is never written to
 * `localStorage`/`sessionStorage` anymore (M9: an XSS payload that can read
 * disk used to just lift the session outright). The one case a token is
 * still kept, in memory only, is an explicit REMOTE `VITE_API_BASE` — a
 * genuinely cross-site
 * deployment where the cookie cannot follow, so the Bearer header is the
 * only way auth works at all, and losing it on refresh is expected there.
 */
/**
 * Where the API lives. Three cases, in priority order:
 *
 *   unset / "same-origin"   THE DEFAULT, and what both dev and production use.
 *                  Returns "" — every call site does `${apiBase()}${path}` and
 *                  path already starts with "/api", so it resolves as a plain
 *                  relative fetch. In production Nginx proxies /api to uvicorn;
 *                  in development the Vite dev server proxies it (vite.config.ts).
 *   <remote url>   an API on a genuinely different origin. Used verbatim, and
 *                  it is the only case that turns on the in-memory Bearer token
 *                  (see usesRemoteApi) because the cookie cannot follow there.
 *   <loopback url> explicit escape hatch for running the frontend without the
 *                  proxy. Note the host must MATCH the one in the address bar:
 *                  a page on localhost:3000 talking to 127.0.0.1:8001 is
 *                  cross-site as far as the cookie is concerned, and
 *                  SameSite=Strict silently drops it — you get a clean login
 *                  followed by 401s. Preferring the proxy avoids the whole trap.
 *
 * `VITE_API_BASE` is inlined by Vite at BUILD time, so a production build made
 * with it set to a dev value would ship that value.
 */
const CONFIGURED_BASE = (import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
const LOOPBACK = /^(localhost|127(?:\.\d+){3}|\[?::1\]?)$/i;
const SAME_ORIGIN = "same-origin";

function configuredUrl(): URL | null {
  try {
    return new URL(CONFIGURED_BASE);
  } catch {
    return null;
  }
}

export function apiBase(): string {
  // Unset is same-origin, not a guessed localhost port: both servers that ever
  // serve this app proxy /api for us.
  if (!CONFIGURED_BASE || CONFIGURED_BASE === SAME_ORIGIN) return "";

  const u = configuredUrl();
  // A real remote API was configured — always use it as given.
  if (u && !LOOPBACK.test(u.hostname)) return CONFIGURED_BASE;

  return CONFIGURED_BASE;
}

let authToken: string | null = null;

/** True only for an explicit, genuinely remote API base — see apiBase() above. */
function usesRemoteApi(): boolean {
  const u = configuredUrl();
  return !!u && !LOOPBACK.test(u.hostname);
}

/**
 * Hold the access token in memory for this page load. Never written to disk:
 * the cookie is the durable session now, so there is nothing to persist across
 * a reload in the normal (same-origin / same-host) case. Only kept at all when
 * `usesRemoteApi()` — a cross-site deployment where the cookie cannot follow
 * and the Bearer header is the only way auth works.
 */
export function setAuthToken(token: string | null) {
  authToken = usesRemoteApi() ? token : null;
}

export function loadAuthToken(): string | null {
  return usesRemoteApi() ? authToken : null;
}

export class ApiError extends Error {
  status: number;
  key: string;
  constructor(status: number, key: string) {
    super(key);
    this.status = status;
    this.key = key;
  }
}

interface ApiOpts {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  raw?: boolean; // return Response instead of parsed body
  keepalive?: boolean; // let the request outlive the page (see beginUnloadFlush)
}

/**
 * A normal `fetch()` is cancelled when the page it belongs to goes away, so
 * anything fired from a `pagehide`/`beforeunload` handler — a pending delete
 * being flushed before a refresh, say — would never reach the server. Calling
 * this once, at the top of such a handler, marks every request that follows
 * `keepalive`, which the browser keeps in flight through the unload.
 *
 * One-way on purpose: it is only ever set while the document is being torn
 * down, and the fresh page load starts with a fresh module.
 */
let unloadFlush = false;
export function beginUnloadFlush() {
  unloadFlush = true;
}

export async function api<T = any>(path: string, opts: ApiOpts = {}): Promise<T> {
  const headers: Record<string, string> = { ...(opts.headers || {}) };
  const token = loadAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    if (opts.body instanceof FormData) {
      body = opts.body;
    } else {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
  }

  const res = await fetch(`${apiBase()}${path}`, {
    method: opts.method || "GET",
    credentials: "include",
    headers,
    body,
    keepalive: opts.keepalive || unloadFlush,
  });

  if (opts.raw) return res as unknown as T;

  if (!res.ok) {
    let key = `http_${res.status}`;
    try {
      const data = await res.json();
      if (data?.detail) key = typeof data.detail === "string" ? data.detail : JSON.stringify(data.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, key);
  }

  if (res.status === 204) return undefined as T;
  const ct = res.headers.get("content-type") || "";
  return (ct.includes("application/json") ? res.json() : res.text()) as Promise<T>;
}

/**
 * Paginated GET (M5). `path` must already carry `page`/`page_size` — this
 * just also reads back the pre-slice `X-Total-Count` header a paginated list
 * endpoint sets, so a table view can build page controls without the body
 * shape changing (every existing `apiGet<T[]>()` caller of the same endpoint
 * is unaffected — `page_size=0`/omitted stays the old unbounded behaviour).
 */
export async function apiGetPaged<T = any>(path: string): Promise<{ items: T[]; total: number }> {
  const res = await api<Response>(path, { raw: true });
  if (!res.ok) throw new ApiError(res.status, `http_${res.status}`);
  const items = (await res.json()) as T[];
  const header = res.headers.get("x-total-count");
  const total = header ? parseInt(header, 10) : items.length;
  return { items, total: Number.isFinite(total) ? total : items.length };
}

export const apiGet = <T = any>(p: string) => api<T>(p);
export const apiPost = <T = any>(p: string, body?: unknown) => api<T>(p, { method: "POST", body });
export const apiPut = <T = any>(p: string, body?: unknown) => api<T>(p, { method: "PUT", body });
export const apiDel = <T = any>(p: string, body?: unknown) => api<T>(p, { method: "DELETE", body });
