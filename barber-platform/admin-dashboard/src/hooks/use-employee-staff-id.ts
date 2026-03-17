"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";

/** Returns staffId for employee - from auth store or fetches from /staff/me */
export function useEmployeeStaffId(): string | null {
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const setAuth = useAuthStore((s) => s.setAuth);

  const { data: staff } = useQuery({
    queryKey: ["staff", "me"],
    queryFn: () => apiClient<{ id: string }>("/staff/me"),
    enabled: !!user?.businessId && user?.role === "staff" && !user?.staffId,
  });

  useEffect(() => {
    if (staff?.id && user && !user.staffId) {
      setAuth({ ...user, staffId: staff.id }, accessToken, refreshToken);
    }
  }, [staff?.id, user, accessToken, refreshToken, setAuth]);

  return user?.staffId ?? staff?.id ?? null;
}
