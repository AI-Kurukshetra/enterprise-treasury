import type { UUID } from '@/types/common';

export type RiskType = 'fx' | 'interest_rate' | 'credit' | 'liquidity';
export type RiskStatus = 'normal' | 'warning' | 'breached';
export type RiskAlertSeverity = 'info' | 'warning' | 'critical';
export type RiskAlertStatus = 'open' | 'acknowledged' | 'resolved';

export interface RiskExposure {
  id: UUID;
  organization_id: UUID;
  risk_type: RiskType;
  reference_date: string;
  currency_code: string | null;
  exposure_amount: string;
  status: RiskStatus;
  details: Record<string, unknown> | null;
  updated_at?: string;
}

export interface RiskAlert {
  id: UUID;
  organization_id: UUID;
  risk_type: string;
  severity: RiskAlertSeverity;
  title: string;
  message: string;
  related_entity_type: string | null;
  related_entity_id: UUID | null;
  status: RiskAlertStatus;
  resolved_at: string | null;
  resolved_by: UUID | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface FxExposureLimitRule {
  maxUnhedgedAmount: string | null;
  minCoverageRatio: string | null;
}

export interface RiskPolicySet {
  warningThresholdRatio: string;
  defaultFxLimit: FxExposureLimitRule | null;
  fxLimitsByPair: Record<string, FxExposureLimitRule>;
  interestRate: {
    maxNetFloatingExposure: string | null;
  };
  counterparty: {
    maxConcentrationRatio: string | null;
  };
  liquidity: {
    minimumStressBuffer: string | null;
    inflowStressRatio: string;
    outflowStressRatio: string;
  };
}

export interface FxExposureSummary {
  riskType: 'fx';
  currencyPair: string;
  foreignCurrency: string;
  baseCurrency: string;
  valuationDate: string;
  grossExposureAmount: string;
  netExposureAmount: string;
  hedgedAmount: string;
  unhedgedAmount: string;
  hedgeCoverageRatio: string;
  limitAmount: string | null;
  minimumCoverageRatio: string | null;
  warningThresholdRatio: string;
  status: RiskStatus;
  fxRate: string;
}

export interface InterestRateShockScenario {
  name: 'up_100bps' | 'up_200bps';
  rateBps: number;
  projectedAnnualImpact: string;
}

export interface IrExposureSummary {
  riskType: 'interest_rate';
  valuationDate: string;
  baseCurrency: string;
  floatingDebtAmount: string;
  floatingInvestmentAmount: string;
  netFloatingRateExposure: string;
  limitAmount: string | null;
  warningThresholdRatio: string;
  shockScenarios: InterestRateShockScenario[];
  status: RiskStatus;
}

export interface ConcentrationRisk {
  riskType: 'credit';
  counterpartyId: UUID | null;
  counterpartyName: string;
  valuationDate: string;
  baseCurrency: string;
  exposureAmount: string;
  totalExposureAmount: string;
  concentrationRatio: string;
  limitRatio: string;
  warningThresholdRatio: string;
  status: RiskStatus;
}

export interface LiquidityStressResult {
  riskType: 'liquidity';
  valuationDate: string;
  baseCurrency: string;
  currentCashBuffer: string;
  baselineMinimumCashBuffer: string;
  stressedMinimumCashBuffer: string;
  minimumPolicyBuffer: string | null;
  inflowStressRatio: string;
  outflowStressRatio: string;
  forecastWindowDays: number;
  status: RiskStatus;
}

export interface RiskExposureMatrixRow {
  riskType: RiskType;
  title: string;
  exposureAmount: string;
  limitAmount: string | null;
  coverageRatio: string | null;
  status: RiskStatus;
  details: Record<string, unknown>;
}

export interface RiskExposureSnapshot {
  baseCurrency: string;
  valuationDate: string | null;
  lastCalculatedAt: string | null;
  summary: {
    breached: number;
    warning: number;
    normal: number;
  };
  matrix: RiskExposureMatrixRow[];
  fx: FxExposureSummary[];
  interestRate: IrExposureSummary | null;
  concentration: ConcentrationRisk[];
  liquidity: LiquidityStressResult | null;
}

export interface BreachItem {
  riskType: RiskType;
  severity: RiskAlertSeverity;
  title: string;
  message: string;
  relatedEntityType: string | null;
  relatedEntityId: UUID | null;
  status: RiskStatus;
  exposureAmount: string;
  limitAmount: string | null;
  details: Record<string, unknown>;
}

export interface BreachSummary {
  breached: BreachItem[];
  warning: BreachItem[];
  normal: BreachItem[];
}

export interface CreateRiskAlertInput {
  riskType: string;
  severity: RiskAlertSeverity;
  title: string;
  message: string;
  relatedEntityType?: string | null;
  relatedEntityId?: UUID | null;
  resolutionNote?: string | null;
}
