import type { LucideIcon } from "lucide-react";
import type { EmployeeSettlementConfig, EmployeeSettlementModel } from "@/lib/staff/employee-settlement";

export type EmployeeAdvanceItem = {
  id: string;
  date: string;
  amount: number;
  note?: string;
};

export type EmployeeProfileInfo = {
  id: string;
  fullName: string;
  roleLabel: string;
  statusLabel: string;
  statusTone: "active" | "risk" | "negative" | "inactive";
  avatarUrl?: string | null;
  settlementModel: EmployeeSettlementModel;
};

export type EmployeeKpiItem = {
  id: string;
  icon: LucideIcon;
  label: string;
  value: number;
  valuePrefix?: string;
  valueSuffix?: string;
  decimals?: number;
  secondary?: string;
  tone?: "default" | "positive" | "negative" | "warning";
};

export type EmployeeDashboardPalette = {
  primary: string;
  soft: string;
  border: string;
  textOnPrimary: string;
};

export type EmployeeSettlementPanelConfig = EmployeeSettlementConfig;
