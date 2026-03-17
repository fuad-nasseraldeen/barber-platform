"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiClient } from "@/lib/api-client";
import { PlaceAutocompleteNew } from "@/components/ui/place-autocomplete-new";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { LocaleSwitcher } from "@/components/ui/locale-switcher";
import { GoogleLoginButton } from "@/components/auth/GoogleLoginButton";
import toast from "react-hot-toast";

/** Israeli mobile: 05X-XXXXXXX (10 digits) */
function isValidIsraeliPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 && digits.startsWith("05");
}

const BUSINESS_TYPES = [
  { value: "BARBER_SHOP", labelKey: "setup.typeBarbershop" },
  { value: "BEAUTY_SALON", labelKey: "setup.typeBeauty" },
  { value: "GYM", labelKey: "setup.typeGym" },
  { value: "CLINIC", labelKey: "setup.typeClinic" },
] as const;

type PlaceData = {
  address: string;
  street: string;
  city: string;
  lat: number;
  lng: number;
};

export default function RegisterShopPage() {
  const router = useRouter();
  const t = useTranslation();
  const user = useAuthStore((s) => s.user);
  const accessToken = useAuthStore((s) => s.accessToken);
  const refreshToken = useAuthStore((s) => s.refreshToken);
  const setAuth = useAuthStore((s) => s.setAuth);
  const hasHydrated = useAuthStore((s) => s._hasHydrated);

  const [step, setStep] = useState<"shop" | "owner">("shop");
  const [shopName, setShopName] = useState("");
  const [shopType, setShopType] = useState<"BARBER_SHOP" | "BEAUTY_SALON" | "GYM" | "CLINIC">("BARBER_SHOP");
  const [shopPhone, setShopPhone] = useState("");
  const [place, setPlace] = useState<PlaceData | null>(null);
  const [placeInput, setPlaceInput] = useState("");
  const [ownerFirstName, setOwnerFirstName] = useState("");
  const [ownerLastName, setOwnerLastName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [code, setCode] = useState("");
  const [phoneStep, setPhoneStep] = useState<"phone" | "code">("phone");
  const [ownerBirthDay, setOwnerBirthDay] = useState("");
  const [ownerBirthMonth, setOwnerBirthMonth] = useState("");
  const [ownerBirthYear, setOwnerBirthYear] = useState("");
  const [ownerGender, setOwnerGender] = useState<"MALE" | "FEMALE" | "">("");
  const [loading, setLoading] = useState(false);
  const [otpLoading, setOtpLoading] = useState(false);
  const [codeSent, setCodeSent] = useState(false);
  const [phoneVerified, setPhoneVerified] = useState(false);
  const [error, setError] = useState("");
  const [hydrationFallback, setHydrationFallback] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setHydrationFallback(true), 2500);
    return () => clearTimeout(t);
  }, []);

  const effectiveHydrated = hasHydrated || hydrationFallback;

  useEffect(() => {
    if (!effectiveHydrated) return;
    if (!user || !accessToken) {
      router.replace("/login");
      return;
    }
    if (user.businessId) {
      router.replace("/admin/dashboard");
      return;
    }
  }, [effectiveHydrated, user, accessToken, router]);

  const handlePlaceSelect = (value: string, placeData?: { address: string; street?: string; city: string; lat: number; lng: number }) => {
    setPlaceInput(value);
    if (placeData) {
      setPlace({
        address: placeData.address,
        street: placeData.street ?? placeData.address,
        city: placeData.city,
        lat: placeData.lat,
        lng: placeData.lng,
      });
    }
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setCodeSent(false);
    setOtpLoading(true);
    try {
      await apiClient<{ success: boolean }>("/auth/request-otp", {
        method: "POST",
        body: JSON.stringify({
          phone: ownerPhone,
          senderId: shopName?.trim().slice(0, 11) || undefined,
        }),
      });
      setPhoneStep("code");
      setCodeSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send code");
    } finally {
      setOtpLoading(false);
    }
  };

  const handleCreateShop = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const payload: Record<string, unknown> = {
        name: shopName,
        type: shopType,
        phone: shopPhone || undefined,
        address: place?.address,
        street: place?.street,
        city: place?.city,
        lat: place?.lat,
        lng: place?.lng,
        owner: {
          firstName: ownerFirstName,
          lastName: ownerLastName,
          birthDate:
            ownerBirthDay && ownerBirthMonth && ownerBirthYear
              ? `${ownerBirthYear}-${ownerBirthMonth.padStart(2, "0")}-${ownerBirthDay.padStart(2, "0")}`
              : undefined,
          gender: ownerGender || undefined,
        },
      };

      // Only send OTP when user didn't log in with phone (phone not yet verified)
      if (!phoneAlreadyVerified && phoneStep === "code") {
        payload.ownerPhone = ownerPhone;
        payload.ownerPhoneCode = code;
      }

      const business = await apiClient<{ id: string }>("/business/create", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      setPhoneVerified(true);
      setError("");
      setAuth(
        { ...user!, businessId: business.id, role: "owner" },
        accessToken,
        refreshToken
      );
      setTimeout(() => router.push("/admin/dashboard"), 1000);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      const isPhoneConflict = msg.includes("Phone number already in use");
      const isNetworkError = msg.includes("fetch") || msg.includes("Failed to fetch") || msg.includes("NetworkError");
      const displayMsg = isPhoneConflict
        ? t("register.phoneAlreadyInUse")
        : isNetworkError
          ? t("register.networkError")
          : msg || t("register.createFailed");
      setError(displayMsg);
      setLoading(false);
    }
  };

  const handleShopSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStep("owner");
  };

  // When user logged in with phone (OTP), phone is already verified - pre-fill and skip OTP
  const phoneAlreadyVerified = !!user?.phone;
  const userPhone = user?.phone ?? null;
  const userName = user?.name ?? null;
  useEffect(() => {
    if (step === "owner") {
      if (userPhone) setOwnerPhone(userPhone);
      if (userName && !ownerFirstName && !ownerLastName) {
        const parts = userName.trim().split(/\s+/);
        if (parts.length >= 2) {
          setOwnerFirstName(parts[0]);
          setOwnerLastName(parts.slice(1).join(" "));
        } else if (parts.length === 1) {
          setOwnerFirstName(parts[0]);
        }
      }
    }
  }, [step, userPhone, userName]);

  // Can submit when all mandatory fields filled: firstName, lastName, phone (verified), gender. Birth date, Google = optional.
  const canCreateShop =
    ownerFirstName.trim().length >= 1 &&
    ownerLastName.trim().length >= 1 &&
    (phoneAlreadyVerified || (phoneStep === "code" && code.length >= 4)) &&
    (ownerGender === "MALE" || ownerGender === "FEMALE");

  if (!effectiveHydrated || !user || user.businessId) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-zinc-500">{t("widget.loading")}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-zinc-50 p-3 sm:p-4 dark:bg-zinc-950">
      <div className="w-full max-w-[min(100%,22rem)] sm:max-w-md rounded-xl border border-zinc-200 bg-white p-4 sm:p-6 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
        <div className="mb-6 flex items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="mb-1 text-center text-2xl font-semibold">
              {step === "shop" ? t("register.shopTitle") : t("register.ownerTitle")}
            </h1>
            <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
              {step === "shop"
                ? t("register.shopSubtitle")
                : t("register.ownerSubtitle")}
            </p>
          </div>
          <div className="shrink-0">
            <LocaleSwitcher />
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
            {error}
          </div>
        )}

        {step === "shop" ? (
          <form onSubmit={handleShopSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("register.shopName")}
              </label>
              <input
                type="text"
                value={shopName}
                onChange={(e) => setShopName(e.target.value)}
                placeholder={t("setup.businessNamePlaceholder")}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                required
                minLength={2}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("setup.businessType")}
              </label>
              <select
                value={shopType}
                onChange={(e) => setShopType(e.target.value as typeof shopType)}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              >
                {BUSINESS_TYPES.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {t(opt.labelKey)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("register.shopPhone")}
              </label>
              <input
                type="tel"
                value={shopPhone}
                onChange={(e) => setShopPhone(e.target.value)}
                placeholder="050xxxxxxxx"
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("register.locationLabel")}
              </label>
              <PlaceAutocompleteNew
                value={placeInput}
                onChange={handlePlaceSelect}
                placeholder={t("register.locationPlaceholder")}
                className="w-full"
              />
            </div>
            <button
              type="submit"
              className="btn-primary w-full rounded-lg py-2 font-medium"
            >
              {t("register.continue")}
            </button>
          </form>
        ) : (
          <form onSubmit={handleCreateShop} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("register.firstName")}
              </label>
              <input
                type="text"
                value={ownerFirstName}
                onChange={(e) => setOwnerFirstName(e.target.value)}
                placeholder={t("register.firstNamePlaceholder")}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("register.lastName")}
              </label>
              <input
                type="text"
                value={ownerLastName}
                onChange={(e) => setOwnerLastName(e.target.value)}
                placeholder={t("register.lastNamePlaceholder")}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("register.phoneRequired")}
              </label>
              {phoneAlreadyVerified ? (
                <div className="flex items-center gap-2 rounded-lg border border-zinc-300 bg-zinc-50 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800/50">
                  <span className="text-zinc-700 dark:text-zinc-200">{ownerPhone}</span>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-sm font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                    ✓ {t("register.verified")}
                  </span>
                </div>
              ) : phoneStep === "phone" ? (
                <div className="space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
                    <input
                      type="tel"
                      value={ownerPhone}
                      onChange={(e) => {
                        setOwnerPhone(e.target.value);
                        setCodeSent(false);
                      }}
                      placeholder="050xxxxxxxx"
                      className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                      required
                    />
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        handleRequestOtp(e as unknown as React.FormEvent);
                      }}
                      disabled={otpLoading || !isValidIsraeliPhone(ownerPhone)}
                      className="btn-primary shrink-0 rounded-lg px-4 py-2 disabled:opacity-50"
                    >
                      {otpLoading ? t("widget.loading") : t("register.sendCode")}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => !phoneVerified && setCode(e.target.value)}
                    placeholder={t("register.verificationCode")}
                    maxLength={6}
                    readOnly={phoneVerified}
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100 disabled:bg-zinc-100 dark:disabled:bg-zinc-800/50 disabled:cursor-not-allowed"
                    required
                  />
                  <div className="flex items-center justify-between gap-2">
                    {!phoneVerified && (
                      <button
                        type="button"
                        onClick={() => {
                          setPhoneStep("phone");
                          setCodeSent(false);
                        }}
                        className="text-sm text-zinc-500 hover:underline"
                      >
                        {t("register.changeNumber")}
                      </button>
                    )}
                    {phoneVerified ? (
                      <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">✓ {t("register.verified")}</p>
                    ) : codeSent ? (
                      <p className="text-sm text-zinc-500 dark:text-zinc-400">{t("register.codeSent")}</p>
                    ) : null}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        handleRequestOtp(e as unknown as React.FormEvent);
                      }}
                      disabled={otpLoading || !isValidIsraeliPhone(ownerPhone)}
                      className="text-sm text-zinc-600 hover:underline disabled:opacity-50 dark:text-zinc-400"
                    >
                      {otpLoading ? t("widget.loading") : t("register.resendCode")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Link Google - when user has phone but no email */}
            <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-600">
              <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">Google</p>
              {user?.email ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-zinc-600 dark:text-zinc-400">{user.email}</span>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-sm font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                    ✓ {t("settings.googleLinked")}
                  </span>
                </div>
              ) : (
                <div>
                  <p className="mb-2 text-xs text-zinc-500 dark:text-zinc-400">
                    {t("register.linkGoogleDesc")}
                  </p>
                  <GoogleLoginButton
                    buttonId="register-link-google"
                    onSuccess={async (result) => {
                      try {
                        const res = await apiClient<{
                          accessToken: string;
                          refreshToken: string;
                          user: { id: string; phone?: string; email?: string; name?: string; businessId?: string; role?: string; staffId?: string };
                        }>("/auth/link-google", {
                          method: "POST",
                          body: JSON.stringify({ credential: result.credential, nonce: result.nonce }),
                        });
                        setAuth(
                          {
                            id: res.user.id,
                            phone: res.user.phone,
                            email: res.user.email,
                            name: res.user.name,
                            businessId: res.user.businessId,
                            role: (res.user.role as "owner" | "manager" | "staff" | "customer") ?? "customer",
                            staffId: res.user.staffId,
                          },
                          res.accessToken,
                          res.refreshToken
                        );
                        toast.success(t("settings.googleLinked"));
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : "Failed to link Google");
                      }
                    }}
                    onError={(e) => toast.error(e.message)}
                  />
                </div>
              )}
            </div>

            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap">
              <div className="min-w-0 flex-1 sm:basis-48">
                <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {t("register.birthDateOptional")}
                </label>
                <div className="flex flex-col gap-2 sm:flex-row sm:gap-1">
                  <div className="flex gap-1">
                    <select
                      value={ownerBirthDay}
                      onChange={(e) => setOwnerBirthDay(e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                    >
                      <option value="">{t("register.day")}</option>
                      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                        <option key={d} value={d}>
                          {d}
                        </option>
                      ))}
                    </select>
                    <select
                      value={ownerBirthMonth}
                      onChange={(e) => setOwnerBirthMonth(e.target.value)}
                      className="min-w-0 flex-1 rounded-lg border border-zinc-300 px-2 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                    >
                      <option value="">{t("register.month")}</option>
                      {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((i) => (
                        <option key={i} value={String(i).padStart(2, "0")}>
                          {t(`register.month${i}`)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <select
                    value={ownerBirthYear}
                    onChange={(e) => setOwnerBirthYear(e.target.value)}
                    className="w-full rounded-lg border border-zinc-300 px-2 py-2 sm:min-w-0 sm:flex-1 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                  >
                    <option value="">{t("register.year")}</option>
                    {Array.from({ length: 75 }, (_, i) => new Date().getFullYear() - 18 - i).map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="w-full shrink-0 sm:w-28">
                <label className="mb-1 block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {t("register.genderRequired")}
                </label>
                <select
                  value={ownerGender}
                  onChange={(e) => setOwnerGender(e.target.value as "MALE" | "FEMALE" | "")}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                >
                  <option value="">{t("register.select")}</option>
                  <option value="MALE">{t("customers.genderMale")}</option>
                  <option value="FEMALE">{t("customers.genderFemale")}</option>
                </select>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep("shop")}
                className="flex-1 rounded-lg border border-zinc-300 py-2 dark:border-zinc-600"
              >
                {t("register.back")}
              </button>
              <button
                type="submit"
                disabled={loading || phoneVerified || !canCreateShop}
                className={`flex-1 rounded-lg py-2 font-medium transition-colors ${
                  canCreateShop && !loading && !phoneVerified
                    ? "bg-emerald-600 text-white hover:bg-emerald-700"
                    : "btn-primary"
                } disabled:opacity-50`}
              >
                {phoneVerified ? `✓ ${t("register.verifying")}` : loading ? t("widget.loading") : t("register.createShop")}
              </button>
            </div>
          </form>
        )}
      </div>

      <p className="mt-6 text-center text-sm text-zinc-500">
        <Link href="/" className="hover:underline">
          {t("nav.home")}
        </Link>
      </p>
    </div>
  );
}
