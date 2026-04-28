"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "@/hooks/use-translation";
import { Settings2, Users, MessageSquare, Ban, User } from "lucide-react";
import { ForwardArrow } from "@/components/ui/nav-arrow";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { LocaleSwitcher } from "@/components/ui/locale-switcher";
import { useAuthStore } from "@/stores/auth-store";
import { apiClient } from "@/lib/api-client";
import { StaffAvatar } from "@/components/ui/staff-avatar";
import { GoogleLoginButton } from "@/components/auth/GoogleLoginButton";
import { useState } from "react";
import toast from "react-hot-toast";

/** Israeli mobile: 05X-XXXXXXX (10 digits) */
function isValidIsraeliPhone(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  return digits.length === 10 && digits.startsWith("05");
}

const SECTIONS = [
  {
    href: "/admin/settings/general",
    icon: Settings2,
    iconColor: "text-blue-600",
    key: "settings.generalSettings",
    descKey: "settings.generalSettingsDesc",
  },
  {
    href: "/admin/settings/employees",
    icon: Users,
    iconColor: "text-emerald-600",
    key: "settings.employees",
    descKey: "settings.vacationApprovalDesc",
  },
  {
    href: "/admin/settings/arrival-confirmation",
    icon: MessageSquare,
    iconColor: "text-amber-600",
    key: "settings.arrivalConfirmation",
    descKey: "settings.arrivalConfirmationDesc",
  },
  {
    href: "/admin/settings/blocklist",
    icon: Ban,
    iconColor: "text-red-600",
    key: "settings.customerBlocklist",
    descKey: "settings.customerBlocklistDesc",
  },
  {
    href: "/admin/settings/profile",
    icon: User,
    iconColor: "text-violet-600",
    key: "settings.profile",
    descKey: "settings.profileDesc",
  },
] as const;

export default function AdminSettingsPage() {
  const t = useTranslation();
  const user = useAuthStore((s) => s.user);
  const setAuth = useAuthStore((s) => s.setAuth);
  const businessId = useAuthStore((s) => s.user?.businessId);

  const [linkPhone, setLinkPhone] = useState("");
  const [linkCode, setLinkCode] = useState("");
  const [linkPhoneStep, setLinkPhoneStep] = useState<"phone" | "code">("phone");
  const [linkPhoneLoading, setLinkPhoneLoading] = useState(false);
  const { data: profileStaff } = useQuery<{
    firstName?: string;
    lastName?: string;
    avatarUrl?: string | null;
  }>({
    queryKey: ["staff", "me"],
    queryFn: () => apiClient("/staff/me"),
    enabled: !!businessId && !!user?.staffId,
  });
  const managerDisplayName =
    [profileStaff?.firstName, profileStaff?.lastName].filter(Boolean).join(" ").trim() ||
    user?.name ||
    user?.email ||
    "—";

  return (
    <div className="space-y-8">
      <div>
        <h1 className="mb-2 text-2xl font-semibold">{t("nav.settings")}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          {t("settings.subtitle")}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {SECTIONS.map(({ href, icon: Icon, iconColor, key, descKey }) => (
          <Link
            key={href}
            href={href}
            className="group flex flex-col rounded-xl border border-zinc-200 bg-white p-6 transition-all hover:border-[var(--primary)] hover:shadow-md dark:border-zinc-700 dark:bg-zinc-800 dark:hover:border-[var(--primary)]"
          >
            <div
              className={`mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-zinc-100 dark:bg-zinc-700 ${iconColor}`}
            >
              <Icon className="h-6 w-6" />
            </div>
            <h2 className="mb-1 font-semibold group-hover:text-[var(--primary)]">
              {t(key)}
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {t(descKey)}
            </p>
            {href === "/admin/settings/profile" ? (
              <div className="mt-3 flex items-center gap-3">
                <StaffAvatar
                  avatarUrl={profileStaff?.avatarUrl ?? null}
                  firstName={profileStaff?.firstName ?? ""}
                  lastName={profileStaff?.lastName ?? ""}
                  size="sm"
                />
                <p className="truncate text-sm font-medium text-zinc-700 dark:text-zinc-300">
                  {managerDisplayName}
                </p>
              </div>
            ) : null}
            <ForwardArrow className="mt-auto h-5 w-5 text-zinc-400 group-hover:text-[var(--primary)]" />
          </Link>
        ))}
      </div>

      {/* כל השאר - Other settings */}
      <div className="space-y-6 mb-15">
        <h2 className="text-lg font-semibold">{t("settings.rest")}</h2>

        <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
          <h3 className="mb-4 font-medium">{t("settings.theme")}</h3>
          <p className="mb-2 text-sm text-zinc-500 dark:text-zinc-400">
            {t("settings.themeDesc")}
          </p>
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">
            {t("settings.themeTopbarHint")}
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
                            toast.error(
                              (e instanceof Error ? e.message : "") === "Invalid OTP"
                                ? t("auth.invalidOtp")
                                : (e instanceof Error ? e.message : t("auth.invalidOtp"))
                            );
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
                  buttonId="settings-link-google"
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
