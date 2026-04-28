"use client";

import type { EmployeeProfileInfo } from "@/components/staff/profile/types";

type EmployeeProfileHeaderProps = {
  profile: EmployeeProfileInfo;
  subtitle: string;
  settlementModelLabel: string;
  earningsLabel: string;
  earningsValue: string;
  rangeLabel: string;
  isRtl: boolean;
};

export function EmployeeProfileHeader({
  profile,
  subtitle,
  settlementModelLabel,
  earningsLabel,
  earningsValue,
  rangeLabel,
  isRtl,
}: EmployeeProfileHeaderProps) {
  return (
    <section
      dir={isRtl ? "rtl" : "ltr"}
      className="relative overflow-hidden rounded-3xl border p-6 shadow-[0_26px_60px_-34px_rgba(0,0,0,0.55)]"
      style={{
        borderColor: "color-mix(in srgb, var(--primary) 28%, transparent)",
        background:
          "linear-gradient(135deg, color-mix(in srgb, var(--primary) 18%, var(--background)) 0%, var(--background) 56%, color-mix(in srgb, var(--primary) 10%, var(--background)) 100%)",
      }}
    >
      <div
        className="pointer-events-none absolute -top-16 -end-12 h-44 w-44 rounded-full opacity-70 blur-2xl"
        style={{ background: "color-mix(in srgb, var(--primary) 24%, transparent)" }}
      />
      <div
        className="relative z-10 flex flex-wrap items-start justify-between gap-5"
      >
        <div className="flex items-center gap-3">
          {profile.avatarUrl ? (
            <img
              src={profile.avatarUrl}
              alt={profile.fullName}
              className="h-20 w-20 rounded-3xl object-cover ring-2 ring-white/40"
            />
          ) : (
            <div
              className="flex h-20 w-20 items-center justify-center rounded-3xl text-2xl font-semibold"
              style={{
                background: "color-mix(in srgb, var(--primary) 20%, transparent)",
                color: "var(--primary)",
              }}
            >
              {profile.fullName
                .split(" ")
                .map((part) => part[0] ?? "")
                .join("")
                .slice(0, 2)
                .toUpperCase()}
            </div>
          )}

          <div>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{subtitle}</p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className="rounded-full px-3 py-1 text-xs font-semibold"
                style={{
                  background:
                    profile.statusTone === "negative"
                      ? "color-mix(in srgb, #ef4444 20%, transparent)"
                      : profile.statusTone === "risk"
                        ? "color-mix(in srgb, #f59e0b 22%, transparent)"
                        : profile.statusTone === "active"
                          ? "color-mix(in srgb, #10b981 20%, transparent)"
                          : "color-mix(in srgb, #71717a 30%, transparent)",
                  color:
                    profile.statusTone === "negative"
                      ? "#b91c1c"
                      : profile.statusTone === "risk"
                        ? "#b45309"
                        : profile.statusTone === "active"
                          ? "#047857"
                          : "#3f3f46",
                }}
              >
                {profile.statusLabel}
              </span>
              <span
                className="rounded-full px-3 py-1 text-xs font-semibold"
                style={{
                  background: "color-mix(in srgb, var(--primary) 20%, transparent)",
                  color: "var(--primary)",
                }}
              >
                {settlementModelLabel}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border px-4 py-3 text-right"
          style={{
            borderColor: "color-mix(in srgb, var(--primary) 24%, transparent)",
            background: "color-mix(in srgb, var(--primary) 10%, transparent)",
          }}
        >
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-zinc-500 dark:text-zinc-400">
            {earningsLabel}
          </p>
          <p className="mt-1 text-3xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
            {earningsValue}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{rangeLabel}</p>
        </div>
      </div>
    </section>
  );
}
