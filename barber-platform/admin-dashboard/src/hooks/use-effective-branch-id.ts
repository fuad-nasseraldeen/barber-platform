import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useBranchStore } from "@/stores/branch-store";
import { resolveDefaultBranchId } from "@/lib/branch-default";

/**
 * Selected branch from the store, or main/first branch once the list loads
 * (matches BranchSelector default — no "all branches" mode).
 */
export function useEffectiveBranchId(businessId: string | undefined): string | null {
  const selectedBranchId = useBranchStore((s) => s.selectedBranchId);
  const { data: branches = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["branches", businessId],
    queryFn: () => apiClient<{ id: string; name: string }[]>(`/branches?businessId=${businessId}`),
    enabled: !!businessId,
  });
  const fallback = useMemo(() => resolveDefaultBranchId(branches), [branches]);
  if (selectedBranchId && branches.some((b) => b.id === selectedBranchId)) {
    return selectedBranchId;
  }
  return fallback;
}
