export type EmployeeSettlementModel = "boothRental" | "percentage" | "fixedPerTreatment";

export type EmployeeSettlementConfig = {
  model: EmployeeSettlementModel;
  boothRentalAmount: number;
  businessCutPercent: number;
  fixedAmountPerTreatment: number;
  allowNegativeBalance: boolean;
};

export type EmployeeSettlementInput = {
  treatmentsCount: number;
  totalRevenue: number;
  advancesTotal: number;
  alreadyPaid: number;
  config: EmployeeSettlementConfig;
};

export type EmployeeSettlementSummary = {
  grossBeforeAdvances: number;
  advancesDeducted: number;
  afterAdvances: number;
  alreadyPaid: number;
  remainingToPay: number;
  isNegative: boolean;
};

export function clampMoney(value: number): number {
  return Math.round((Number.isFinite(value) ? value : 0) * 100) / 100;
}

export function calculateGrossSettlement(
  treatmentsCount: number,
  totalRevenue: number,
  config: EmployeeSettlementConfig,
): number {
  const safeRevenue = Math.max(0, totalRevenue);
  const safeTreatments = Math.max(0, treatmentsCount);

  if (config.model === "boothRental") {
    return clampMoney(config.boothRentalAmount);
  }

  if (config.model === "fixedPerTreatment") {
    return clampMoney(safeRevenue - safeTreatments * Math.max(0, config.fixedAmountPerTreatment));
  }

  const safeBusinessCut = Math.max(0, Math.min(100, config.businessCutPercent));
  return clampMoney(safeRevenue * ((100 - safeBusinessCut) / 100));
}

export function calculateSettlementSummary(input: EmployeeSettlementInput): EmployeeSettlementSummary {
  const grossBeforeAdvances = calculateGrossSettlement(
    input.treatmentsCount,
    input.totalRevenue,
    input.config,
  );

  const advancesDeducted = clampMoney(Math.max(0, input.advancesTotal));
  const afterAdvances = clampMoney(grossBeforeAdvances - advancesDeducted);
  const alreadyPaid = clampMoney(Math.max(0, input.alreadyPaid));
  const remainingToPay = clampMoney(afterAdvances - alreadyPaid);

  return {
    grossBeforeAdvances,
    advancesDeducted,
    afterAdvances,
    alreadyPaid,
    remainingToPay,
    isNegative: remainingToPay < 0,
  };
}
