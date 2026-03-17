"use client";

import { useCallback, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { useToastStore } from "@/stores/toast-store";
import { useNotificationStore } from "@/stores/notification-store";
import { useAuthStore } from "@/stores/auth-store";

interface WsNotification {
  id: string;
  type: string;
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  createdAt: string;
}

const NOTIFICATION_TYPE_MAP: Record<
  string,
  { type: "info" | "success" | "warning" | "error" }
> = {
  appointment_booked: { type: "success" },
  appointment_cancelled: { type: "warning" },
  appointment_no_show: { type: "error" },
  appointment_reminder: { type: "info" },
  customer_joined: { type: "info" },
  customer_registered: { type: "info" },
  waitlist_notification: { type: "info" },
  waitlist_joined: { type: "info" },
  automation: { type: "info" },
};

export function useNotifications() {
  const businessId = useAuthStore((s) => s.user?.businessId);
  const seenIds = useRef<Set<string>>(new Set());
  const addToast = useToastStore((s) => s.addToast);
  const addNotification = useNotificationStore((s) => s.addNotification);
  const socketRef = useRef<Socket | null>(null);

  const handleNotification = useCallback(
    (n: WsNotification) => {
      if (seenIds.current.has(n.id)) return;
      seenIds.current.add(n.id);
      addNotification({
        id: n.id,
        type: n.type,
        title: n.title,
        body: n.body,
        data: n.data,
        createdAt: n.createdAt,
      });
      const mapped = NOTIFICATION_TYPE_MAP[n.type] ?? { type: "info" as const };
      addToast({
        title: n.title,
        message: n.body ?? undefined,
        type: mapped.type,
      });
    },
    [addToast, addNotification]
  );

  useEffect(() => {
    if (!businessId) return;

    const wsUrl =
      typeof window !== "undefined"
        ? process.env.NEXT_PUBLIC_API_URL || window.location.origin
        : "http://localhost:3000";

    const socket = io(wsUrl, {
      transports: ["websocket", "polling"],
      autoConnect: true,
    });

    socket.on("connect", () => {
      socket.emit("subscribe", { businessId });
    });

    socket.on("notification", handleNotification);

    socket.on("connect_error", () => {
    });

    socketRef.current = socket;
    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [businessId, handleNotification]);
}
