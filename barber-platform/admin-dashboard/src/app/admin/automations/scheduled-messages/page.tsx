"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { Plus, Pencil, Trash2, Calendar, X } from "lucide-react";
import toast from "react-hot-toast";

type AutomationRule = {
  id: string;
  businessId: string;
  name: string;
  isActive: boolean;
  triggerType: string;
  conditions: unknown;
  actions: {
    channels?: string[];
    messageTemplate?: string;
    hoursBefore?: number;
    hoursAfter?: number;
    scheduleCron?: string;
    sendAt?: string;
    scheduleType?: string;
  } | null;
  createdAt: string;
  updatedAt: string;
};

type FormData = {
  name: string;
  isActive: boolean;
  triggerType: "birthday_message" | "appointment_reminder" | "appointment_after" | "scheduled_message";
  scheduleType?: "specific_date" | "every_day" | "after_appointment" | "before_appointment" | "once_week" | "once_month";
  actions: {
    channels: ("SMS" | "EMAIL" | "IN_APP")[];
    messageTemplate: string;
    hoursBefore?: number;
    hoursAfter?: number;
    scheduleCron?: string;
    sendAt?: string;
    dayOfWeek?: number;
    dayOfMonth?: number;
  };
};

const SCHEDULE_OPTIONS = [
  { value: "specific_date", key: "automations.scheduleSpecificDate" },
  { value: "every_day", key: "automations.scheduleEveryDay" },
  { value: "after_appointment", key: "automations.scheduleAfterAppointment" },
  { value: "before_appointment", key: "automations.scheduleBeforeAppointment" },
  { value: "once_week", key: "automations.scheduleOnceWeek" },
  { value: "once_month", key: "automations.scheduleOnceMonth" },
] as const;

const TIME_AFTER_OPTIONS = [
  { value: 30, label: "30 דקות" },
  { value: 60, label: "שעה" },
  { value: 90, label: "1 שעות ו-30 דקות" },
  { value: 120, label: "2 שעות" },
  { value: 150, label: "2 שעות ו-30 דקות" },
  { value: 180, label: "3 שעות" },
  { value: 1440, label: "יום" },
];

const DEFAULT_FORM: FormData = {
  name: "",
  isActive: true,
  triggerType: "scheduled_message",
  scheduleType: "every_day",
  actions: {
    channels: ["SMS", "IN_APP"],
    messageTemplate: "",
    scheduleCron: "0 9 * * *",
  },
};

function scheduleTypeToTrigger(scheduleType: string): FormData["triggerType"] {
  if (scheduleType === "before_appointment") return "appointment_reminder";
  if (scheduleType === "after_appointment") return "appointment_after";
  return "scheduled_message";
}

function buildScheduleCron(scheduleType: string, dayOfWeek?: number, dayOfMonth?: number): string {
  if (scheduleType === "every_day") return "0 9 * * *";
  if (scheduleType === "once_week") return `0 9 * * ${dayOfWeek ?? 0}`;
  if (scheduleType === "once_month") return `0 9 ${dayOfMonth ?? 1} * *`;
  return "0 9 * * *";
}

export default function ScheduledMessagesPage() {
  const t = useTranslation();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<AutomationRule | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState<FormData>(DEFAULT_FORM);

  const { data: rules, isLoading } = useQuery<AutomationRule[]>({
    queryKey: ["automations", businessId],
    queryFn: () =>
      apiClient<AutomationRule[]>(`/automation/rules?businessId=${businessId}`),
    enabled: !!businessId,
  });

  const createMutation = useMutation({
    mutationFn: (body: FormData & { businessId: string }) => {
      const triggerType = scheduleTypeToTrigger(body.scheduleType ?? "every_day");
      const scheduleType = body.scheduleType ?? "every_day";
      const cron = buildScheduleCron(
        scheduleType,
        body.actions.dayOfWeek,
        body.actions.dayOfMonth
      );
      const actions: Record<string, unknown> = {
        channels: body.actions.channels,
        messageTemplate: body.actions.messageTemplate,
      };
      if (triggerType === "appointment_reminder") {
        actions.hoursBefore = body.actions.hoursBefore ?? 24;
      } else if (triggerType === "appointment_after") {
        actions.hoursAfter = body.actions.hoursAfter ?? 60;
      } else {
        if (scheduleType === "specific_date" && body.actions.sendAt) {
          actions.sendAt = body.actions.sendAt;
        } else {
          actions.scheduleCron = cron;
        }
      }
      return apiClient<AutomationRule>("/automation/rules", {
        method: "POST",
        body: JSON.stringify({
          businessId: body.businessId,
          name: body.name,
          isActive: body.isActive,
          triggerType: triggerType === "appointment_after" ? "scheduled_message" : triggerType,
          conditions: [],
          actions,
        }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations", businessId] });
      setShowModal(false);
      setForm(DEFAULT_FORM);
      toast.success(t("widget.saved"));
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: FormData }) =>
      apiClient<AutomationRule>(`/automation/rules/${id}?businessId=${businessId}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations", businessId] });
      setEditing(null);
      setShowModal(false);
      setForm(DEFAULT_FORM);
      toast.success(t("widget.saved"));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) =>
      apiClient(`/automation/rules/${id}?businessId=${businessId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["automations", businessId] });
      toast.success(t("widget.saved"));
    },
  });

  const openAdd = () => {
    setForm({
      ...DEFAULT_FORM,
      scheduleType: "every_day",
      actions: {
        channels: ["SMS", "IN_APP"],
        messageTemplate: "",
        scheduleCron: "0 9 * * *",
      },
    });
    setEditing(null);
    setShowModal(true);
  };

  const openEdit = (rule: AutomationRule) => {
    const actions = rule.actions ?? {};
    let scheduleType: FormData["scheduleType"] = "every_day";
    if (rule.triggerType === "appointment_reminder") scheduleType = "before_appointment";
    else if (rule.triggerType === "appointment_after") scheduleType = "after_appointment";
    else if (actions.sendAt) scheduleType = "specific_date";
    setForm({
      name: rule.name,
      isActive: rule.isActive,
      triggerType: (rule.triggerType as FormData["triggerType"]) || "scheduled_message",
      scheduleType,
      actions: {
        channels: (actions.channels ?? ["SMS", "IN_APP"]) as FormData["actions"]["channels"],
        messageTemplate: actions.messageTemplate ?? "",
        hoursBefore: actions.hoursBefore,
        hoursAfter: actions.hoursAfter,
        scheduleCron: actions.scheduleCron,
        sendAt: actions.sendAt,
      },
    });
    setEditing(rule);
    setShowModal(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editing) {
      updateMutation.mutate({ id: editing.id, body: form });
    } else if (businessId) {
      createMutation.mutate({ ...form, businessId });
    }
  };

  const handleDelete = (rule: AutomationRule) => {
    if (confirm(t("automations.confirmDelete"))) {
      deleteMutation.mutate(rule.id);
    }
  };

  const scheduledRules = rules?.filter(
    (r) =>
      r.triggerType === "scheduled_message" ||
      r.triggerType === "appointment_reminder"
  ) ?? [];

  if (!businessId) {
    return (
      <div>
        <p className="text-zinc-600 dark:text-zinc-400">
          Please log in to view this page.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
      <h1 className="mb-2 flex items-center gap-2 text-xl font-semibold">
        <Calendar className="h-6 w-6 text-blue-600" />
        {t("automations.sectionScheduled")}
      </h1>
      <p className="mb-6 text-sm text-zinc-500 dark:text-zinc-400">
        {t("automations.sectionScheduledDesc")}
      </p>
      <div className="mb-4">
        <button
          type="button"
          onClick={openAdd}
          className="btn-primary flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium"
        >
          <Plus className="h-4 w-4" />
          {t("automations.addScheduled")}
        </button>
      </div>
      {isLoading ? (
        <p className="text-zinc-500">{t("widget.loading")}</p>
      ) : scheduledRules.length > 0 ? (
        <div className="space-y-3">
          {scheduledRules.map((rule) => (
            <div
              key={rule.id}
              className={`flex items-center justify-between rounded-lg border border-zinc-200 p-4 dark:border-zinc-600 ${
                !rule.isActive ? "opacity-60" : ""
              }`}
            >
              <div>
                <h3 className="font-medium">{rule.name}</h3>
                <p className="text-sm text-zinc-500">
                  {rule.triggerType === "appointment_reminder" &&
                    `${t("automations.scheduleBeforeAppointment")} (${rule.actions?.hoursBefore ?? 24}h)`}
                  {rule.triggerType === "scheduled_message" &&
                    (rule.actions?.sendAt
                      ? t("automations.scheduleSpecificDate")
                      : rule.actions?.scheduleCron
                      ? t("automations.triggerScheduled")
                      : t("automations.triggerScheduled"))}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-xs ${
                    rule.isActive
                      ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  {rule.isActive ? t("automations.active") : t("automations.inactive")}
                </span>
                <button
                  type="button"
                  onClick={() => openEdit(rule)}
                  className="rounded p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-700"
                  aria-label={t("automations.edit")}
                >
                  <Pencil className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleDelete(rule)}
                  className="rounded p-2 text-zinc-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                  aria-label={t("automations.delete")}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500 dark:border-zinc-600">
          {t("automations.empty")}
        </p>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex min-h-[100dvh] items-center justify-center bg-black/70 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-zinc-200 bg-white p-6 shadow-xl dark:border-zinc-700 dark:bg-zinc-900">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold">
                {editing ? t("automations.edit") : t("automations.addScheduled")}
              </h2>
              <button
                type="button"
                onClick={() => { setShowModal(false); setEditing(null); }}
                className="rounded p-2 text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800"
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium">
                  {t("automations.whenToSend")}
                </label>
                <div className="flex flex-wrap gap-2">
                  {SCHEDULE_OPTIONS.map(({ value, key }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        setForm((p) => ({
                          ...p,
                          scheduleType: value,
                          triggerType: scheduleTypeToTrigger(value),
                          actions: {
                            ...p.actions,
                            hoursBefore: value === "before_appointment" ? 24 : undefined,
                            hoursAfter: value === "after_appointment" ? 60 : undefined,
                            sendAt: value === "specific_date" ? p.actions.sendAt : undefined,
                            scheduleCron: buildScheduleCron(value),
                          },
                        }))
                      }
                      className={`rounded-xl px-4 py-2 text-sm font-medium transition-colors ${
                        form.scheduleType === value
                          ? "bg-primary text-primary-foreground"
                          : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-600 dark:text-zinc-300 dark:hover:bg-zinc-800"
                      }`}
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>

              {(form.scheduleType === "after_appointment" || form.scheduleType === "before_appointment") && (
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("automations.timeSettings")}
                  </label>
                  <p className="mb-2 text-xs text-zinc-500">
                    {form.scheduleType === "after_appointment"
                      ? t("automations.howLongAfter")
                      : t("automations.howLongBefore")}
                  </p>
                  <select
                    value={
                      form.scheduleType === "after_appointment"
                        ? form.actions.hoursAfter ?? 60
                        : form.actions.hoursBefore ?? 24
                    }
                    onChange={(e) => {
                      const v = parseInt(e.target.value, 10);
                      setForm((p) => ({
                        ...p,
                        actions: {
                          ...p.actions,
                          ...(form.scheduleType === "after_appointment"
                            ? { hoursAfter: v }
                            : { hoursBefore: v }),
                        },
                      }));
                    }}
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                  >
                    {form.scheduleType === "after_appointment"
                      ? TIME_AFTER_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))
                      : [1, 2, 6, 12, 24, 48, 72].map((h) => (
                          <option key={h} value={h}>
                            {h} {h === 1 ? "hour" : "hours"}
                          </option>
                        ))}
                  </select>
                </div>
              )}

              {form.scheduleType === "specific_date" && (
                <div>
                  <label className="mb-1 block text-sm font-medium">
                    {t("automations.selectDate")}
                  </label>
                  <input
                    type="datetime-local"
                    value={form.actions.sendAt?.slice(0, 16) ?? ""}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        actions: {
                          ...p.actions,
                          sendAt: e.target.value ? new Date(e.target.value).toISOString() : undefined,
                        },
                      }))
                    }
                    className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                  />
                </div>
              )}

              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("automations.name")}
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                  placeholder="e.g. Daily reminder"
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium">
                  {t("automations.messageTemplate")}
                </label>
                <textarea
                  rows={3}
                  value={form.actions.messageTemplate}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      actions: { ...p.actions, messageTemplate: e.target.value },
                    }))
                  }
                  className="w-full rounded-lg border border-zinc-300 px-3 py-2 dark:border-zinc-600 dark:bg-zinc-800"
                  placeholder="{{name}} for customer name"
                />
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      setForm((p) => ({
                        ...p,
                        actions: {
                          ...p.actions,
                          messageTemplate: p.actions.messageTemplate + " {{name}}",
                        },
                      }))
                    }
                    className="rounded-lg border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600"
                  >
                    {t("automations.customerName")}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setForm((p) => ({
                        ...p,
                        actions: {
                          ...p.actions,
                          messageTemplate: p.actions.messageTemplate + " {{address}}",
                        },
                      }))
                    }
                    className="rounded-lg border border-zinc-300 px-2 py-1 text-xs dark:border-zinc-600"
                  >
                    {t("automations.address")}
                  </button>
                </div>
              </div>

              <div>
                <label className="flex cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    checked={form.actions.channels.includes("SMS")}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        actions: {
                          ...p.actions,
                          channels: e.target.checked
                            ? [...p.actions.channels, "SMS"]
                            : p.actions.channels.filter((c) => c !== "SMS"),
                        },
                      }))
                    }
                  />
                  <span className="text-sm">{t("automations.sendViaSms")}</span>
                </label>
              </div>

              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={form.isActive}
                  onChange={(e) => setForm((p) => ({ ...p, isActive: e.target.checked }))}
                />
                <span className="text-sm">{t("automations.active")}</span>
              </label>

              <div className="flex justify-end gap-2 pt-4">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setEditing(null); }}
                  className="rounded-lg px-4 py-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                >
                  {t("automations.cancel")}
                </button>
                <button
                  type="submit"
                  disabled={createMutation.isPending || updateMutation.isPending}
                  className="btn-primary rounded-lg px-4 py-2 disabled:opacity-50"
                >
                  {editing ? t("automations.save") : t("automations.create")}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
