"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiClient, API_PATHS } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { GoogleLoginButton } from "@/components/auth/GoogleLoginButton";
import { loadGoogleGsi } from "@/lib/gsi-loader";

function getRedirectPath(redirectTo: "admin" | "staff" | "register-shop" | "register-staff"): string {
  switch (redirectTo) {
    case "admin":
      return "/admin/dashboard";
    case "staff":
      return "/employee/dashboard";
    case "register-staff":
      return "/register/staff";
    case "register-shop":
    default:
      return "/register/shop";
  }
}

export default function LoginPage() {
  const router = useRouter();
  const setAuth = useAuthStore((s) => s.setAuth);
  const t = useTranslation();
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    loadGoogleGsi().then(() => {
      try {
        window.google?.accounts?.id?.disableAutoSelect?.();
      } catch {
        /* ignore */
      }
    }).catch(() => {});
  }, []);

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await apiClient<{ success: boolean }>("/auth/request-otp", {
        method: "POST",
        body: JSON.stringify({ phone }),
      });
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send code");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await apiClient<{
        accessToken: string;
        refreshToken: string;
        user: { id: string; businessId?: string; name?: string; email?: string; phone?: string; role?: string; staffId?: string };
        redirectTo: "admin" | "staff" | "register-shop" | "register-staff";
      }>("/auth/verify-otp", {
        method: "POST",
        body: JSON.stringify({ phone, code }),
      });
      setAuth(
        {
          id: res.user.id,
          businessId: res.user.businessId,
          name: res.user.name,
          email: res.user.email,
          phone: res.user.phone ?? phone,
          role: (res.user.role as "owner" | "manager" | "staff" | "customer") ?? "customer",
          staffId: res.user.staffId,
        },
        res.accessToken,
        res.refreshToken
      );
      router.push(getRedirectPath(res.redirectTo));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      setError(msg === "Invalid OTP" ? t("auth.invalidOtp") : msg || t("auth.invalidOtp"));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async (result: { credential: string; nonce: string }) => {
    setError("");
    setLoading(true);
    try {
      const res = await apiClient<{
        accessToken: string;
        refreshToken: string;
        user: { id: string; businessId?: string; name?: string; email?: string; phone?: string; role?: string; staffId?: string };
        redirectTo: "admin" | "staff" | "register-shop" | "register-staff";
      }>(API_PATHS.AUTH_GOOGLE, {
        method: "POST",
        body: JSON.stringify({ credential: result.credential, nonce: result.nonce }),
      });
      setAuth(
        {
          id: res.user.id,
          businessId: res.user.businessId,
          name: res.user.name,
          email: res.user.email,
          phone: res.user.phone,
          role: (res.user.role as "owner" | "manager" | "staff" | "customer") ?? "customer",
          staffId: res.user.staffId,
        },
        res.accessToken,
        res.refreshToken
      );
      router.push(getRedirectPath(res.redirectTo));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Google login failed";
      if (msg === "Missing credential") {
        setError("Google sign-in was cancelled");
      } else if (/internal server error|500|server error/i.test(msg)) {
        setError(t("auth.googleLoginServerError"));
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden p-3 sm:p-4">
      {/* Animated background */}
      <div
        className="absolute inset-0 login-bg-gradient"
        style={{
          background: "linear-gradient(-45deg, #e0f2fe, #f0fdf4, #ecfdf5, #e0e7ff)",
          backgroundSize: "400% 400%",
        }}
      />
      <div className="absolute inset-0 dark:bg-zinc-950/60" aria-hidden />
      {/* Floating blobs */}
      <div
        className="login-bg-blob-1 absolute -left-20 -top-20 h-64 w-64 rounded-full bg-blue-400/40 blur-3xl dark:bg-blue-500/20"
        aria-hidden
      />
      <div
        className="login-bg-blob-2 absolute -bottom-32 -right-20 h-80 w-80 rounded-full bg-emerald-400/40 blur-3xl dark:bg-emerald-500/20"
        aria-hidden
      />
      <div
        className="login-bg-blob-3 absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full bg-indigo-300/25 blur-3xl dark:bg-indigo-500/15"
        aria-hidden
      />

      <div className="relative z-10 flex flex-col items-center">
        <div
          className="w-full max-w-[min(100%,22rem)] sm:max-w-sm rounded-xl border border-zinc-200/80 bg-white/90 p-4 sm:p-6 shadow-xl backdrop-blur-md dark:border-zinc-700/80 dark:bg-zinc-900/90"
          suppressHydrationWarning
        >
        <h1 className="mb-6 text-center text-2xl font-semibold">
          {t("auth.login")}
        </h1>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Google Login */}
        <div className="mb-6">
          <GoogleLoginButton
            onSuccess={handleGoogleLogin}
            onError={(e) => setError(e.message)}
            disabled={loading}
          />
        </div>

        <div className="relative mb-6">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-zinc-200 dark:border-zinc-700" />
          </div>
          <div className="relative flex justify-center text-sm">
            <span className="bg-white/90 px-2 text-zinc-500 backdrop-blur-md dark:bg-zinc-900/90 dark:text-zinc-400">
              {t("auth.or")}
            </span>
          </div>
        </div>

        {/* SMS Login */}
        {step === "phone" ? (
          <form onSubmit={handleRequestOtp} className="space-y-4">
            <div>
              <label
                htmlFor="phone"
                className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                {t("auth.phone")}
              </label>
              <input
                id="phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="05xxxxxxxx"
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                required
                suppressHydrationWarning
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full rounded-lg py-2 font-medium"
            >
              {loading ? t("widget.loading") : t("auth.sendCode")}
            </button>
          </form>
        ) : (
          <form onSubmit={handleVerifyOtp} className="space-y-4">
            <div>
              <label
                htmlFor="code"
                className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300"
              >
                {t("auth.verificationCode")}
              </label>
              <input
                id="code"
                type="text"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                placeholder="123456"
                maxLength={6}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                required
                suppressHydrationWarning
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full rounded-lg py-2 font-medium"
            >
              {loading ? t("widget.loading") : t("auth.verify")}
            </button>
            <button
              type="button"
              onClick={() => setStep("phone")}
              className="w-full text-sm text-zinc-500 hover:text-zinc-700 dark:hover:text-zinc-400"
            >
              {t("auth.changePhone")}
            </button>
          </form>
        )}
      </div>

      <p className="mt-6 text-center text-sm text-zinc-500">
          <Link href="/" className="hover:underline">
            {t("nav.home")}
          </Link>
        </p>
      </div>
    </div>
  );
}
