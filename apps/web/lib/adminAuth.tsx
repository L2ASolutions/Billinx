"use client";

import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from "react";
import { useRouter } from "next/navigation";
import { adminApi } from "./api";

interface AdminAuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AdminAuthContextValue extends AdminAuthState {
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AdminAuthContext = createContext<AdminAuthContextValue | null>(null);

export function AdminAuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState<AdminAuthState>({ isAuthenticated: false, isLoading: true });

  useEffect(() => {
    const token = localStorage.getItem("adminToken");
    if (token) {
      // Decode and check the exp claim so a stale admin token doesn't grant
      // access — mirrors the same check in lib/auth.tsx for regular users.
      try {
        const decoded = JSON.parse(atob(token.split(".")[1]));
        const exp = decoded?.exp as number | undefined;
        if (exp && Date.now() >= exp * 1000) {
          // Token is expired — discard it and redirect to admin login
          localStorage.removeItem("adminToken");
          setState({ isAuthenticated: false, isLoading: false });
          return;
        }
      } catch {
        // Malformed token — treat as unauthenticated
        localStorage.removeItem("adminToken");
        setState({ isAuthenticated: false, isLoading: false });
        return;
      }
    }
    setState({ isAuthenticated: !!token, isLoading: false });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await adminApi.login(email, password) as { accessToken: string };
    localStorage.setItem("adminToken", res.accessToken);
    setState({ isAuthenticated: true, isLoading: false });
  }, []);

  const logout = useCallback(() => {
    localStorage.clear(); // wipe all auth state
    setState({ isAuthenticated: false, isLoading: false });
    router.push("/admin/login");
  }, [router]);

  return (
    <AdminAuthContext.Provider value={{ ...state, login, logout }}>
      {children}
    </AdminAuthContext.Provider>
  );
}

export function useAdminAuth() {
  const ctx = useContext(AdminAuthContext);
  if (!ctx) throw new Error("useAdminAuth must be used inside AdminAuthProvider");
  return ctx;
}
