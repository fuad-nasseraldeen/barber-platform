"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { BirthDateTripleInput } from "@/components/ui/birth-date-triple-input";
import { GenderToggle, type GenderToggleValue } from "@/components/ui/gender-toggle";

export default function RegisterStaffPage() {
  const router = useRouter();
  const t = useTranslation();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const setAuth = useAuthStore((s) => s.setAuth);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<GenderToggleValue>("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hydrationFallback, setHydrationFallback] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setHydrationFallback(true), 2500);
    return () => clearTimeout(timer);
  }, []);

  const effectiveHydrated = hasHydrated || hydrationFallback;

  useEffect(() => {
    if (!effectiveHydrated) return;
    if (!user || !accessToken) {
      router.replace("/login");
      return;
    }
    if (user.businessId && user.role === "staff") {
      router.replace("/employee/dashboard");
      return;
    }
  }, [effectiveHydrated, user, accessToken, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (gender !== "MALE" && gender !== "FEMALE") {
      setError(t("register.genderPickError"));
      return;
    }
    setLoading(true);
    try {
      const staff = await apiClient<{ id: string }>("/staff/register", {
        method: "POST",
        body: JSON.stringify({
          firstName,
          lastName,
          birthDate: birthDate || undefined,
          gender,
        }),
      });
      setAuth({ ...user!, role: "staff", staffId: staff.id }, accessToken);
      if (typeof window !== "undefined") {
        window.location.assign(`${window.location.origin}/employee/dashboard`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  if (!effectiveHydrated || !user || !accessToken) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-zinc-500">{t("widget.loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-4 dark:bg-zinc-950">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-2 text-center text-2xl font-semibold">{t("register.staffCompleteTitle")}</h1>
        <p className="mb-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
          {t("register.staffCompleteSubtitle")}
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("register.firstName")}
            </label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder={t("register.firstNamePlaceholder")}
              className="w-full rounded-xl border border-zinc-300 px-4 py-2.5 text-end dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              dir="auto"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              {t("register.lastName")}
            </label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder={t("register.lastNamePlaceholder")}
              className="w-full rounded-xl border border-zinc-300 px-4 py-2.5 text-end dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              dir="auto"
              required
            />
          </div>
          <BirthDateTripleInput
            labelKey="register.birthDateOptional"
            value={birthDate}
            onChange={setBirthDate}
          />
          <GenderToggle
            labelKey="register.genderRequired"
            value={gender}
            onChange={setGender}
            showError={!!error && gender !== "MALE" && gender !== "FEMALE"}
          />
          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full rounded-xl py-2.5 font-medium"
          >
            {loading ? t("widget.loading") : t("register.staffSubmit")}
          </button>
        </form>
      </div>

      <p className="mt-6 text-center text-sm text-zinc-500">
        <Link href="/" className="hover:underline">
          {t("nav.home")}
        </Link>
      </p>
    </div>
  );
}
