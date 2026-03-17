import { create } from "zustand";
import type { ToastItem, ToastType } from "@/components/ui/toast";

interface ToastState {
  toasts: ToastItem[];
  addToast: (toast: Omit<ToastItem, "id">) => void;
  dismissToast: (id: string) => void;
}

let id = 0;
function genId() {
  return `toast-${++id}-${Date.now()}`;
}

export const useToastStore = create<ToastState>()((set) => ({
  toasts: [],
  addToast: (toast) =>
    set((s) => ({
      toasts: [...s.toasts, { ...toast, id: genId() }],
    })),
  dismissToast: (id) =>
    set((s) => ({
      toasts: s.toasts.filter((t) => t.id !== id),
    })),
}));

export function showToast(
  title: string,
  options?: { message?: string; type?: ToastType; duration?: number }
) {
  useToastStore.getState().addToast({
    title,
    type: options?.type ?? "info",
    message: options?.message,
    duration: options?.duration,
  });
}
