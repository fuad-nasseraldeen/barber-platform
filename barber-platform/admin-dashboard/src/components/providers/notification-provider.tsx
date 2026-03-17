"use client";

import { useNotifications } from "@/hooks/use-notifications";
import { ToastContainer } from "@/components/ui/toast";
import { useToastStore } from "@/stores/toast-store";

export function NotificationProvider({ children }: { children: React.ReactNode }) {
  useNotifications();
  const { toasts, dismissToast } = useToastStore();

  return (
    <>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </>
  );
}
