"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, ensureValidToken } from "@/lib/api-client";
import toast from "react-hot-toast";
import { X } from "lucide-react";

export type RemovableTimeBlock = {
  id: string;
  staffId: string;
  staffName: string;
  startTime: string;
  endTime: string;
};

type RemoveTimeBlocksDialogProps = {
  open: boolean;
  onClose: () => void;
  businessId: string;
  items: RemovableTimeBlock[];
  dateHeading: string;
  title: string;
  emptyLabel: string;
  removeLabel: string;
  removedToast: string;
  closeLabel: string;
};

export function RemoveTimeBlocksDialog({
  open,
  onClose,
  businessId,
  items,
  dateHeading,
  title,
  emptyLabel,
  removeLabel,
  removedToast,
  closeLabel,
}: RemoveTimeBlocksDialogProps) {
  const qc = useQueryClient();

  const deleteOne = useMutation({
    mutationFn: async ({ id, staffId }: { id: string; staffId: string }) => {
      await ensureValidToken();
      await apiClient(
        `/staff/breaks/exception/${encodeURIComponent(id)}?staffId=${encodeURIComponent(staffId)}&businessId=${encodeURIComponent(businessId)}`,
        { method: "DELETE" },
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["staff", "breaks", "admin", businessId] });
      toast.success(removedToast);
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={closeLabel}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-sm font-medium text-zinc-800 dark:text-zinc-200" dir="auto">
          {dateHeading}
        </p>
        {items.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">{emptyLabel}</p>
        ) : (
          <ul className="max-h-[min(50vh,20rem)] space-y-2 overflow-y-auto pe-0.5">
            {items.map((it) => (
              <li
                key={`${it.id}-${it.staffId}`}
                className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200/90 px-3 py-2.5 dark:border-zinc-600"
              >
                <div className="min-w-0 flex-1" dir="auto">
                  <p className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">{it.staffName}</p>
                  <p className="text-xs text-zinc-600 dark:text-zinc-400" dir="ltr">
                    {it.startTime} – {it.endTime}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={deleteOne.isPending}
                  onClick={() => deleteOne.mutate({ id: it.id, staffId: it.staffId })}
                  className="shrink-0 rounded-lg border border-red-200 bg-red-50 px-2.5 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-100 disabled:opacity-50 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/70"
                >
                  {removeLabel}
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {closeLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
