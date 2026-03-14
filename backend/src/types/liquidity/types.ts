import type { UUID } from '@/types/common';

export type LiquidityPoolType = 'physical' | 'notional';
export type SweepFrequency = 'daily' | 'weekly' | 'monthly';
export type IntercompanyLoanStatus = 'proposed' | 'active' | 'settled' | 'cancelled';
export type IntercompanyLoanDisplayStatus = IntercompanyLoanStatus | 'overdue';

export interface LiquidityPool {
  id: UUID;
  organization_id: UUID;
  name: string;
  pool_type: LiquidityPoolType;
  base_currency: string;
  created_at: string;
  updated_at: string;
}

export interface LiquidityPoolAccount {
  id: UUID;
  organization_id: UUID;
  liquidity_pool_id: UUID;
  bank_account_id: UUID;
  priority: number;
  created_at: string;
  updated_at: string;
  account_name?: string;
  account_number_masked?: string;
  currency_code?: string;
  country_code?: string | null;
  status?: 'active' | 'dormant' | 'closed';
  available_balance?: string;
  current_balance?: string;
  as_of_at?: string | null;
}

export interface SweepingRule {
  id: UUID;
  organization_id: UUID;
  liquidity_pool_id: UUID;
  rule_name: string;
  source_account_id: UUID;
  target_account_id: UUID;
  min_balance: string;
  target_balance: string;
  max_transfer: string | null;
  frequency: SweepFrequency;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_executed_at?: string | null;
}

export interface IntercompanyTransaction {
  id: UUID;
  organization_id: UUID;
  lender_entity_id: UUID;
  borrower_entity_id: UUID;
  amount: string;
  currency_code: string;
  interest_rate: string | null;
  status: IntercompanyLoanStatus;
  maturity_date: string | null;
  created_at: string;
  updated_at: string;
  display_status?: IntercompanyLoanDisplayStatus;
  approval_state?: 'pending_bilateral_approval' | 'approved';
}

export interface LiquidityPosition {
  pool_id: UUID;
  pool_name: string;
  pool_type: LiquidityPoolType;
  base_currency: string;
  total_balance: string;
  available_balance: string;
  trapped_cash: string;
  operating_cash: string;
  reserve_cash: string;
  account_count: number;
  active_rule_count: number;
  last_sweep_at: string | null;
  regions: string[];
}

export interface PoolSummary extends LiquidityPool {
  account_count: number;
  active_rule_count: number;
  total_balance: string;
  available_balance: string;
  trapped_cash: string;
  last_sweep_at: string | null;
}

export interface LiquidityPoolDetail extends LiquidityPool {
  accounts: LiquidityPoolAccount[];
  rules: SweepingRule[];
  summary: PoolSummary;
}

export interface ConcentrationBucket {
  key: string;
  label: string;
  total_balance: string;
  available_balance?: string;
  trapped_cash?: string;
  operating_cash?: string;
  reserve_cash?: string;
  concentration_pct?: string;
  limit_pct?: string;
  breached?: boolean;
}

export interface ConcentrationAnalysis {
  by_region: ConcentrationBucket[];
  by_currency: ConcentrationBucket[];
  by_entity_type: ConcentrationBucket[];
}

export interface LiquidityPositionResponse {
  generated_at: string;
  total_balance: string;
  available_balance: string;
  trapped_cash: string;
  runway_days: number | null;
  pools: LiquidityPosition[];
  concentration_analysis: ConcentrationAnalysis;
}

export interface SweepExecutionResult {
  rule_id: UUID;
  pool_id: UUID;
  status: 'executed' | 'skipped';
  reason?: string;
  transfer_amount: string | null;
  source_account_id: UUID;
  target_account_id: UUID;
  executed_at: string;
}
