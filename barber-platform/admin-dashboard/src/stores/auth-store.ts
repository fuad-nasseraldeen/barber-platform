import { create } from "zustand";
import { persist } from "zustand/middleware";
import { getApiBase } from "@/lib/api-client";

export type UserRole = "owner" | "manager" | "staff" | "customer";

export interface User {
  id: string;
  email?: string;
  phone?: string;
  name?: string;
  role?: UserRole;
  businessId?: string;
  staffId?: string;
}

interface AuthState {
  user: User | null;
  /** Short-lived JWT — memory + zustand only (not persisted). Refresh via HttpOnly cookie. */
  accessToken: string | null;
  _hasHydrated: boolean;
  setAuth: (user: User | null, accessToken: string | null) => void;
  /** Clear user + access token locally only (no network). Used when refresh fails so UI never hangs. */
  clearSession: () => void;
  /** Revoke refresh on server + clear HttpOnly cookie + client state. */
  logout: () => Promise<void>;
  isAdmin: () => boolean;
  isStaff: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      _hasHydrated: false,
      setAuth: (user, accessToken) => {
        set({ user, accessToken });
      },
      clearSession: () => {
        set({ user: null, accessToken: null });
      },
      logout: async () => {
        if (typeof window !== "undefined") {
          await fetch(`${getApiBase()}/auth/logout`, {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({}),
          }).catch(() => {});
        }
        set({ user: null, accessToken: null });
      },
      isAdmin: () => {
        const role = get().user?.role;
        return role === "owner" || role === "manager";
      },
      isStaff: () => {
        const role = get().user?.role;
        return role === "owner" || role === "manager" || role === "staff";
      },
    }),
    {
      name: "auth-storage",
      partialize: (s) => ({ user: s.user }),
      onRehydrateStorage: () => () => {
        useAuthStore.setState({ _hasHydrated: true });
      },
    }
  )
);
