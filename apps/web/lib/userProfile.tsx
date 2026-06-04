"use client";

import { createContext, useContext, ReactNode } from "react";

export interface UserProfile {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  roles?: string[];
}

interface UserProfileContextValue {
  profile: UserProfile | null;
  inventoryEnabled: boolean;
  setInventoryEnabled: (v: boolean) => void;
}

const UserProfileContext = createContext<UserProfileContextValue>({
  profile: null,
  inventoryEnabled: false,
  setInventoryEnabled: () => {},
});

export function UserProfileProvider({
  profile,
  inventoryEnabled,
  setInventoryEnabled,
  children,
}: {
  profile: UserProfile | null;
  inventoryEnabled: boolean;
  setInventoryEnabled: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <UserProfileContext.Provider value={{ profile, inventoryEnabled, setInventoryEnabled }}>
      {children}
    </UserProfileContext.Provider>
  );
}

export function useUserProfile(): UserProfile | null {
  return useContext(UserProfileContext).profile;
}

export function useInventoryEnabled(): [boolean, (v: boolean) => void] {
  const ctx = useContext(UserProfileContext);
  return [ctx.inventoryEnabled, ctx.setInventoryEnabled];
}
