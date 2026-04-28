"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, apiUpload } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { User, Camera } from "lucide-react";
import { LoadingButton } from "@/components/ui/loading-button";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LocaleSwitcher } from "@/components/ui/locale-switcher";
import { GoogleLoginButton } from "@/components/auth/GoogleLoginButton";
import toast from "react-hot-toast";

interface ProfileStaff {
  id: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  avatarUrl: string | null;
}

/** Israeli mobile: 05X-XXXXXXX (10 digits) */
function isValidIsraeliPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 && digits.startsWith("05");
}

export default function EmployeeProfilePage() {
  const t = useTranslation();
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);
  const accessToken = useAuthStore((s) => s.accessToken);
  const businessId = useAuthStore((s) => s.user?.businessId);
  const profilePhotoRef = useRef<HTMLInputElement>(null);

  const [linkPhone, setLinkPhone] = useState("");
  const [linkCode, setLinkCode] = useState("");
  const [linkPhoneStep, setLinkPhoneStep] = useState<"phone" | "code">("phone");
  const [linkPhoneLoading, setLinkPhoneLoading] = useState(false);

  const { data: profileStaff } = useQuery<ProfileStaff>({
    queryKey: ["staff", "me"],
    queryFn: () => apiClient<ProfileStaff>("/staff/me"),
    enabled: !!businessId,
  });

  const [profileForm, setProfileForm] = useState({
    firstName: "",
    lastName: "",
    phone: "",
  });

  const profileUpdateMutation = useMutation({
    mutationFn: (data: { firstName: string; lastName: string; phone?: string }) =>
      apiClient("/staff/me", {
        method: "PATCH",
        body: JSON.stringify({
          firstName: data.firstName,
          lastName: data.lastName,
          phone: data.phone || undefined,
        }),
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["staff", "me"] });
      const newName = `${variables.firstName} ${variables.lastName}`.trim();
      if (newName && user && accessToken) {
        setAuth({ ...user, name: newName }, accessToken);
      }
      toast.success(t("widget.saved"));
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save"),
  });

  const profilePhotoMutation = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("photo", file);
      return apiUpload<ProfileStaff>("/staff/me/photo", fd);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", "me"] });
      toast.success(t("widget.saved"));
    },
    onError: (e: Error) => toast.error(e.message || "Failed to upload"),
  });

  useEffect(() => {
    if (profileStaff) {
      setProfileForm({
        firstName: profileStaff.firstName,
        lastName: profileStaff.lastName,
        phone: profileStaff.phone ?? "",
      });
    }
  }, [profileStaff]);

  if (!businessId) {
    return (
      <div>
        <p className="text-zinc-600 dark:text-zinc-400">
          {t("widget.loading")}
        </p>
      </div>
    );
  }

  if (!profileStaff) {
    return (
      <div>
        <p className="text-zinc-600 dark:text-zinc-400">
          {t("widget.loading")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 flex items-center gap-2 text-2xl font-semibold">
          <User className="h-6 w-6 text-violet-600" />
          {t("topbar.profile")}
        </h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {t("employee.profileDesc")}
        </p>
      </div>

      {/* Profile form */}
      <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
        <h2 className="mb-4 font-semibold">{t("settings.profile")}</h2>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            profileUpdateMutation.mutate(profileForm);
          }}
          className="flex flex-col gap-4 sm:flex-row sm:items-start"
        >
          <div className="relative shrink-0">
            <div className="h-20 w-20 overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-600">
              {profileStaff.avatarUrl ? (
                <img
                  src={
                    profileStaff.avatarUrl.startsWith("http")
                      ? profileStaff.avatarUrl
                      : `${process.env.NEXT_PUBLIC_API_URL || ""}${profileStaff.avatarUrl}`
                  }
                  alt=""
                  className="h-full w-full object-cover"
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-2xl font-medium text-zinc-500">
                  {profileStaff.firstName?.[0]}
                  {profileStaff.lastName?.[0]}
                </div>
              )}
            </div>
            <input
              ref={profilePhotoRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) profilePhotoMutation.mutate(f);
                e.target.value = "";
              }}
            />
            <button
              type="button"
              onClick={() => profilePhotoRef.current?.click()}
              className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full bg-zinc-700 text-white shadow dark:bg-zinc-600"
              aria-label={t("employee.changePhoto")}
            >
              <Camera className="h-4 w-4" />
            </button>
          </div>
          <div className="min-w-0 flex-1 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("staff.name")}
                </label>
                <input
                  type="text"
                  value={profileForm.firstName}
                  onChange={(e) =>
                    setProfileForm((p) => ({ ...p, firstName: e.target.value }))
                  }
                  placeholder={t("register.firstName")}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">&nbsp;</label>
                <input
                  type="text"
                  value={profileForm.lastName}
                  onChange={(e) =>
                    setProfileForm((p) => ({ ...p, lastName: e.target.value }))
                  }
                  placeholder={t("register.lastName")}
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">
                {t("staff.phone")}
              </label>
              <input
                type="tel"
                value={profileForm.phone}
                onChange={(e) =>
                  setProfileForm((p) => ({ ...p, phone: e.target.value }))
                }
                placeholder="050xxxxxxxx"
                className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
              />
            </div>
            <LoadingButton
              type="submit"
              loading={profileUpdateMutation.isPending}
            >
              {t("settings.save")}
            </LoadingButton>
          </div>
        </form>
      </div>

      {/* Theme & Language */}
      <div className="space-y-6">
        <h2 className="text-lg font-semibold">{t("settings.rest")}</h2>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
          <h3 className="mb-4 font-medium">{t("settings.theme")}</h3>
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
            {t("settings.themeDesc")}
          </p>
          <ThemeToggle />
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
          <h3 className="mb-4 font-medium">{t("settings.language")}</h3>
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
            {t("settings.languageDesc")}
          </p>
          <LocaleSwitcher />
        </section>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
          <h3 className="mb-4 font-medium">{t("settings.accountLinking")}</h3>
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
            {t("settings.accountLinkingDesc")}
          </p>
          <div className="space-y-4">
            <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 dark:border-zinc-600">
              <div>
                <p className="font-medium">{t("auth.phone")}</p>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {user?.phone ? user.phone : "—"}
                </p>
              </div>
              {user?.phone ? (
                <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-sm font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                  ✓ {t("settings.phoneLinked")}
                </span>
              ) : (
                <div className="min-w-0 flex-1 sm:max-w-xs">
                  {linkPhoneStep === "phone" ? (
                    <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
                      <input
                        type="tel"
                        value={linkPhone}
                        onChange={(e) => setLinkPhone(e.target.value)}
                        placeholder="050xxxxxxxx"
                        className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          setLinkPhoneLoading(true);
                          try {
                            await apiClient("/auth/request-otp", {
                              method: "POST",
                              body: JSON.stringify({ phone: linkPhone }),
                            });
                            setLinkPhoneStep("code");
                            toast.success(t("auth.sendCode"));
                          } catch (e) {
                            toast.error(
                              e instanceof Error ? e.message : "Failed"
                            );
                          } finally {
                            setLinkPhoneLoading(false);
                          }
                        }}
                        disabled={
                          linkPhoneLoading ||
                          !isValidIsraeliPhone(linkPhone)
                        }
                        className="btn-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                      >
                        {linkPhoneLoading ? t("widget.loading") : t("register.sendCode")}
                      </button>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
                      <input
                        type="text"
                        value={linkCode}
                        onChange={(e) => setLinkCode(e.target.value)}
                        placeholder={t("auth.verificationCode")}
                        maxLength={6}
                        className="flex-1 rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100"
                      />
                      <button
                        type="button"
                        onClick={async () => {
                          setLinkPhoneLoading(true);
                          try {
                            const res = await apiClient<{
                              accessToken: string;
                              user: { id: string; phone?: string; email?: string; name?: string; businessId?: string; role?: string; staffId?: string };
                            }>("/auth/link-phone", {
                              method: "POST",
                              body: JSON.stringify({
                                phone: linkPhone,
                                code: linkCode,
                              }),
                            });
                            setAuth(
                              {
                                id: res.user.id,
                                phone: res.user.phone,
                                email: res.user.email,
                                name: res.user.name,
                                businessId: res.user.businessId,
                                role:
                                  (res.user.role as "owner" | "manager" | "staff" | "customer") ??
                                  "customer",
                                staffId: res.user.staffId,
                              },
                              res.accessToken
                            );
                            toast.success(t("settings.phoneLinked"));
                            setLinkPhone("");
                            setLinkCode("");
                            setLinkPhoneStep("phone");
                          } catch (e) {
                            const msg = e instanceof Error ? e.message : "";
                            toast.error(msg === "Invalid OTP" ? t("auth.invalidOtp") : msg || t("auth.invalidOtp"));
                          } finally {
                            setLinkPhoneLoading(false);
                          }
                        }}
                        disabled={
                          linkPhoneLoading || linkCode.length < 4
                        }
                        className="btn-primary rounded-lg px-3 py-2 text-sm disabled:opacity-50"
                      >
                        {linkPhoneLoading ? t("widget.loading") : t("auth.verify")}
                      </button>
                    </div>
                  )}
                  {linkPhoneStep === "code" && (
                    <button
                      type="button"
                      onClick={() => setLinkPhoneStep("phone")}
                      className="mt-2 text-xs text-zinc-500 hover:underline"
                    >
                      {t("auth.changePhone")}
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3 rounded-lg border border-zinc-200 p-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4 dark:border-zinc-600">
              <div>
                <p className="font-medium">Google</p>
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  {user?.email ? user.email : "—"}
                </p>
              </div>
              {user?.email ? (
                <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-sm font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-400">
                  ✓ {t("settings.googleLinked")}
                </span>
              ) : (
                <GoogleLoginButton
                  buttonId="employee-profile-link-google"
                  onSuccess={async (result) => {
                    try {
                      const res = await apiClient<{
                        accessToken: string;
                        user: { id: string; phone?: string; email?: string; name?: string; businessId?: string; role?: string; staffId?: string };
                      }>("/auth/link-google", {
                        method: "POST",
                        body: JSON.stringify({
                          credential: result.credential,
                          nonce: result.nonce,
                        }),
                      });
                      setAuth(
                        {
                          id: res.user.id,
                          phone: res.user.phone,
                          email: res.user.email,
                          name: res.user.name,
                          businessId: res.user.businessId,
                          role:
                            (res.user.role as "owner" | "manager" | "staff" | "customer") ??
                            "customer",
                          staffId: res.user.staffId,
                        },
                        res.accessToken
                      );
                      toast.success(t("settings.googleLinked"));
                    } catch (e) {
                      toast.error(
                        e instanceof Error ? e.message : "Failed to link Google"
                      );
                    }
                  }}
                  onError={(e) => toast.error(e.message)}
                />
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
