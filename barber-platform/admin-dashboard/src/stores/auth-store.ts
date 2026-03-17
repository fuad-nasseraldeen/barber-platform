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
  accessToken: string | null;
  refreshToken: string | null;
  _hasHydrated: boolean;
  setAuth: (
    user: User | null,
    accessToken: string | null,
    refreshToken?: string | null
  ) => void;
  logout: () => void;
  isAdmin: () => boolean;
  isStaff: () => boolean;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      accessToken: null,
      refreshToken: null,
      _hasHydrated: false,
      setAuth: (user, accessToken, refreshToken = null) => {
        if (typeof window !== "undefined") {
          if (accessToken) localStorage.setItem("access_token", accessToken);
          else localStorage.removeItem("access_token");
          if (refreshToken) localStorage.setItem("refresh_token", refreshToken);
          else localStorage.removeItem("refresh_token");
        }
        set({ user, accessToken, refreshToken });
      },
      logout: () => {
        const refreshToken = get().refreshToken;
        if (typeof window !== "undefined") {
          if (refreshToken) {
            fetch(`${getApiBase()}/auth/logout`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ refreshToken }),
            }).catch(() => {});
          }
          localStorage.removeItem("access_token");
          localStorage.removeItem("refresh_token");
        }
        set({ user: null, accessToken: null, refreshToken: null });
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
      partialize: (s) => ({ user: s.user, accessToken: s.accessToken, refreshToken: s.refreshToken }),
      onRehydrateStorage: () => () => {
        useAuthStore.setState({ _hasHydrated: true });
      },
    }
  )
);
