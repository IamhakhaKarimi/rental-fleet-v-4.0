/**
 * Tiny fetch wrapper for the FastAPI backend.
 *
 * Auth: the backend accepts either the HttpOnly `bcr_session` cookie OR an
 * `Authorization: Bearer <jwt>` header. We use the Bearer header (token kept in
 * memory + localStorage) so auth works even when the frontend and API are on
 * different origins in dev (cross-site cookies are awkward); the cookie still
 * works for same-site production. Error bodies carry an i18n key in `detail`.
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

function configuredUrl(): URL | null {
  try {
    return new URL(CONFIGURED_BASE);
  } catch {
    return null;
  }
}

export function apiBase(): string {
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

const TOKEN_KEY = "bcr_token";

/**
 * Persist the access token. `remember` decides WHERE:
 *   true  -> localStorage, so the session survives closing the browser
 *            (matched by the backend's longer "remember me" token lifetime).
 *   false -> sessionStorage, so the token dies with the tab/window. Without this
 *            an unticked "remember me" still left a token on disk, which made the
 *            checkbox purely cosmetic on the client.
 * The other store is always cleared so a stale token can't outlive the choice.
 */
export function setAuthToken(token: string | null, remember: boolean = true) {
  authToken = token;
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
  window.sessionStorage.removeItem(TOKEN_KEY);
  if (token) {
    (remember ? window.localStorage : window.sessionStorage).setItem(TOKEN_KEY, token);
  }
}

export function loadAuthToken(): string | null {
  if (authToken) return authToken;
  if (typeof window !== "undefined") {
    authToken =
      window.sessionStorage.getItem(TOKEN_KEY) || window.localStorage.getItem(TOKEN_KEY);
  }
  return authToken;
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

export const apiGet = <T = any>(p: string) => api<T>(p);
export const apiPost = <T = any>(p: string, body?: unknown) => api<T>(p, { method: "POST", body });
export const apiPut = <T = any>(p: string, body?: unknown) => api<T>(p, { method: "PUT", body });
export const apiDel = <T = any>(p: string, body?: unknown) => api<T>(p, { method: "DELETE", body });
