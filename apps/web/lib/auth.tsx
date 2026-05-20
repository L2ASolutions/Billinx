"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { authApi } from "./api";

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
  login: (email: string, password: string) => Promise<{ mfaRequired: boolean; mfaToken?: string }>;
  verifyMfa: (mfaToken: string, code: string) => Promise<void>;
  logout: () => void;
  setTokens: (accessToken: string, refreshToken: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function decodeJwt(token: string): { sub: string; email: string; name?: string; role?: string; tenantId?: string; tenantName?: string } | null {
  try {
    const payload = token.split(".")[1];
    return JSON.parse(atob(payload));
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<AuthState>({
    user: null,
    accessToken: null,
    isLoading: true,
    isAuthenticated: false,
  });

  const hydrateFromToken = useCallback((token: string) => {
    const decoded = decodeJwt(token);
    if (!decoded) return;
    setState({
      user: {
        id: decoded.sub,
        email: decoded.email,
        name: decoded.name ?? decoded.email,
        role: decoded.role ?? "VIEWER",
        tenantId: decoded.tenantId ?? "",
        tenantName: decoded.tenantName,
      },
      accessToken: token,
      isLoading: false,
      isAuthenticated: true,
    });
  }, []);

  useEffect(() => {
    const token = localStorage.getItem("accessToken");
    if (token) {
      hydrateFromToken(token);
    } else {
      setState((s) => ({ ...s, isLoading: false }));
    }
  }, [hydrateFromToken]);

  const setTokens = useCallback((accessToken: string, refreshToken: string) => {
    localStorage.setItem("accessToken", accessToken);
    localStorage.setItem("refreshToken", refreshToken);
    hydrateFromToken(accessToken);
  }, [hydrateFromToken]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    if (res.mfaRequired) {
      return { mfaRequired: true, mfaToken: res.mfaToken };
    }
    if (res.accessToken && res.refreshToken) {
      setTokens(res.accessToken, res.refreshToken);
    }
    return { mfaRequired: false };
  }, [setTokens]);

  const verifyMfa = useCallback(async (mfaToken: string, code: string) => {
    const res = await authApi.verifyMfa(mfaToken, code);
    setTokens(res.accessToken, res.refreshToken);
  }, [setTokens]);

  const logout = useCallback(() => {
    const refreshToken = localStorage.getItem("refreshToken");
    if (refreshToken) {
      authApi.revoke(refreshToken).catch(() => {});
    }
    localStorage.removeItem("accessToken");
    localStorage.removeItem("refreshToken");
    setState({ user: null, accessToken: null, isLoading: false, isAuthenticated: false });
    router.push("/login");
  }, [router]);

  return (
    <AuthContext.Provider value={{ ...state, login, verifyMfa, logout, setTokens }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}

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
