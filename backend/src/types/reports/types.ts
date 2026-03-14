export type ComplianceReportType = 'sox_404' | 'regulatory' | 'audit';

export interface CashSummaryAccountBalance {
  accountId: string;
  accountName: string;
  accountNumberMasked: string;
  currencyCode: string;
  countryCode: string | null;
  openingBalance: string;
  closingBalance: string;
  openingAvailableBalance: string;
  closingAvailableBalance: string;
  netMovement: string;
}

export interface CashSummaryCashFlow {
  currencyCode: string;
  inflows: string;
  outflows: string;
  netCashFlow: string;
}

export interface CashSummaryTransactionStatistic {
  currencyCode: string;
  transactionCount: number;
  averageTransactionSize: string;
}

export interface CounterpartyCurrencyBreakdown {
  currencyCode: string;
  totalVolume: string;
  transactionCount: number;
}

export interface CashSummaryTopCounterparty {
  counterpartyId: string;
  counterpartyName: string;
  rankedVolume: string;
  transactionCount: number;
  currencyBreakdown: CounterpartyCurrencyBreakdown[];
}

export interface CashSummaryReport {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  accounts: CashSummaryAccountBalance[];
  netCashFlowByCurrency: CashSummaryCashFlow[];
  transactionStatistics: CashSummaryTransactionStatistic[];
  topCounterparties: CashSummaryTopCounterparty[];
}

export interface LiquidityAccountBalance {
  accountId: string;
  accountName: string;
  accountNumberMasked: string;
  currencyCode: string;
  countryCode: string | null;
  region: string;
  availableBalance: string;
  currentBalance: string;
  positionTimestamp: string | null;
}

export interface LiquidityPoolCompositionAccount {
  accountId: string;
  accountName: string;
  currencyCode: string;
  availableBalance: string;
  currentBalance: string;
}

export interface LiquidityPoolComposition {
  poolId: string;
  name: string;
  poolType: string;
  baseCurrency: string;
  accountCount: number;
  totalAvailableBalance: string;
  totalCurrentBalance: string;
  composition: LiquidityPoolCompositionAccount[];
}

export interface LiquidityRunway {
  baseCurrency: string;
  availableBalance: string;
  dailyBurnRate: string;
  daysOfRunway: number | null;
}

export interface TrappedCashRegion {
  region: string;
  currencyCode: string;
  reason: string;
  trappedBalance: string;
}

export interface LiquidityReport {
  generatedAt: string;
  asOf: string;
  availableLiquidityByAccount: LiquidityAccountBalance[];
  liquidityPools: LiquidityPoolComposition[];
  runway: LiquidityRunway;
  trappedCashByRegion: TrappedCashRegion[];
}

export interface ComplianceReportRequest {
  reportType: ComplianceReportType;
  periodStart: string;
  periodEnd: string;
  format: 'json' | 'csv';
}

export interface ComplianceReportRecord {
  id: string;
  reportType: ComplianceReportType;
  periodStart: string;
  periodEnd: string;
  status: 'draft' | 'generated' | 'approved' | 'filed';
  artifactUri: string | null;
  downloadUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceReport {
  reportId: string;
  jobId: string;
  reportType: ComplianceReportType;
  periodStart: string;
  periodEnd: string;
  status: 'queued' | 'generated';
  downloadUrl: string;
  payload?: Record<string, unknown>;
}
