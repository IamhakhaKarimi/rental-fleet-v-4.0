/**
 * Tiny fetch wrapper for the FastAPI backend.
 *
 * Auth: the HttpOnly `bcr_session` cookie is the normal path — same-origin
 * (production) or same-host-different-port (dev, the launcher's LAN mode),
 * where `SameSite=Strict` still flows. The token is never written to
 * `localStorage`/`sessionStorage` anymore (M9: an XSS payload that can read
 * disk used to just lift the session outright). The one case a token is
 * still kept, in memory only, is an explicit REMOTE `NEXT_PUBLIC_API_BASE`
 * (the old Vercel/Render split in DEPLOY.md) — a genuinely cross-site
 * deployment where the cookie cannot follow, so the Bearer header is the
 * only way auth works at all, and losing it on refresh is expected there.
 */
/**
 * Where the API lives.
 *
 * `NEXT_PUBLIC_API_BASE` is inlined by Next at BUILD time, so a value baked in
 * here cannot follow the host the page is actually served from. That is what
 * breaks LAN mode: a laptop opening `http://192.168.0.228:3000` downloads a
 * bundle pointing at `http://127.0.0.1:8001` and calls its own loopback.
 *
 * So when the page is served from a NON-loopback host we ignore the configured
 * host and reuse the page's own — same port, same protocol. One running server
 * then answers `localhost` and every LAN address at once, and a new DHCP lease
 * needs no rebuild. An explicit remote base (the Vercel/Render setup in
 * DEPLOY.md) is always honoured verbatim, and loopback visits keep using the
 * configured value so we never depend on how `localhost` resolves.
 */
const CONFIGURED_BASE = (process.env.NEXT_PUBLIC_API_BASE || "").replace(/\/+$/, "");
const DEFAULT_API_PORT = "8001";
const LOOPBACK = /^(localhost|127(?:\.\d+){3}|\[?::1\]?)$/i;
// The Phase 6 single-VPS deployment: Nginx proxies /api on the SAME origin as
// the page (no separate port at all — unlike the launcher's LAN mode, which
// really does put the API on a different port on the same host). A literal
// "same-origin" opts out of the port-guessing logic below entirely: every
// call site does `${apiBase()}${path}`, and path already starts with "/api",
// so an empty base just resolves as a normal relative fetch.
const SAME_ORIGIN = "same-origin";

function configuredUrl(): URL | null {
  try {
    return new URL(CONFIGURED_BASE);
  } catch {
    return null;
  }
}

export function apiBase(): string {
  if (CONFIGURED_BASE === SAME_ORIGIN) return "";

  const u = configuredUrl();
  // A real remote API was configured — always use it as given.
  if (u && !LOOPBACK.test(u.hostname)) return CONFIGURED_BASE;

  const port = u?.port || DEFAULT_API_PORT;
  if (typeof window !== "undefined" && !LOOPBACK.test(window.location.hostname)) {
    return `${window.location.protocol}//${window.location.hostname}:${port}`;
  }
  // Loopback visit, or SSR where there is no host to follow yet.
  return CONFIGURED_BASE || `http://127.0.0.1:${port}`;
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
