"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@/stores/auth-store";

export default function SetupPage() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);

  useEffect(() => {
    if (!user || !accessToken) {
      router.replace("/login");
      return;
    }
    if (user.businessId) {
      router.replace("/admin/dashboard");
      return;
    }
    router.replace("/register/shop");
  }, [user, accessToken, router]);

  return null;
}
