"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, ensureValidToken } from "@/lib/api-client";
import toast from "react-hot-toast";
import { X } from "lucide-react";

type BlockTimeDialogProps = {
  open: boolean;
  onClose: () => void;
  businessId: string;
  staffId: string;
  dateYmd: string;
  onSuccess?: () => void;
  title: string;
  startLabel: string;
  endLabel: string;
  cancelLabel: string;
  saveLabel: string;
  /** Shown in toast on success; defaults to saveLabel */
  successToast?: string;
};

export function BlockTimeDialog({
  open,
  onClose,
  businessId,
  staffId,
  dateYmd,
  onSuccess,
  title,
  startLabel,
  endLabel,
  cancelLabel,
  saveLabel,
  successToast,
}: BlockTimeDialogProps) {
  const qc = useQueryClient();
  const [startTime, setStartTime] = useState("12:00");
  const [endTime, setEndTime] = useState("13:00");

  const mutation = useMutation({
    mutationFn: async () => {
      await ensureValidToken();
      await apiClient("/staff/breaks/exception", {
        method: "POST",
        body: JSON.stringify({
          staffId,
          businessId,
          date: dateYmd,
          startTime,
          endTime,
          kind: "TIME_BLOCK",
        }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["staff", staffId, "breaks"] });
      qc.invalidateQueries({ queryKey: ["staff", "breaks", "admin"] });
      toast.success(successToast ?? saveLabel);
      onSuccess?.();
      onClose();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Error"),
  });

  if (!open) return null;

  return (
    <div className="block-time-dialog-overlay fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-6 shadow-2xl dark:border-zinc-700 dark:bg-zinc-900">
        <div className="mb-4 flex items-start justify-between gap-2">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
            aria-label={cancelLabel}
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <p className="mb-4 text-sm text-zinc-600 dark:text-zinc-400">{dateYmd}</p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {startLabel}
            </label>
            <input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              className="w-full rounded-xl border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400">
              {endLabel}
            </label>
            <input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              className="w-full rounded-xl border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl px-4 py-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={mutation.isPending || !staffId}
            onClick={() => mutation.mutate()}
            className="btn-primary rounded-xl px-4 py-2 text-sm font-medium disabled:opacity-50"
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
