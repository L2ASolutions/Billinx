"use client";

import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { formatRole } from "@/lib/utils";
import { UserAvatarMenu } from "./UserAvatarMenu";

export function UserMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();

  function handleLogout() {
    logout();
    router.push("/login");
  }

  return (
    <UserAvatarMenu
      fullName={user?.name ?? ""}
      role={formatRole(user?.role ?? "")}
      onLogout={handleLogout}
    />
  );
}
