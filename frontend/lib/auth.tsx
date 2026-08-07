"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { apiGet, apiPost, loadAuthToken, setAuthToken } from "./api";
import type { User } from "./types";

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string, remember: boolean) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: true,
  login: async () => {},
  logout: async () => {},
  refresh: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!loadAuthToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      setUser(await apiGet<User>("/api/me"));
    } catch {
      setAuthToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const login = useCallback(
    async (username: string, password: string, remember: boolean) => {
      const res = await apiPost<{ user: User; token: string }>("/api/auth/login", {
        username,
        password,
        remember,
      });
      // Same choice the backend applied to the token's lifetime decides whether
      // it is persisted to disk or only for this browser session.
      setAuthToken(res.token, remember);
      setUser(res.user);
    },
    []
  );

  const logout = useCallback(async () => {
    try {
      await apiPost("/api/auth/logout");
    } catch {
      /* clearing locally is enough */
    }
    setAuthToken(null);
    setUser(null);
  }, []);

  return (
    <Ctx.Provider value={{ user, loading, login, logout, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export const useAuth = () => useContext(Ctx);
