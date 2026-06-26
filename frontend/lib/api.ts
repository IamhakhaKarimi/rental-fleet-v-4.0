/**
 * Tiny fetch wrapper for the FastAPI backend.
 *
 * Auth: the backend accepts either the HttpOnly `bcr_session` cookie OR an
 * `Authorization: Bearer <jwt>` header. We use the Bearer header (token kept in
 * memory + localStorage) so auth works even when the frontend and API are on
 * different origins in dev (cross-site cookies are awkward); the cookie still
 * works for same-site production. Error bodies carry an i18n key in `detail`.
 */
export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE || "http://127.0.0.1:8001";

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
  if (typeof window !== "undefined") {
    if (token) window.localStorage.setItem("bcr_token", token);
    else window.localStorage.removeItem("bcr_token");
  }
}

export function loadAuthToken(): string | null {
  if (authToken) return authToken;
  if (typeof window !== "undefined") {
    authToken = window.localStorage.getItem("bcr_token");
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

  const res = await fetch(`${API_BASE}${path}`, {
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
