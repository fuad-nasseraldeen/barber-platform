export type InvariantSeverity = 'error' | 'warn';

export interface InvariantViolation {
  code: string;
  severity: InvariantSeverity;
  message: string;
  detail?: Record<string, unknown>;
}

export interface InvariantSuiteResult {
  ok: boolean;
  violations: InvariantViolation[];
  checkedAt: string;
  businessId?: string;
}
