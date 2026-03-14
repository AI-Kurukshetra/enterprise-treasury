import type { SupabaseClient } from '@supabase/supabase-js';
import { JobWorker } from '@/lib/job-queue/job-worker';
import type { Job } from '@/lib/job-queue/job-queue';
import { logger } from '@/lib/logger';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { assertNoQueryError } from '@/repositories/base/execute';

export interface CashPositionWorkerPayload {
  organizationId: string;
  asOf?: string;
}

interface OrganizationRow {
  base_currency: string;
}

interface AccountRow {
  id: string;
  currency_code: string;
}

interface TransactionBalanceRow {
  amount: string;
  direction: 'inflow' | 'outflow';
  running_balance: string | null;
}

const FX_RATE_MAP: Record<string, number> = {
  USD: 1,
  EUR: 1.08,
  GBP: 1.27,
  JPY: 0.0068,
  INR: 0.012,
  SGD: 0.74
};

function resolveMockFxRate(from: string, to: string): number {
  if (from === to) {
    return 1;
  }

  const fromUsd = FX_RATE_MAP[from];
  const toUsd = FX_RATE_MAP[to];
  if (!fromUsd || !toUsd) {
    return 1;
  }

  return fromUsd / toUsd;
}

export class CashPositionWorker extends JobWorker<CashPositionWorkerPayload> {
  readonly type = 'cash-position.recalculate';
  readonly maxAttempts = 4;

  private readonly db: SupabaseClient;

  constructor(dbClient?: SupabaseClient) {
    super();
    this.db = dbClient ?? createServiceSupabaseClient();
  }

  override async handle(payload: CashPositionWorkerPayload, job: Job<CashPositionWorkerPayload>): Promise<void> {
    const asOfAt = payload.asOf ? new Date(payload.asOf).toISOString() : new Date().toISOString();
    const baseCurrency = await this.getBaseCurrency(payload.organizationId);
    const accounts = await this.getAccounts(payload.organizationId);
    const rowsToUpsert: Array<{
      organization_id: string;
      as_of_at: string;
      scope_type: 'account' | 'organization';
      scope_id: string;
      currency_code: string;
      available_balance: string;
      current_balance: string;
      source_version: string;
    }> = [];
    let totalBaseBalance = 0;

    for (const account of accounts) {
      const latestBalance = await this.getLatestAccountBalance(payload.organizationId, account.id, asOfAt);
      rowsToUpsert.push({
        organization_id: payload.organizationId,
        as_of_at: asOfAt,
        scope_type: 'account',
        scope_id: account.id,
        currency_code: account.currency_code,
        available_balance: latestBalance,
        current_balance: latestBalance,
        source_version: `job:${job.id}`
      });

      totalBaseBalance +=
        Number(latestBalance) * resolveMockFxRate(account.currency_code, baseCurrency);
    }

    rowsToUpsert.push({
      organization_id: payload.organizationId,
      as_of_at: asOfAt,
      scope_type: 'organization',
      scope_id: payload.organizationId,
      currency_code: baseCurrency,
      available_balance: totalBaseBalance.toFixed(6),
      current_balance: totalBaseBalance.toFixed(6),
      source_version: `job:${job.id}`
    });

    const { error } = await this.db.from('cash_positions').upsert(rowsToUpsert, {
      onConflict: 'organization_id,as_of_at,scope_type,scope_id,currency_code'
    });

    assertNoQueryError(error);
    await this.refreshLatestView();

    logger.log({
      level: 'info',
      message: 'Cash positions recalculated',
      domain: 'cash_position_worker',
      eventType: 'cash_position.recalculated',
      organizationId: payload.organizationId,
      data: {
        jobId: job.id,
        asOfAt,
        accountCount: accounts.length,
        baseCurrency,
        totalBaseBalance: totalBaseBalance.toFixed(6)
      }
    });
  }

  private async getBaseCurrency(organizationId: string): Promise<string> {
    const { data, error } = await this.db
      .from('organizations')
      .select('base_currency')
      .eq('id', organizationId)
      .single();

    assertNoQueryError(error);
    return (data as OrganizationRow).base_currency;
  }

  private async getAccounts(organizationId: string): Promise<AccountRow[]> {
    const { data, error } = await this.db
      .from('bank_accounts')
      .select('id,currency_code')
      .eq('organization_id', organizationId)
      .neq('status', 'closed');

    assertNoQueryError(error);
    return (data ?? []) as AccountRow[];
  }

  private async getLatestAccountBalance(organizationId: string, accountId: string, asOfAt: string): Promise<string> {
    const { data, error } = await this.db
      .from('transactions')
      .select('amount,direction,running_balance')
      .eq('organization_id', organizationId)
      .eq('bank_account_id', accountId)
      .lte('event_timestamp', asOfAt)
      .order('event_timestamp', { ascending: false })
      .order('booking_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    assertNoQueryError(error);

    if (!data) {
      return '0.000000';
    }

    const latest = data as TransactionBalanceRow;
    if (latest.running_balance) {
      return latest.running_balance;
    }

    return latest.direction === 'inflow' ? latest.amount : `-${latest.amount}`;
  }

  private async refreshLatestView(): Promise<void> {
    const { error } = await this.db.from('cash_positions_latest').select('id').limit(1);
    assertNoQueryError(error);
  }
}
