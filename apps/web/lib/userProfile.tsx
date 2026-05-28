"use client";

import { createContext, useContext, ReactNode } from "react";

export interface UserProfile {
  firstName?: string;
  lastName?: string;
  fullName?: string;
  email?: string;
  roles?: string[];
}

const UserProfileContext = createContext<UserProfile | null>(null);

export function UserProfileProvider({
  profile,
  children,
}: {
  profile: UserProfile | null;
  children: ReactNode;
}) {
  return (
    <UserProfileContext.Provider value={profile}>
      {children}
    </UserProfileContext.Provider>
  );
}

export function useUserProfile(): UserProfile | null {
  return useContext(UserProfileContext);
}
