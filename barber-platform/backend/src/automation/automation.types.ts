/**
 * Visit-based rule condition types for automation.
 * Use with CustomerVisitsService.getCustomerVisitStats().
 */
export type VisitRuleConditionType =
  | 'customer_no_show_count'
  | 'last_visit_date'
  | 'visit_frequency';

export type VisitRuleOperator = '>=' | '<=' | '>' | '<' | '==';

export interface VisitRuleCondition {
  type: VisitRuleConditionType;
  operator: VisitRuleOperator;
  value: number;
}

export interface CustomerVisitStats {
  customerNoShowCount: number;
  lastVisitDate: Date | null;
  totalCompletedVisits: number;
  visitFrequencyPerDay: number;
}

/** Automation trigger types */
export type AutomationTriggerType =
  | 'birthday_message'
  | 'appointment_reminder'
  | 'scheduled_message';

/** Action config for sending messages */
export interface AutomationActionConfig {
  channels: ('SMS' | 'EMAIL' | 'IN_APP')[];
  messageTemplate: string;
  /** Hours before appointment (for appointment_reminder) */
  hoursBefore?: number;
  /** Cron expression for recurring (e.g. "0 9 * * *" = 9am daily) */
  scheduleCron?: string;
  /** One-time send at ISO timestamp */
  sendAt?: string;
}

/** Payload for automation queue jobs */
export interface AutomationJobPayload {
  ruleId: string;
  businessId: string;
  triggerType: AutomationTriggerType;
  /** For appointment_reminder */
  appointmentId?: string;
  /** For scheduled_message one-time */
  sendAt?: string;
}
