"use client";

import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useBranchStore } from "@/stores/branch-store";

export default function AdminWaitlistPage() {
  const businessId = useAuthStore((s) => s.user?.businessId);
  const branchId = useBranchStore((s) => s.selectedBranchId);

  const { data, isLoading } = useQuery({
    queryKey: ["waitlist", businessId, branchId ?? "all"],
    queryFn: () =>
      apiClient<unknown[]>(
        `/waitlist?businessId=${businessId}&status=ACTIVE${branchId ? `&branchId=${branchId}` : ""}&limit=50`
      ),
    enabled: !!businessId,
  });

  const items = Array.isArray(data) ? data : [];

  if (!businessId) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold">Waitlist</h1>
        <p className="text-zinc-600 dark:text-zinc-400">
          Please log in to view the waitlist.
        </p>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold">Waitlist</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Loading...</p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">Waitlist</h1>
      <p className="mb-6 text-zinc-600 dark:text-zinc-400">
        Active waitlist entries ({items.length})
      </p>
      {items.length > 0 ? (
        <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800">
          <pre className="overflow-auto p-4 text-sm">
            {JSON.stringify(items, null, 2)}
          </pre>
        </div>
      ) : (
        <p className="text-zinc-500">No active waitlist entries.</p>
      )}
    </div>
  );
}
