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
    setState({ isAuthenticated: !!token, isLoading: false });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await adminApi.login(email, password) as { accessToken: string };
    localStorage.setItem("adminToken", res.accessToken);
    setState({ isAuthenticated: true, isLoading: false });
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("adminToken");
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
