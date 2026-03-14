import type { UUID } from '@/types/common';

export interface CashPosition {
  id: UUID;
  organization_id: UUID;
  as_of_at: string;
  scope_type: 'account' | 'entity' | 'organization';
  scope_id: UUID | null;
  currency_code: string;
  available_balance: string;
  current_balance: string;
  restricted_balance: string;
  source_version: string;
}

export interface CashTrendPoint {
  date: string;
  label: string;
  value: string;
  projected: string;
  buffer: string;
}

export interface RegionalBreakdown {
  region: string;
  operating: string;
  reserve: string;
  trapped: string;
}

export interface PaymentVolumePoint {
  label: string;
  urgent: number;
  scheduled: number;
}

export interface CurrencyBreakdown {
  currencyCode: string;
  currentBalance: string;
  availableBalance: string;
  restrictedBalance: string;
  currentBalanceInBase: string;
  availableBalanceInBase: string;
  restrictedBalanceInBase: string;
}

export interface CashPositionSummary {
  totalCash: string;
  availableLiquidity: string;
  pendingPayments: {
    amount: string;
    count: number;
  };
  riskLimitsInWatch: number;
  baseCurrency: string;
  asOf: string;
  byCurrency: CurrencyBreakdown[];
  byRegion: RegionalBreakdown[];
  trend: CashTrendPoint[];
  paymentVolume: PaymentVolumePoint[];
}

export interface CashPositionHistoryQuery {
  days: number;
  granularity: 'daily';
}
