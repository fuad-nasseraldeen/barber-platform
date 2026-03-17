"use client";

import { useEffect, useState } from "react";

export type ToastType = "info" | "success" | "warning" | "error";

export interface ToastItem {
  id: string;
  type: ToastType;
  title: string;
  message?: string;
  duration?: number;
}

interface ToastProps {
  toast: ToastItem;
  onDismiss: (id: string) => void;
}

function Toast({ toast, onDismiss }: ToastProps) {
  const [visible, setVisible] = useState(false);
  const duration = toast.duration ?? 5000;

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(() => onDismiss(toast.id), 300);
    }, duration);
    return () => clearTimeout(t);
  }, [toast.id, duration, onDismiss]);

  const typeStyles: Record<ToastType, string> = {
    info: "border-blue-500/50 bg-blue-500/10 dark:bg-blue-500/20",
    success: "border-emerald-500/50 bg-emerald-500/10 dark:bg-emerald-500/20",
    warning: "border-amber-500/50 bg-amber-500/10 dark:bg-amber-500/20",
    error: "border-red-500/50 bg-red-500/10 dark:bg-red-500/20",
  };

  return (
    <div
      role="alert"
      className={`pointer-events-auto rounded-lg border px-4 py-3 shadow-lg transition-opacity duration-300 ease-out ${
        typeStyles[toast.type]
      } ${visible ? "opacity-100" : "opacity-0"}`}
    >
      <p className="font-medium text-zinc-900 dark:text-zinc-100">{toast.title}</p>
      {toast.message && (
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          {toast.message}
        </p>
      )}
    </div>
  );
}

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
}

export function ToastContainer({ toasts, onDismiss }: ToastContainerProps) {
  return (
    <div
      className="fixed bottom-4 right-4 z-50 flex max-w-sm flex-col gap-2"
      dir="ltr"
    >
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  );
}
