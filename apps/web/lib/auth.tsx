"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useState, useCallback, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "./api";

// useLayoutEffect fires synchronously after DOM mutations, before the browser
// paints — so auth resolves before the first visible frame.  On the server
// it degrades to useEffect (effects never run server-side anyway).
const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? useLayoutEffect : useEffect;

interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  tenantName?: string;
}

interface AuthState {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

interface AuthContextValue extends AuthState {
  logout: () => void;
  setTokens: (accessToken: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

function isTokenExpired(decoded: Record<string, unknown>): boolean {
  const exp = decoded.exp as number | undefined;
  if (!exp) return false; // no exp claim — treat as valid
  return Date.now() >= exp * 1000;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
    isAuthenticated: false,
  });

  const hydrateFromToken = useCallback((token: string) => {
    const decoded = decodeJwt(token);
    if (!decoded || isTokenExpired(decoded)) {
      // Token is missing, malformed, or expired — discard it immediately so
      // the layout's auth guard redirects to /login without an API round-trip.
      localStorage.removeItem('accessToken');
      setState({ user: null, accessToken: null, isLoading: false, isAuthenticated: false });
      return;
    }
    setState({
      user: {
        id: decoded.sub as string,
        email: decoded.email as string,
        name: (decoded.name as string) ?? (decoded.email as string),
        role: (decoded.role as string) ?? "VIEWER",
        tenantId: (decoded.tenantId as string) ?? "",
        tenantName: decoded.tenantName as string | undefined,
      },
      accessToken: token,
      isLoading: false,
      isAuthenticated: true,
    });
  }, []);

  useIsomorphicLayoutEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (token) {
      hydrateFromToken(token);
    } else {
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, [hydrateFromToken]);

  const setTokens = useCallback((accessToken: string) => {
    localStorage.setItem("accessToken", accessToken);
    hydrateFromToken(accessToken);
  }, [hydrateFromToken]);

  const logout = useCallback(() => {
    authApi.revoke().catch(() => {});
    localStorage.clear(); // wipe all auth state, not just accessToken
    setState({ user: null, accessToken: null, isLoading: false, isAuthenticated: false });
  }, []);

  return (
    <AuthContext.Provider value={{ ...state, logout, setTokens }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

// Redirect to /login if not authenticated — use in page components, not layouts
export function useRequireAuth() {
  const auth = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated) {
      router.push("/login");
    }
  }, [auth.isLoading, auth.isAuthenticated, router]);
  return auth;
}
