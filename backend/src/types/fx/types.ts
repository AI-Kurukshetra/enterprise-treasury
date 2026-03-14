import type { RiskExposure } from '@/types/risk/types';

export interface FxRate {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  timestamp: string;
  source: string;
}

export interface CurrencyRateRow {
  id?: string;
  base_currency: string;
  quote_currency: string;
  rate: string;
  provider: string;
  as_of_at: string;
  created_at?: string;
  updated_at?: string;
}

export interface HedgingInstrument {
  id: string;
  organization_id: string;
  instrument_type: 'forward' | 'option' | 'swap';
  notional_amount: string;
  base_currency: string;
  quote_currency: string | null;
  trade_date: string;
  maturity_date: string;
  status: 'draft' | 'active' | 'matured' | 'closed';
}

export interface FxExposureBreakdown {
  currencyCode: string;
  exposureAmount: string;
  exposureAmountInBaseCurrency: string;
  hedgedAmountInBaseCurrency: string;
  uncoveredAmountInBaseCurrency: string;
  status: RiskExposure['status'];
}

export interface FxExposureSummary {
  baseCurrency: string;
  totalExposure: string;
  totalHedgedAmount: string;
  hedgeCoveragePercent: string;
  uncoveredAmount: string;
  currencyBreakdown: FxExposureBreakdown[];
}

export interface HedgeRecommendation {
  exposureId: string;
  instrumentType: 'forward' | 'swap';
  baseCurrency: string;
  quoteCurrency: string;
  recommendedNotional: string;
  currentCoveragePercent: string;
  targetCoveragePercent: string;
  projectedCoveragePercent: string;
  maturityDate: string;
  rationale: string;
}
