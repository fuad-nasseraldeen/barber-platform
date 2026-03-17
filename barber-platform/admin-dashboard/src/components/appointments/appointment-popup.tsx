"use client";

import { useEffect } from "react";
import { StaffAvatar } from "@/components/ui/staff-avatar";
import {
  Phone,
  MessageSquare,
  Trash2,
  CreditCard,
  Clock,
  Pencil,
  X,
} from "lucide-react";

const WHATSAPP_ICON = (
  <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z" />
  </svg>
);

export type AppointmentPopupAppointment = {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  staff?: { id: string; firstName: string; lastName: string };
  service: { name: string };
  customer: {
    id?: string;
    firstName: string | null;
    lastName: string | null;
    email?: string;
    phone?: string | null;
  };
};

type AppointmentPopupProps = {
  appointment: AppointmentPopupAppointment;
  onClose: () => void;
  onDelete?: () => void;
  onEdit?: () => void;
  onPayment?: () => void;
  onChangeDuration?: () => void;
  t: (key: string) => string;
  locale?: string;
};

function formatTime(s: string) {
  return s.slice(11, 16);
}

function formatDate(s: string, locale: string) {
  const d = new Date(s);
  return d.toLocaleDateString(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AppointmentPopup({
  appointment,
  onClose,
  onDelete,
  onEdit,
  onPayment,
  onChangeDuration,
  t,
  locale = "he",
}: AppointmentPopupProps) {
  const customerName = [appointment.customer.firstName, appointment.customer.lastName]
    .filter(Boolean)
    .join(" ") || "—";
  const phoneRaw = appointment.customer.phone?.replace(/\D/g, "") || "";
  const phoneForWa = phoneRaw.startsWith("972") ? phoneRaw : phoneRaw ? `972${phoneRaw.replace(/^0/, "")}` : "";
  const whatsappUrl = phoneForWa ? `https://wa.me/${phoneForWa}` : null;
  const telUrl = appointment.customer.phone ? `tel:${appointment.customer.phone}` : null;
  const smsUrl = appointment.customer.phone ? `sms:${appointment.customer.phone}` : null;

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-white shadow-2xl dark:bg-zinc-900"
        style={{
          animation: "appointmentPopupSlide 0.3s ease-out",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 p-4 dark:border-zinc-700">
          <div className="h-1 w-12 rounded-full bg-zinc-300 dark:bg-zinc-600" />
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-2 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="p-6">
          <div className="mb-6 flex flex-col items-center gap-3">
            <StaffAvatar
              avatarUrl={null}
              firstName={appointment.customer.firstName ?? ""}
              lastName={appointment.customer.lastName ?? ""}
              size="lg"
              className="h-20 w-20"
            />
            <div className="text-center">
              <h2 className="text-xl font-semibold">{customerName}</h2>
              <p className="mt-1 text-sm text-zinc-500">
                {formatTime(appointment.startTime)} – {formatTime(appointment.endTime)} {appointment.service.name}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                {t("appointments.popupBookedAt")} {formatDate(appointment.startTime, locale)}
              </p>
              {appointment.staff && (
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                  {appointment.staff.firstName} {appointment.staff.lastName}
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            {telUrl && (
              <a
                href={telUrl}
                className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-right transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <div className="flex items-center gap-3">
                  <Phone className="h-5 w-5 text-emerald-600" />
                  <span>{t("appointments.popupCall")}</span>
                </div>
              </a>
            )}
            {smsUrl && (
              <a
                href={smsUrl}
                className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-right transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <div className="flex items-center gap-3">
                  <MessageSquare className="h-5 w-5 text-blue-600" />
                  <span>{t("appointments.popupSendMessage")}</span>
                </div>
              </a>
            )}
            {whatsappUrl && (
              <a
                href={whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-right transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <div className="flex items-center gap-3">
                  <span className="text-[#25D366]">{WHATSAPP_ICON}</span>
                  <span>{t("appointments.popupWhatsApp")}</span>
                </div>
              </a>
            )}
            {onDelete && !["CANCELLED", "NO_SHOW", "COMPLETED"].includes(appointment.status) && (
              <button
                type="button"
                onClick={onDelete}
                className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-right text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
              >
                <div className="flex items-center gap-3">
                  <Trash2 className="h-5 w-5" />
                  <span>{t("appointments.popupDelete")}</span>
                </div>
              </button>
            )}
            {onPayment && (
              <button
                type="button"
                onClick={onPayment}
                className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-right transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <div className="flex items-center gap-3">
                  <CreditCard className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
                  <span>{t("appointments.popupPayment")}</span>
                </div>
              </button>
            )}
            {onChangeDuration && (
              <button
                type="button"
                onClick={onChangeDuration}
                className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-right transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <div className="flex items-center gap-3">
                  <Clock className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
                  <span>{t("appointments.popupChangeDuration")}</span>
                </div>
              </button>
            )}
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="flex w-full items-center justify-between rounded-xl px-4 py-3 text-right transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
              >
                <div className="flex items-center gap-3">
                  <Pencil className="h-5 w-5 text-zinc-600 dark:text-zinc-400" />
                  <span>{t("appointments.popupEdit")}</span>
                </div>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
