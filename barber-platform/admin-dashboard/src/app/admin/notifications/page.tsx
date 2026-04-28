"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";
import { useTranslation } from "@/hooks/use-translation";
import { MessageSquare, Send, UserPlus } from "lucide-react";
import { LoadingButton } from "@/components/ui/loading-button";
import toast from "react-hot-toast";

type TabId = "app-entry" | "push" | "new-customer";

type PushTemplate = {
  id: string;
  title: string;
  message: string;
  url?: string;
  sendSms?: boolean;
};

type PushMessageHistory = {
  id: string;
  title: string;
  message: string;
  url?: string;
  sendSms: boolean;
  sendAt: string;
  target: "all" | "selected";
  customerIds: string[];
  createdAt: string;
};

interface BusinessSettings {
  appEntryMessage?: {
    locales?: Record<string, { title: string; message: string }>;
    title?: string;
    message?: string;
    visible: boolean;
  };
  newCustomerMessage?: {
    enabled: boolean;
    locales?: Record<string, { body: string }>;
    body?: string;
    healthDeclarationLink?: string;
    sendSms: boolean;
  };
  notificationTemplates?: PushTemplate[];
  pushMessagesHistory?: PushMessageHistory[];
}

type CustomerOption = {
  id: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
};

function getAppEntryContent(settings: BusinessSettings["appEntryMessage"]) {
  const defaults = { title: "ברוכים הבאים ל־{{appName}}", message: "" };
  if (settings?.locales?.he) return settings.locales.he;
  return { title: settings?.title ?? defaults.title, message: settings?.message ?? defaults.message };
}

function getNewCustomerBody(settings: BusinessSettings["newCustomerMessage"]) {
  if (settings?.locales?.he?.body != null) return settings.locales.he.body;
  return settings?.body ?? "";
}

export default function AdminNotificationsPage() {
  const t = useTranslation();
  const queryClient = useQueryClient();
  const businessId = useAuthStore((s) => s.user?.businessId);
  const [activeTab, setActiveTab] = useState<TabId>("app-entry");
  const [customerSearch, setCustomerSearch] = useState("");

  const { data: business } = useQuery({
    queryKey: ["business", businessId],
    queryFn: () =>
      apiClient<{ name: string; settings?: BusinessSettings }>(`/business/by-id/${businessId}`),
    enabled: !!businessId,
  });

  const settings = business?.settings ?? {};
  const appEntry = settings.appEntryMessage ?? { visible: false };
  const newCustomer = settings.newCustomerMessage ?? {
    enabled: false,
    healthDeclarationLink: "",
    sendSms: false,
  };

  const [appEntryLocal, setAppEntryLocal] = useState(getAppEntryContent(settings.appEntryMessage));
  const [newCustomerBody, setNewCustomerBody] = useState(getNewCustomerBody(settings.newCustomerMessage));
  const appEntryTitleRef = useRef<HTMLInputElement>(null);
  const appEntryMessageRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setAppEntryLocal(getAppEntryContent(settings.appEntryMessage));
    setNewCustomerBody(getNewCustomerBody(settings.newCustomerMessage));
  }, [business?.settings]);

  const updateSettingsMutation = useMutation({
    mutationFn: (updates: Partial<BusinessSettings>) =>
      apiClient(`/business/${businessId}`, {
        method: "PATCH",
        body: JSON.stringify({
          settings: { ...settings, ...updates },
        }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business", businessId] });
      toast.success(t("widget.saved"));
    },
    onError: (e: Error) => toast.error(e.message || "Failed to save"),
  });

  const { data: customers = [] } = useQuery<CustomerOption[]>({
    queryKey: ["customers", businessId, "notifications-push"],
    queryFn: () => apiClient<CustomerOption[]>(`/customers?businessId=${businessId}`),
    enabled: !!businessId && activeTab === "push",
  });

  const [pushForm, setPushForm] = useState({
    title: "",
    message: "",
    url: "",
    target: "all" as "all" | "selected",
    customerIds: [] as string[],
    sendSms: false,
    saveAsTemplate: false,
    sendAt: "",
  });

  const visibleCustomers = useMemo(() => {
    const term = customerSearch.trim().toLowerCase();
    if (!term) return customers;
    return customers.filter((c) => {
      const name = `${c.firstName ?? ""} ${c.lastName ?? ""}`.trim().toLowerCase();
      const phone = (c.phone ?? "").toLowerCase();
      return name.includes(term) || phone.includes(term);
    });
  }, [customers, customerSearch]);

  const toggleCustomer = (id: string) => {
    setPushForm((p) => {
      const has = p.customerIds.includes(id);
      return {
        ...p,
        customerIds: has ? p.customerIds.filter((x) => x !== id) : [...p.customerIds, id],
      };
    });
  };

  const handleAppEntrySave = (data?: { title?: string; message?: string; visible?: boolean }) => {
    const payload = data ?? {};
    const title = payload.title ?? appEntryLocal.title;
    const message = payload.message ?? appEntryLocal.message;
    updateSettingsMutation.mutate({
      appEntryMessage: {
        ...appEntry,
        locales: { he: { title, message } },
        title,
        message,
        visible: payload.visible ?? appEntry.visible,
      },
    });
  };

  const handleNewCustomerSave = (data: Partial<typeof newCustomer> & { body?: string }) => {
    const body = data.body ?? newCustomerBody;
    updateSettingsMutation.mutate({
      newCustomerMessage: {
        ...newCustomer,
        ...data,
        locales: { he: { body } },
        body,
      },
    });
  };

  const handleSendPush = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pushForm.title || !pushForm.message) {
      toast.error("Title and message are required");
      return;
    }
    if (pushForm.target === "selected" && pushForm.customerIds.length === 0) {
      toast.error("בחר לפחות לקוח אחד");
      return;
    }

    const history = settings.pushMessagesHistory ?? [];
    const templates = settings.notificationTemplates ?? [];
    const sendAt = pushForm.sendAt
      ? new Date(pushForm.sendAt).toISOString()
      : new Date().toISOString();
    const item: PushMessageHistory = {
      id: crypto.randomUUID(),
      title: pushForm.title,
      message: pushForm.message,
      url: pushForm.url || undefined,
      sendSms: pushForm.sendSms,
      sendAt,
      target: pushForm.target,
      customerIds: pushForm.target === "all" ? [] : pushForm.customerIds,
      createdAt: new Date().toISOString(),
    };

    updateSettingsMutation.mutate(
      {
        pushMessagesHistory: [item, ...history].slice(0, 100),
        ...(pushForm.saveAsTemplate
          ? {
              notificationTemplates: [
                ...templates,
                {
                  id: crypto.randomUUID(),
                  title: pushForm.title,
                  message: pushForm.message,
                  url: pushForm.url || undefined,
                  sendSms: pushForm.sendSms,
                },
              ],
            }
          : {}),
      },
      {
        onSuccess: () => {
          toast.success("ההתראה נשמרה ונכנסה לתזמון");
          setPushForm((p) => ({
            ...p,
            title: "",
            message: "",
            url: "",
            customerIds: [],
            sendAt: "",
          }));
        },
      },
    );
  };

  const insertAppNamePlaceholder = () => {
    const placeholder = "{{appName}}";
    const input = appEntryTitleRef.current;
    const ta = appEntryMessageRef.current;
    const active = document.activeElement;
    if (active === input && input) {
      const start = input.selectionStart ?? 0;
      const end = input.selectionEnd ?? 0;
      const val = appEntryLocal.title;
      const next = val.slice(0, start) + placeholder + val.slice(end);
      setAppEntryLocal((p) => ({ ...p, title: next }));
      setTimeout(() => {
        input.focus();
        input.setSelectionRange(start + placeholder.length, start + placeholder.length);
      }, 0);
    } else if (ta) {
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;
      const val = appEntryLocal.message;
      const next = val.slice(0, start) + placeholder + val.slice(end);
      setAppEntryLocal((p) => ({ ...p, message: next }));
      setTimeout(() => {
        ta.focus();
        ta.setSelectionRange(start + placeholder.length, start + placeholder.length);
      }, 0);
    }
  };

  const tabs = [
    { id: "app-entry" as const, label: t("notifications.tabAppEntry"), icon: MessageSquare },
    { id: "push" as const, label: t("notifications.tabPush"), icon: Send },
    { id: "new-customer" as const, label: t("notifications.tabNewCustomer"), icon: UserPlus },
  ];

  const pushTemplates = settings.notificationTemplates ?? [];
  const pushHistory = settings.pushMessagesHistory ?? [];

  return (
    <div>
      <h1 className="mb-6 text-2xl font-semibold">{t("notifications.title")}</h1>
      <p className="mb-8 text-zinc-600 dark:text-zinc-400">{t("notifications.subtitle")}</p>

      <div className="mb-6 flex gap-2 border-b border-zinc-200 dark:border-zinc-700">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setActiveTab(id)}
            className={`flex items-center gap-2 border-b-2 px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === id
                ? "border-[var(--primary)] text-[var(--primary)]"
                : "border-transparent text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
            }`}
          >
            <Icon className="h-4 w-4" />
            {label}
          </button>
        ))}
      </div>

      {activeTab === "app-entry" && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-4 font-medium">{t("notifications.appEntryTitle")}</h2>
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">{t("notifications.appEntryDesc")}</p>
          <div className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">{t("notifications.titleLabel")}</label>
              <input
                ref={appEntryTitleRef}
                type="text"
                value={appEntryLocal.title}
                onChange={(e) => setAppEntryLocal((p) => ({ ...p, title: e.target.value }))}
                placeholder="ברוכים הבאים ל־{{appName}}"
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("notifications.messageLabel")}</label>
              <textarea
                ref={appEntryMessageRef}
                value={appEntryLocal.message}
                onChange={(e) => setAppEntryLocal((p) => ({ ...p, message: e.target.value }))}
                rows={3}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-zinc-700 dark:text-zinc-300">
                {t("settings.arrivalPlaceholdersTitle")}
              </p>
              <button
                type="button"
                onClick={insertAppNamePlaceholder}
                className="rounded-full border border-[var(--primary)]/40 bg-[var(--primary)]/10 px-3 py-1.5 text-sm font-medium text-[var(--primary)] transition-colors hover:bg-[var(--primary)]/20 dark:border-[var(--primary)]/50 dark:bg-[var(--primary)]/15 dark:hover:bg-[var(--primary)]/25"
              >
                {t("notifications.phAppName")}
              </button>
            </div>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={appEntry.visible}
                onChange={(e) => {
                  handleAppEntrySave({ visible: e.target.checked });
                }}
              />
              <span className="text-sm">{t("notifications.showMessage")}</span>
            </label>
            <button
              type="button"
              onClick={() => handleAppEntrySave(appEntryLocal)}
              disabled={updateSettingsMutation.isPending}
              className="btn-primary rounded-lg px-4 py-2 text-sm font-medium"
            >
              {updateSettingsMutation.isPending ? t("settings.saving") : t("settings.save")}
            </button>
          </div>
        </div>
      )}

      {activeTab === "push" && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-4 font-medium">{t("notifications.pushTitle")}</h2>
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">{t("notifications.pushDesc")}</p>
          <form onSubmit={handleSendPush} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium">{t("notifications.titleLabel")}</label>
              <input
                type="text"
                value={pushForm.title}
                onChange={(e) => setPushForm((p) => ({ ...p, title: e.target.value }))}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("notifications.messageLabel")}</label>
              <textarea
                value={pushForm.message}
                onChange={(e) => setPushForm((p) => ({ ...p, message: e.target.value }))}
                rows={3}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("notifications.optionalUrl")}</label>
              <input
                type="url"
                value={pushForm.url}
                onChange={(e) => setPushForm((p) => ({ ...p, url: e.target.value }))}
                placeholder="https://..."
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">שלח אל</label>
              <select
                value={pushForm.target}
                onChange={(e) =>
                  setPushForm((p) => ({
                    ...p,
                    target: e.target.value as "all" | "selected",
                  }))
                }
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              >
                <option value="all">כל הלקוחות</option>
                <option value="selected">לקוח/לקוחות ספציפיים</option>
              </select>
            </div>

            {pushForm.target === "selected" && (
              <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-700">
                <input
                  type="search"
                  value={customerSearch}
                  onChange={(e) => setCustomerSearch(e.target.value)}
                  placeholder="חפש לקוח לפי שם או טלפון"
                  className="mb-2 w-full rounded-lg border border-zinc-300 px-3 py-2 text-sm dark:border-zinc-600 dark:bg-zinc-900"
                />
                <div className="max-h-48 space-y-1 overflow-y-auto">
                  {visibleCustomers.map((customer) => {
                    const name = `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || customer.phone || "—";
                    const checked = pushForm.customerIds.includes(customer.id);
                    return (
                      <label
                        key={customer.id}
                        className="flex cursor-pointer items-center justify-between rounded-md px-2 py-1 hover:bg-zinc-100 dark:hover:bg-zinc-700/50"
                      >
                        <span className="text-sm">{name}</span>
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleCustomer(customer.id)}
                        />
                      </label>
                    );
                  })}
                </div>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  נבחרו {pushForm.customerIds.length} לקוחות
                </p>
              </div>
            )}

            <div>
              <label className="mb-1 block text-sm font-medium">מתי לשלוח</label>
              <input
                type="datetime-local"
                value={pushForm.sendAt}
                onChange={(e) => setPushForm((p) => ({ ...p, sendAt: e.target.value }))}
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              />
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                אם ריק, ההודעה תישמר לשליחה מיידית.
              </p>
            </div>

            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={pushForm.sendSms}
                onChange={(e) => setPushForm((p) => ({ ...p, sendSms: e.target.checked }))}
              />
              <span className="text-sm">{t("notifications.sendSms")}</span>
            </label>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={pushForm.saveAsTemplate}
                onChange={(e) => setPushForm((p) => ({ ...p, saveAsTemplate: e.target.checked }))}
              />
              <span className="text-sm">שמור כתבנית לשימוש חוזר</span>
            </label>
            <button type="submit" className="btn-primary rounded-lg px-4 py-2 text-sm font-medium">
              {t("notifications.sendNotification")}
            </button>
          </form>

          {pushTemplates.length > 0 && (
            <div className="mt-8">
              <h3 className="mb-2 font-medium">{t("notifications.savedTemplates")}</h3>
              <div className="space-y-2">
                {pushTemplates.map((tmpl) => (
                  <button
                    type="button"
                    key={tmpl.id}
                    onClick={() =>
                      setPushForm((p) => ({
                        ...p,
                        title: tmpl.title,
                        message: tmpl.message,
                        url: tmpl.url ?? "",
                        sendSms: !!tmpl.sendSms,
                      }))
                    }
                    className="w-full rounded-lg border border-zinc-200 p-3 text-start hover:bg-zinc-50 dark:border-zinc-600 dark:hover:bg-zinc-700/40"
                  >
                    <p className="font-medium">{tmpl.title}</p>
                    <p className="line-clamp-2 text-sm text-zinc-500">{tmpl.message}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {pushHistory.length > 0 && (
            <div className="mt-8">
              <h3 className="mb-2 font-medium">התראות שנשמרו</h3>
              <div className="space-y-2">
                {pushHistory.slice(0, 10).map((msg) => (
                  <div
                    key={msg.id}
                    className="rounded-lg border border-zinc-200 p-3 text-sm dark:border-zinc-600"
                  >
                    <p className="font-medium">{msg.title}</p>
                    <p className="text-zinc-500 dark:text-zinc-400">{msg.message}</p>
                    <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                      {new Date(msg.sendAt).toLocaleString()} | {msg.target === "all" ? "כל הלקוחות" : `${msg.customerIds.length} לקוחות`} |{" "}
                      {msg.sendSms ? "SMS כן" : "SMS לא"}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === "new-customer" && (
        <div className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-800">
          <h2 className="mb-4 font-medium">{t("notifications.newCustomerTitle")}</h2>
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">{t("notifications.newCustomerDesc")}</p>
          <div className="space-y-4">
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={newCustomer.enabled}
                onChange={(e) => {
                  handleNewCustomerSave({ enabled: e.target.checked });
                }}
              />
              <span className="text-sm">{t("notifications.enableNewCustomer")}</span>
            </label>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("notifications.messageBody")}</label>
              <textarea
                value={newCustomerBody}
                onChange={(e) => setNewCustomerBody(e.target.value)}
                rows={4}
                placeholder="ברוכים הבאים! שמחים לראות אתכם..."
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium">{t("notifications.healthDeclLink")}</label>
              <input
                type="url"
                value={newCustomer.healthDeclarationLink ?? ""}
                onChange={(e) =>
                  handleNewCustomerSave({
                    healthDeclarationLink: e.target.value || undefined,
                  })
                }
                placeholder="https://..."
                className="w-full rounded-lg border border-zinc-300 px-4 py-2 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </div>
            <label className="flex cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                checked={newCustomer.sendSms}
                onChange={(e) => {
                  handleNewCustomerSave({ sendSms: e.target.checked });
                }}
              />
              <span className="text-sm">{t("notifications.sendSms")}</span>
            </label>
            <LoadingButton
              loading={updateSettingsMutation.isPending}
              onClick={() => handleNewCustomerSave({ body: newCustomerBody })}
            >
              {t("settings.save")}
            </LoadingButton>
          </div>
        </div>
      )}
    </div>
  );
}
