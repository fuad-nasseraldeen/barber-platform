"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient, ensureValidToken } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import toast from "react-hot-toast";
import { Plus, Trash2 } from "lucide-react";
import { StaffSelector } from "@/components/appointments/staff-selector";

type BreakException = {
  id: string;
  date: string;
  startTime: string;
  endTime: string;
};

type WeeklyBreak = {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
};

type BreaksResponse = {
  weeklyBreaks: WeeklyBreak[];
  exceptions: BreakException[];
};

type StaffMember = {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
};

const DAY_NAMES_HE = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"];

function formatDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

export default function AdminBreaksPage() {
  const t = useTranslation();
  const queryClient = useQueryClient();
  const businessId = useAuthStore((s) => s.user?.businessId);

  const [selectedStaffId, setSelectedStaffId] = useState("");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [modalOpen, setModalOpen] = useState(false);
  const [weeklyModalOpen, setWeeklyModalOpen] = useState(false);
  const [form, setForm] = useState({
    date: formatDate(new Date()),
    startTime: "12:00",
    endTime: "13:00",
    recurrence: "ONCE" as "ONCE" | "DAILY" | "WEEKLY",
    endDate: formatDate(new Date()),
  });
  const [weeklyForm, setWeeklyForm] = useState({
    daysOfWeek: [] as number[],
    startTime: "12:00",
    endTime: "13:00",
    durationType: "permanent" as "permanent" | "untilDate",
    endDate: formatDate(new Date()),
  });

  const rangeStart = formatDate(currentDate);
  const rangeEnd = (() => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 13);
    return formatDate(d);
  })();

  const { data: staffList = [], isLoading: staffLoading } = useQuery<StaffMember[]>({
    queryKey: ["staff", businessId, "breaks"],
    queryFn: () =>
      apiClient<StaffMember[]>(`/staff?businessId=${businessId}&includeInactive=false`),
    enabled: !!businessId,
  });

  const { data: breaksData, isLoading: breaksLoading } = useQuery<BreaksResponse>({
    queryKey: ["staff", selectedStaffId, "breaks", rangeStart, rangeEnd],
    queryFn: () =>
      apiClient<BreaksResponse>(
        `/staff/${selectedStaffId}/breaks?startDate=${rangeStart}&endDate=${rangeEnd}&businessId=${businessId}`
      ),
    enabled: !!businessId && !!selectedStaffId,
  });

  const addMutation = useMutation({
    mutationFn: async (payload: {
      staffIds: string[];
      date: string;
      startTime: string;
      endTime: string;
      businessId: string;
      recurrence?: "ONCE" | "DAILY" | "WEEKLY";
      endDate?: string;
    }) => {
      await ensureValidToken();
      const { staffIds, date, startTime, endTime, businessId, recurrence, endDate } = payload;
      for (const staffId of staffIds) {
        if (recurrence && recurrence !== "ONCE" && endDate) {
          await apiClient("/staff/breaks/bulk", {
            method: "POST",
            body: JSON.stringify({
              staffId,
              businessId,
              startDate: date,
              endDate,
              startTime,
              endTime,
              recurrence,
            }),
          });
        } else {
          await apiClient("/staff/breaks/exception", {
            method: "POST",
            body: JSON.stringify({
              staffId,
              businessId,
              date,
              startTime,
              endTime,
            }),
          });
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      setModalOpen(false);
      toast.success(t("breaks.added"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("employee.failed")),
  });

  const deleteExceptionMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient(
        `/staff/breaks/exception/${id}?staffId=${selectedStaffId}&businessId=${businessId}`,
        { method: "DELETE" }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", selectedStaffId, "breaks"] });
      toast.success(t("breaks.deleted"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("employee.failed")),
  });

  const addWeeklyMutation = useMutation({
    mutationFn: async (payload: {
      staffIds: string[];
      businessId: string;
      daysOfWeek: number[];
      startTime: string;
      endTime: string;
      durationType: "permanent" | "untilDate";
      startDate: string;
      endDate?: string;
    }) => {
      await ensureValidToken();
      const { staffIds, businessId, daysOfWeek, startTime, endTime, durationType, startDate, endDate } = payload;
      if (daysOfWeek.length === 0) throw new Error("Select at least one day");

      if (durationType === "untilDate" && endDate) {
        await apiClient("/staff/breaks/bulk-weekly-range", {
          method: "POST",
          body: JSON.stringify({
            staffIds,
            businessId,
            daysOfWeek,
            startDate,
            endDate,
            startTime,
            endTime,
          }),
        });
      } else {
        await apiClient("/staff/breaks/bulk-weekly", {
          method: "POST",
          body: JSON.stringify({
            staffIds,
            businessId,
            daysOfWeek,
            startTime,
            endTime,
          }),
        });
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff"] });
      setWeeklyModalOpen(false);
      toast.success(t("breaks.added"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("employee.failed")),
  });

  const deleteWeeklyMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient(
        `/staff/breaks/weekly/${id}?staffId=${selectedStaffId}&businessId=${businessId}`,
        { method: "DELETE" }
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["staff", selectedStaffId, "breaks"] });
      toast.success(t("breaks.deleted"));
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : t("employee.failed")),
  });

  const exceptions = breaksData?.exceptions ?? [];
  const weeklyBreaks = breaksData?.weeklyBreaks ?? [];

  const exceptionsByDate = useMemo(() => {
    const m = new Map<string, BreakException[]>();
    const exs = breaksData?.exceptions ?? [];
    for (const ex of exs) {
      const d = ex.date.slice(0, 10);
      if (!m.has(d)) m.set(d, []);
      m.get(d)!.push(ex);
    }
    return m;
  }, [breaksData?.exceptions]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!businessId) return;
    const staffIds = selectedStaffId ? [selectedStaffId] : staffList.map((s) => s.id);
    if (staffIds.length === 0) return;
    addMutation.mutate({
      staffIds,
      businessId,
      date: form.date,
      startTime: form.startTime,
      endTime: form.endTime,
      recurrence: form.recurrence,
      endDate: form.recurrence !== "ONCE" ? form.endDate : undefined,
    });
  };

  const selectedStaff = staffList.find((s) => s.id === selectedStaffId);

  return (
    <div className="space-y-6 pb-12">
      <div>
        <h1 className="mb-2 text-2xl font-semibold">{t("breaks.title")}</h1>
        <p className="text-zinc-600 dark:text-zinc-400">{t("staff.breaks")}</p>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
        <p className="mb-2 text-sm font-medium text-zinc-600 dark:text-zinc-400">
          {t("appointments.selectStaffMember")}
        </p>
        <StaffSelector
          staffList={staffList}
          selected={selectedStaffId}
          onSelect={setSelectedStaffId}
          allLabel={t("appointments.allStaff")}
        />
      </div>

      {!selectedStaffId ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-600 dark:text-zinc-400">
            <p className="mb-4">{t("breaks.addToAllStaff")}</p>
            <div className="flex justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setWeeklyForm({
                    daysOfWeek: [],
                    startTime: "12:00",
                    endTime: "13:00",
                    durationType: "permanent",
                    endDate: formatDate(new Date()),
                  });
                  setWeeklyModalOpen(true);
                }}
                className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                {t("breaks.addWeekly")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setForm({
                    date: formatDate(currentDate),
                    startTime: "12:00",
                    endTime: "13:00",
                    recurrence: "ONCE",
                    endDate: formatDate(currentDate),
                  });
                  setModalOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-600"
              >
                <Plus className="h-4 w-4" />
                {t("breaks.add")}
              </button>
            </div>
          </div>
        </div>
      ) : staffLoading || breaksLoading ? (
        <p className="text-zinc-500">{t("widget.loading")}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <h2 className="font-semibold">
              {selectedStaff
                ? `${selectedStaff.firstName} ${selectedStaff.lastName}`
                : t("breaks.title")}
            </h2>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  setForm({
                    date: formatDate(currentDate),
                    startTime: "12:00",
                    endTime: "13:00",
                    recurrence: "ONCE",
                    endDate: formatDate(currentDate),
                  });
                  setModalOpen(true);
                }}
                className="btn-primary inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium"
              >
                <Plus className="h-4 w-4" />
                {t("breaks.add")}
              </button>
              <button
                type="button"
                onClick={() => {
                  setWeeklyForm({
                    daysOfWeek: [],
                    startTime: "12:00",
                    endTime: "13:00",
                    durationType: "permanent",
                    endDate: formatDate(new Date()),
                  });
                  setWeeklyModalOpen(true);
                }}
                className="inline-flex items-center gap-2 rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium dark:border-zinc-600"
              >
                {t("breaks.addWeekly")}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-4">
            <div>
              <label className="mb-1 block text-sm text-zinc-600 dark:text-zinc-400">
                {t("breaks.viewFrom")}
              </label>
              <input
                type="date"
                value={formatDate(currentDate)}
                onChange={(e) => setCurrentDate(new Date(e.target.value))}
                className="rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
              />
            </div>
          </div>

          <div className="space-y-6">
            {weeklyBreaks.length > 0 && (
              <div>
                <h2 className="mb-3 font-semibold">{t("breaks.weeklyRecurring")}</h2>
                <div className="space-y-2">
                  {weeklyBreaks.map((wb) => (
                    <div
                      key={wb.id}
                      className="flex items-center justify-between rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
                    >
                      <span>
                        {DAY_NAMES_HE[wb.dayOfWeek]} · {wb.startTime} – {wb.endTime}
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteWeeklyMutation.mutate(wb.id)}
                        className="rounded p-1.5 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div>
              <h2 className="mb-3 font-semibold">{t("breaks.dateSpecific")}</h2>
              {exceptions.length === 0 ? (
                <p className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-600">
                  {t("breaks.empty")}
                </p>
              ) : (
                <div className="space-y-2">
                  {Array.from(exceptionsByDate.entries())
                    .sort(([a], [b]) => a.localeCompare(b))
                    .map(([date, exs]) => (
                      <div
                        key={date}
                        className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
                      >
                        <p className="mb-2 font-medium text-zinc-700 dark:text-zinc-300">
                          {new Date(date + "T12:00").toLocaleDateString("he-IL", {
                            weekday: "long",
                            day: "numeric",
                            month: "long",
                          })}
                        </p>
                        <div className="space-y-2">
                          {exs.map((ex) => (
                            <div
                              key={ex.id}
                              className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900"
                            >
                              <span className="tabular-nums">
                                {ex.startTime} – {ex.endTime}
                              </span>
                              <button
                                type="button"
                                onClick={() => deleteExceptionMutation.mutate(ex.id)}
                                className="rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {weeklyModalOpen && businessId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setWeeklyModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold">
              {selectedStaffId ? t("breaks.addWeekly") : t("breaks.addToAllStaff")}
            </h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const days = weeklyForm.daysOfWeek.length > 0 ? weeklyForm.daysOfWeek : [0, 1, 2, 3, 4, 5, 6];
                const staffIds = selectedStaffId ? [selectedStaffId] : staffList.map((s) => s.id);
                if (staffIds.length === 0) {
                  toast.error(t("employee.failed"));
                  return;
                }
                if (days.length === 0) {
                  toast.error(t("breaks.selectDays"));
                  return;
                }
                if (weeklyForm.durationType === "untilDate" && !weeklyForm.endDate) {
                  toast.error(t("breaks.endDate"));
                  return;
                }
                addWeeklyMutation.mutate({
                  staffIds,
                  businessId,
                  daysOfWeek: days,
                  startTime: weeklyForm.startTime,
                  endTime: weeklyForm.endTime,
                  durationType: weeklyForm.durationType,
                  startDate: formatDate(currentDate),
                  endDate: weeklyForm.durationType === "untilDate" ? weeklyForm.endDate : undefined,
                });
              }}
              className="space-y-4"
            >
              <div>
                <label className="mb-2 block text-sm font-medium">{t("breaks.selectDays")}</label>
                <div className="flex flex-wrap gap-2">
                  <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600">
                    <input
                      type="checkbox"
                      checked={weeklyForm.daysOfWeek.length === 7}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setWeeklyForm((p) => ({ ...p, daysOfWeek: [0, 1, 2, 3, 4, 5, 6] }));
                        } else {
                          setWeeklyForm((p) => ({ ...p, daysOfWeek: [] }));
                        }
                      }}
                      className="rounded"
                    />
                    <span>{t("breaks.allDays")}</span>
                  </label>
                  {DAY_NAMES_HE.map((name, i) => (
                    <label
                      key={i}
                      className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600"
                    >
                      <input
                        type="checkbox"
                        checked={weeklyForm.daysOfWeek.includes(i)}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setWeeklyForm((p) => ({
                              ...p,
                              daysOfWeek: [...p.daysOfWeek, i].sort((a, b) => a - b),
                            }));
                          } else {
                            setWeeklyForm((p) => ({
                              ...p,
                              daysOfWeek: p.daysOfWeek.filter((d) => d !== i),
                            }));
                          }
                        }}
                        className="rounded"
                      />
                      <span>{name}</span>
                    </label>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("breaks.startTime")}</label>
                  <input
                    type="time"
                    value={weeklyForm.startTime}
                    onChange={(e) =>
                      setWeeklyForm((p) => ({ ...p, startTime: e.target.value }))
                    }
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("breaks.endTime")}</label>
                  <input
                    type="time"
                    value={weeklyForm.endTime}
                    onChange={(e) =>
                      setWeeklyForm((p) => ({ ...p, endTime: e.target.value }))
                    }
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                  />
                </div>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium">{t("breaks.recurrence")}</label>
                <div className="flex gap-4">
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="durationType"
                      checked={weeklyForm.durationType === "permanent"}
                      onChange={() =>
                        setWeeklyForm((p) => ({ ...p, durationType: "permanent" as const }))
                      }
                    />
                    <span>{t("breaks.permanent")}</span>
                  </label>
                  <label className="flex cursor-pointer items-center gap-2">
                    <input
                      type="radio"
                      name="durationType"
                      checked={weeklyForm.durationType === "untilDate"}
                      onChange={() =>
                        setWeeklyForm((p) => ({ ...p, durationType: "untilDate" as const }))
                      }
                    />
                    <span>{t("breaks.untilDate")}</span>
                  </label>
                </div>
              </div>
              {weeklyForm.durationType === "untilDate" && (
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("breaks.endDate")}</label>
                  <input
                    type="date"
                    value={weeklyForm.endDate}
                    onChange={(e) =>
                      setWeeklyForm((p) => ({ ...p, endDate: e.target.value }))
                    }
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                  />
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setWeeklyModalOpen(false)}
                  className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600"
                >
                  {t("services.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={addWeeklyMutation.isPending}
                  className="btn-primary flex-1 rounded-lg px-4 py-2 disabled:opacity-50"
                >
                  {addWeeklyMutation.isPending ? t("widget.loading") : t("breaks.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {modalOpen && businessId && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-md rounded-xl bg-white p-6 dark:bg-zinc-900"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="mb-4 text-lg font-semibold">
              {selectedStaffId ? t("breaks.add") : t("breaks.addToAllStaff")}
            </h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium">{t("breaks.date")}</label>
                <input
                  type="date"
                  value={form.date}
                  onChange={(e) => setForm((p) => ({ ...p, date: e.target.value }))}
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("breaks.startTime")}</label>
                  <input
                    type="time"
                    value={form.startTime}
                    onChange={(e) => setForm((p) => ({ ...p, startTime: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("breaks.endTime")}</label>
                  <input
                    type="time"
                    value={form.endTime}
                    onChange={(e) => setForm((p) => ({ ...p, endTime: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                  />
                </div>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium">{t("breaks.recurrence")}</label>
                <select
                  value={form.recurrence}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      recurrence: e.target.value as "ONCE" | "DAILY" | "WEEKLY",
                    }))
                  }
                  className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                >
                  <option value="ONCE">{t("breaks.once")}</option>
                  <option value="DAILY">{t("breaks.daily")}</option>
                  <option value="WEEKLY">{t("breaks.weekly")}</option>
                </select>
              </div>
              {form.recurrence !== "ONCE" && (
                <div>
                  <label className="mb-1 block text-sm font-medium">{t("breaks.endDate")}</label>
                  <input
                    type="date"
                    value={form.endDate}
                    onChange={(e) => setForm((p) => ({ ...p, endDate: e.target.value }))}
                    className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                  />
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="flex-1 rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600"
                >
                  {t("services.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={addMutation.isPending}
                  className="btn-primary flex-1 rounded-lg px-4 py-2 disabled:opacity-50"
                >
                  {addMutation.isPending ? t("widget.loading") : t("breaks.save")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
