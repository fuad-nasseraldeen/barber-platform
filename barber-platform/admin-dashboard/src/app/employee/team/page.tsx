"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useBranchStore } from "@/stores/branch-store";
import { useTranslation } from "@/hooks/use-translation";
import { Users } from "lucide-react";
import { StaffAvatar } from "@/components/ui/staff-avatar";

type StaffMember = {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string | null;
  phone: string | null;
  branch?: { name: string } | null;
};

export default function EmployeeTeamPage() {
  const t = useTranslation();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const selectedBranchId = useBranchStore((s) => s.selectedBranchId);

  const params = new URLSearchParams({ businessId: businessId || "" });
  if (selectedBranchId) params.set("branchId", selectedBranchId);

  const { data: staffList, isLoading, error } = useQuery<StaffMember[]>({
    queryKey: ["staff", "list", businessId, selectedBranchId],
    queryFn: () => apiClient(`/staff?businessId=${businessId}&limit=100`),
    enabled: !!businessId,
    retry: false,
  });

  const list = Array.isArray(staffList) ? staffList : [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">{t("employee.team")}</h1>
      <p className="text-zinc-600 dark:text-zinc-400">
        {t("employee.teamSubtitle")}
      </p>

      {isLoading ? (
        <p className="text-zinc-500">{t("widget.loading")}</p>
      ) : error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-900/20">
          <p className="text-amber-800 dark:text-amber-200">
            {t("employee.teamManagerOnly")}
          </p>
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 p-12 dark:border-zinc-600">
          <Users className="mb-4 h-12 w-12 text-zinc-400" />
          <p className="text-zinc-500">{t("employee.noTeamMembers")}</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((s) => (
            <div
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
            >
              <StaffAvatar
                avatarUrl={s.avatarUrl ?? null}
                firstName={s.firstName}
                lastName={s.lastName}
                size="md"
              />
              <div className="min-w-0 flex-1">
                <p className="font-semibold">
                  {s.firstName} {s.lastName}
                </p>
              {s.phone && <p className="text-sm text-zinc-500">{s.phone}</p>}
              {s.branch?.name && (
                <p className="mt-1 text-xs text-zinc-400">
                  {/^main\s*branch$/i.test(s.branch.name)
                    ? t("branches.mainBranch")
                    : s.branch.name}
                </p>
              )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
