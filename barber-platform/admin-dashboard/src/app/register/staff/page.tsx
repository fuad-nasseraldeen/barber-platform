"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";

const DEFAULT_BIRTH_YEAR = 1995;
const MONTHS_HE = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

function BirthDateField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const today = new Date();
  const years = Array.from({ length: 106 }, (_, i) => today.getFullYear() - i);
  const [year, setYear] = useState(value ? value.slice(0, 4) : String(DEFAULT_BIRTH_YEAR));
  const [month, setMonth] = useState(value ? value.slice(5, 7) : "");
  const [day, setDay] = useState(value ? value.slice(8, 10) : "");

  useEffect(() => {
    if (value) {
      setYear(value.slice(0, 4));
      setMonth(value.slice(5, 7));
      setDay(value.slice(8, 10));
    } else {
      setYear(String(DEFAULT_BIRTH_YEAR));
      setMonth("");
      setDay("");
    }
  }, [value]);

  const syncValue = (y: string, m: string, d: string) => {
    if (y && m && d) {
      onChange(`${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`);
    } else {
      onChange("");
    }
  };

  const daysInMonth = month
    ? new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate()
    : 31;
  const days = Array.from({ length: daysInMonth }, (_, i) => String(i + 1).padStart(2, "0"));

  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
        תאריך לידה (לא חובה)
      </label>
      <div className="flex gap-2">
        <select
          value={year}
          onChange={(e) => {
            setYear(e.target.value);
            syncValue(e.target.value, month, day);
          }}
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        >
          <option value="">שנה</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select
          value={month}
          onChange={(e) => {
            setMonth(e.target.value);
            syncValue(year, e.target.value, day);
          }}
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        >
          <option value="">חודש</option>
          {MONTHS_HE.map((name, i) => (
            <option key={i} value={String(i + 1).padStart(2, "0")}>{name}</option>
          ))}
        </select>
        <select
          value={day}
          onChange={(e) => {
            setDay(e.target.value);
            syncValue(year, month, e.target.value);
          }}
          className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
        >
          <option value="">יום</option>
          {days.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </select>
      </div>
    </div>
  );
}

export default function RegisterStaffPage() {
  const router = useRouter();
  const t = useTranslation();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const setAuth = useAuthStore((s) => s.setAuth);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [gender, setGender] = useState<"MALE" | "FEMALE" | "">("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!user || !accessToken) {
      router.replace("/login");
      return;
    }
    if (user.businessId && user.role === "staff") {
      router.replace("/employee/dashboard");
      return;
    }
  }, [user, accessToken, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const staff = await apiClient<{ id: string }>("/staff/register", {
        method: "POST",
        body: JSON.stringify({
          firstName,
          lastName,
          birthDate: birthDate || undefined,
          gender: gender || undefined,
        }),
      });
      setAuth({ ...user!, role: "staff", staffId: staff.id }, accessToken, refreshToken ?? "");
      router.push("/employee/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  };

  if (!user || !accessToken) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-zinc-500">{t("widget.loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-4 dark:bg-zinc-950">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
        <h1 className="mb-2 text-center text-2xl font-semibold">השלמת רישום עובד</h1>
        <p className="mb-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
          המנהל הזמין אותך לחנות. מלא את הפרטים להשלמת הרישום.
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              שם פרטי
            </label>
            <input
              type="text"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="ישראל"
              className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              required
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              שם משפחה
            </label>
            <input
              type="text"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="ישראלי"
              className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              required
            />
          </div>
          <BirthDateField value={birthDate} onChange={setBirthDate} />
          <div>
            <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
              מגדר
            </label>
            <select
              value={gender}
              onChange={(e) => setGender(e.target.value as "MALE" | "FEMALE" | "")}
              className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
            >
              <option value="">בחר</option>
              <option value="MALE">זכר</option>
              <option value="FEMALE">נקבה</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={loading}
            className="btn-primary w-full rounded-lg py-2 font-medium"
          >
            {loading ? t("widget.loading") : "השלם רישום"}
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
