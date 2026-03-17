export type NotificationTrigger =
  | 'appointment_booked'
  | 'appointment_cancelled'
  | 'appointment_reminder'
  | 'waitlist_notification'
  | 'waitlist_joined'
  | 'customer_registered';

export type NotificationChannelType = 'SMS' | 'EMAIL' | 'PUSH' | 'IN_APP';

export interface NotificationJobPayload {
  trigger: NotificationTrigger;
  businessId: string;
  customerId?: string;
  userId?: string;
  channels: NotificationChannelType[];
  title: string;
  body?: string;
  data?: Record<string, unknown>;
  // Channel-specific
  phone?: string;
  email?: string;
  pushToken?: string;
}
