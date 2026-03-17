"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useTranslation } from "@/hooks/use-translation";
import { Pencil, Clock, DollarSign } from "lucide-react";

interface StaffServiceItem {
  id: string;
  durationMinutes: number;
  price: number;
  service: { id: string; name: string };
}

interface StaffProfile {
  id: string;
  firstName: string;
  lastName: string;
  staffServices: StaffServiceItem[];
}

export default function StaffServicesPage() {
  const t = useTranslation();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<StaffServiceItem | null>(null);
  const [duration, setDuration] = useState(30);
  const [price, setPrice] = useState(0);

  const { data: staff, isLoading } = useQuery<StaffProfile>({
    queryKey: ["staff", "me"],
    queryFn: () => apiClient<StaffProfile>("/staff/me"),
  });

  const updateMutation = useMutation({
    mutationFn: (updates: { staffServiceId: string; durationMinutes?: number; price?: number }[]) =>
      apiClient<StaffProfile>("/staff/me/services", {
        method: "PATCH",
        body: JSON.stringify({ updates }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", "me"] });
      setEditing(null);
    },
  });

  const openEdit = (ss: StaffServiceItem) => {
    setEditing(ss);
    setDuration(ss.durationMinutes);
    setPrice(Number(ss.price));
  };

  const handleSave = () => {
    if (!editing) return;
    updateMutation.mutate([
      { staffServiceId: editing.id, durationMinutes: duration, price },
    ]);
  };

  if (isLoading) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold">{t("nav.services")}</h1>
        <p className="text-zinc-500">{t("widget.loading")}</p>
      </div>
    );
  }

  if (!staff) {
    return (
      <div>
        <h1 className="mb-6 text-2xl font-semibold">{t("nav.services")}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Staff profile not found.</p>
      </div>
    );
  }

  const services = staff.staffServices ?? [];

  return (
    <div>
      <h1 className="mb-2 text-2xl font-semibold">{t("nav.services")}</h1>
      <p className="mb-6 text-zinc-600 dark:text-zinc-400">
        השירותים שהוקצו לך על ידי המנהל. ניתן לערוך מחיר ומשך לכל שירות.
      </p>

      {updateMutation.error && (
        <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {updateMutation.error instanceof Error
            ? updateMutation.error.message
            : "Update failed"}
        </div>
      )}

      {services.length === 0 ? (
        <div className="rounded-xl border border-dashed border-zinc-300 p-12 text-center dark:border-zinc-600">
          <p className="text-zinc-500 dark:text-zinc-400">
            אין שירותים שהוקצו לך. בקש מהמנהל להקצות שירותים.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {services.map((ss) => (
            <div
              key={ss.id}
              className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
            >
              <div>
                <h3 className="font-semibold">{ss.service.name}</h3>
                <p className="flex items-center gap-4 text-sm text-zinc-500">
                  <span className="flex items-center gap-1">
                    <Clock className="h-4 w-4" />
                    {ss.durationMinutes} דקות
                  </span>
                  <span className="flex items-center gap-1">
                    <DollarSign className="h-4 w-4" />
                    ₪{Number(ss.price).toFixed(0)}
                  </span>
                </p>
              </div>
              {editing?.id === ss.id ? (
                <div className="flex items-center gap-2">
                  <div>
                    <span className="mb-0.5 block text-xs text-zinc-500">{t("services.duration")}</span>
                    <input
                      type="number"
                      min={1}
                      max={480}
                      value={duration}
                      onChange={(e) => setDuration(parseInt(e.target.value, 10) || 30)}
                      className="w-20 rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                    />
                  </div>
                  <div>
                    <span className="mb-0.5 block text-xs text-zinc-500">{t("services.price")}</span>
                    <input
                      type="number"
                      min={0}
                      value={price}
                      onChange={(e) => setPrice(parseFloat(e.target.value) || 0)}
                      className="w-24 rounded-lg border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-600 dark:bg-zinc-800"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={handleSave}
                    disabled={updateMutation.isPending}
                    className="btn-primary rounded-lg px-3 py-1 text-sm"
                  >
                    שמור
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(null)}
                    className="rounded-lg border border-zinc-300 px-3 py-1 text-sm dark:border-zinc-600"
                  >
                    ביטול
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => openEdit(ss)}
                  className="rounded p-1.5 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-700 dark:hover:text-zinc-300"
                  aria-label="Edit"
                >
                  <Pencil className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
