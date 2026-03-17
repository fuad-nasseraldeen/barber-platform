"use client";

import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api-client";
import { useBranchStore, type Branch } from "@/stores/branch-store";
import { useTranslation } from "@/hooks/use-translation";

interface BranchSelectorProps {
  businessId: string;
  className?: string;
}

export function BranchSelector({ businessId, className = "" }: BranchSelectorProps) {
  const t = useTranslation();
  const { selectedBranchId, setSelectedBranch } = useBranchStore();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!businessId) {
      setLoading(false);
      return;
    }
    apiClient<Branch[]>(`/branches?businessId=${businessId}`)
      .then((data) => {
        setBranches(data);
        if (data.length === 1 && !selectedBranchId) {
          setSelectedBranch(data[0].id);
        }
      })
      .catch(() => setBranches([]))
      .finally(() => setLoading(false));
  }, [businessId, selectedBranchId, setSelectedBranch]);

  if (loading || branches.length === 0) {
    return null;
  }

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <select
        id="branch-select"
        value={selectedBranchId ?? ""}
        onChange={(e) => setSelectedBranch(e.target.value || null)}
        className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-1.5 text-sm text-zinc-700 focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-800/50 dark:text-zinc-200"
      >
        <option value="">{t("branches.allBranches")}</option>
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {/^main\s*branch$/i.test(b.name) ? t("branches.mainBranch") : b.name}
          </option>
        ))}
      </select>
    </div>
  );
}
