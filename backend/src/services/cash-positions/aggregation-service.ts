import type { SupabaseClient } from '@supabase/supabase-js';
import { NotFoundError } from '@/errors/NotFoundError';
import { withTransactionBoundary } from '@/lib/transaction';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { assertNoQueryError } from '@/repositories/base/execute';
import { CashPositionsRepository } from '@/repositories/cash_positions/repository';
import { FxService } from '@/services/fx/service';
import type {
  CashPosition,
  CashPositionSummary,
  CashTrendPoint,
  CurrencyBreakdown,
  PaymentVolumePoint,
  RegionalBreakdown
} from '@/types/cash_positions/types';
import { isMissingColumnError } from '@/utils/database';
import {
  addAmounts,
  decimalToScaledInteger,
  scaledIntegerToAmount,
  subtractAmounts
} from '@/utils/money';

const POSITION_CACHE_TTL_MS = 5 * 60 * 1000;
const RESERVED_PAYMENT_STATUSES = ['pending_approval', 'approved', 'sent'] as const;
const REGION_BY_COUNTRY: Record<string, string> = {
  US: 'Americas',
  CA: 'Americas',
  MX: 'LATAM',
  BR: 'LATAM',
  GB: 'EMEA',
  DE: 'EMEA',
  FR: 'EMEA',
  NL: 'EMEA',
  AE: 'EMEA',
  SG: 'APAC',
  CN: 'APAC',
  JP: 'APAC',
  AU: 'APAC',
  IN: 'APAC'
};

interface OrganizationRow {
  id: string;
  base_currency: string;
}

interface AccountAggregationRow {
  id: string;
  currency_code: string;
  region: string | null;
  liquidity_type: 'operating' | 'reserve';
  withdrawal_restricted: boolean;
  country_code?: string | null;
}

interface TransactionAggregationRow {
  bank_account_id: string;
  amount: string;
  direction: 'inflow' | 'outflow';
  booking_date: string;
}

interface PaymentAggregationRow {
  source_account_id: string;
  amount: string;
  currency_code: string;
  status: (typeof RESERVED_PAYMENT_STATUSES)[number];
  value_date: string;
  created_at: string;
}

interface ComputedAccountPosition {
  accountId: string;
  currencyCode: string;
  currentBalance: string;
  availableBalance: string;
  restrictedBalance: string;
}

interface CurrencyPositionTotals {
  currencyCode: string;
  currentBalance: string;
  availableBalance: string;
  restrictedBalance: string;
}

export class CashPositionAggregationService {
  private readonly db: SupabaseClient;
  private readonly repository: CashPositionsRepository;
  private readonly fxService: FxService;

  constructor(
    organizationId: string,
    options?: {
      dbClient?: SupabaseClient;
      repository?: CashPositionsRepository;
      fxService?: FxService;
    }
  ) {
    this.db = options?.dbClient ?? createServiceSupabaseClient();
    this.repository = options?.repository ?? new CashPositionsRepository({ organizationId }, this.db);
    this.fxService = options?.fxService ?? new FxService(this.db);
  }

  async recalculate(orgId: string, asOf = new Date()): Promise<CashPositionSummary> {
    const snapshotAt = asOf.toISOString();
    const [organization, accounts, transactions, reservedPayments] = await Promise.all([
      this.fetchOrganization(orgId),
      this.fetchActiveAccounts(orgId),
      this.fetchTransactions(orgId, asOf),
      this.fetchReservedPayments(orgId, snapshotAt)
    ]);

    const accountPositions = calculateAccountPositions(accounts, transactions, reservedPayments);
    const organizationPositions = rollupCurrencyPositions(accountPositions);
    const upsertRows = [
      ...accountPositions.map((position) => ({
        organization_id: orgId,
        as_of_at: snapshotAt,
        scope_type: 'account' as const,
        scope_id: position.accountId,
        currency_code: position.currencyCode,
        available_balance: position.availableBalance,
        current_balance: position.currentBalance,
        restricted_balance: position.restrictedBalance,
        source_version: buildSourceVersion(snapshotAt)
      })),
      ...organizationPositions.map((position) => ({
        organization_id: orgId,
        as_of_at: snapshotAt,
        scope_type: 'organization' as const,
        scope_id: orgId,
        currency_code: position.currencyCode,
        available_balance: position.availableBalance,
        current_balance: position.currentBalance,
        restricted_balance: position.restrictedBalance,
        source_version: buildSourceVersion(snapshotAt)
      }))
    ];

    await withTransactionBoundary('cash_positions.recalculate', async () => {
      const { error } = await this.db
        .from('cash_positions')
        .upsert(upsertRows, {
          onConflict: 'organization_id,as_of_at,scope_type,scope_id,currency_code'
        });

      if (!error) {
        return;
      }

      if (!isMissingColumnError(error, 'restricted_balance')) {
        assertNoQueryError(error);
      }

      const fallbackRows = upsertRows.map(({ restricted_balance: _restrictedBalance, ...row }) => row);
      const fallback = await this.db
        .from('cash_positions')
        .upsert(fallbackRows, {
          onConflict: 'organization_id,as_of_at,scope_type,scope_id,currency_code'
        });

      assertNoQueryError(fallback.error);
    });

    return this.buildSummary({
      orgId,
      organization,
      asOf: snapshotAt,
      accounts,
      accountPositions,
      organizationPositions,
      reservedPayments
    });
  }

  async getConsolidatedPosition(orgId: string): Promise<CashPositionSummary> {
    const [organization, snapshotAsOf] = await Promise.all([
      this.fetchOrganization(orgId),
      this.ensureFreshPositions(orgId)
    ]);
    const [accounts, accountPositions, organizationPositions, reservedPayments] = await Promise.all([
      this.fetchActiveAccounts(orgId),
      this.getLatestAccountPositions(orgId),
      this.repository.getLatest({ scopeType: 'organization', scopeId: orgId }),
      this.fetchReservedPayments(orgId, snapshotAsOf)
    ]);

    return this.buildSummary({
      orgId,
      organization,
      asOf: snapshotAsOf,
      accounts,
      accountPositions: accountPositions.map((position) => ({
        accountId: position.scope_id!,
        currencyCode: position.currency_code,
        currentBalance: position.current_balance,
        availableBalance: position.available_balance,
        restrictedBalance: position.restricted_balance
      })),
      organizationPositions: organizationPositions.map((position) => ({
        currencyCode: position.currency_code,
        currentBalance: position.current_balance,
        availableBalance: position.available_balance,
        restrictedBalance: position.restricted_balance
      })),
      reservedPayments
    });
  }

  async getCashTrend(orgId: string, days: number): Promise<CashTrendPoint[]> {
    const [organization, snapshotAsOf, accounts] = await Promise.all([
      this.fetchOrganization(orgId),
      this.ensureFreshPositions(orgId),
      this.fetchActiveAccounts(orgId)
    ]);
    const endDate = new Date(snapshotAsOf);
    const startDate = startOfUtcDay(addUtcDays(endDate, -(days - 1)));
    const [historyRows, transactions, reservedPayments] = await Promise.all([
      this.repository.getHistory('organization', orgId, startDate.toISOString(), endDate.toISOString()),
      this.fetchTransactions(orgId, endDate),
      this.fetchReservedPayments(orgId, endDate.toISOString())
    ]);

    return buildCashTrendSeries({
      organizationId: orgId,
      baseCurrency: organization.base_currency,
      startDate,
      endDate,
      accounts,
      historyRows,
      transactions,
      reservedPayments,
      convertAmount: async (amount, fromCurrency, asOf) =>
        this.convertAmountToBase(orgId, organization.base_currency, amount, fromCurrency, asOf)
    });
  }

  async getRegionalBreakdown(orgId: string): Promise<RegionalBreakdown[]> {
    const [organization, _snapshotAsOf, accounts, accountPositions] = await Promise.all([
      this.fetchOrganization(orgId),
      this.ensureFreshPositions(orgId),
      this.fetchActiveAccounts(orgId),
      this.getLatestAccountPositions(orgId)
    ]);

    return buildRegionalBreakdown({
      organizationId: orgId,
      baseCurrency: organization.base_currency,
      asOf: _snapshotAsOf,
      accounts,
      accountPositions: accountPositions.map((position) => ({
        accountId: position.scope_id!,
        currencyCode: position.currency_code,
        currentBalance: position.current_balance,
        availableBalance: position.available_balance,
        restrictedBalance: position.restricted_balance
      })),
      convertAmount: async (amount, fromCurrency, asOf) =>
        this.convertAmountToBase(orgId, organization.base_currency, amount, fromCurrency, asOf)
    });
  }

  async getLatestAccountPositions(orgId: string, accountIds?: string[]): Promise<CashPosition[]> {
    await this.ensureFreshPositions(orgId);
    if (accountIds && accountIds.length > 0) {
      return this.repository.getLatestByScopeIds('account', accountIds);
    }
    return this.repository.getLatest({ scopeType: 'account' });
  }

  private async buildSummary(input: {
    orgId: string;
    organization: OrganizationRow;
    asOf: string;
    accounts: AccountAggregationRow[];
    accountPositions: ComputedAccountPosition[];
    organizationPositions: CurrencyPositionTotals[];
    reservedPayments: PaymentAggregationRow[];
  }): Promise<CashPositionSummary> {
    const [byCurrency, byRegion, trend, riskWatchCount] = await Promise.all([
      this.buildCurrencyBreakdown(input.orgId, input.organization.base_currency, input.organizationPositions, input.asOf),
      buildRegionalBreakdown({
        organizationId: input.orgId,
        baseCurrency: input.organization.base_currency,
        asOf: input.asOf,
        accounts: input.accounts,
        accountPositions: input.accountPositions,
        convertAmount: async (amount, fromCurrency, asOf) =>
          this.convertAmountToBase(input.orgId, input.organization.base_currency, amount, fromCurrency, asOf)
      }),
      this.getCashTrend(input.orgId, 7),
      this.getRiskWatchCount(input.orgId)
    ]);

    const totalCash = byCurrency.reduce<string>((sum, row) => addAmounts(sum, row.currentBalanceInBase), '0.000000');
    const availableLiquidity = byCurrency.reduce<string>(
      (sum, row) => addAmounts(sum, row.availableBalanceInBase),
      '0.000000'
    );
    const pendingPaymentsAmount = await this.sumPaymentsInBase(
      input.orgId,
      input.organization.base_currency,
      input.reservedPayments,
      input.asOf
    );

    return {
      totalCash,
      availableLiquidity,
      pendingPayments: {
        amount: pendingPaymentsAmount,
        count: input.reservedPayments.length
      },
      riskLimitsInWatch: riskWatchCount,
      baseCurrency: input.organization.base_currency,
      asOf: input.asOf,
      byCurrency,
      byRegion,
      trend,
      paymentVolume: buildPaymentVolumeSeries(input.reservedPayments, new Date(input.asOf), 5)
    };
  }

  private async buildCurrencyBreakdown(
    orgId: string,
    baseCurrency: string,
    organizationPositions: CurrencyPositionTotals[],
    asOf: string
  ): Promise<CurrencyBreakdown[]> {
    const results: CurrencyBreakdown[] = [];

    for (const position of organizationPositions) {
      const [currentInBase, availableInBase, restrictedInBase] = await Promise.all([
        this.convertAmountToBase(orgId, baseCurrency, position.currentBalance, position.currencyCode, asOf),
        this.convertAmountToBase(orgId, baseCurrency, position.availableBalance, position.currencyCode, asOf),
        this.convertAmountToBase(orgId, baseCurrency, position.restrictedBalance, position.currencyCode, asOf)
      ]);

      results.push({
        currencyCode: position.currencyCode,
        currentBalance: position.currentBalance,
        availableBalance: position.availableBalance,
        restrictedBalance: position.restrictedBalance,
        currentBalanceInBase: currentInBase,
        availableBalanceInBase: availableInBase,
        restrictedBalanceInBase: restrictedInBase
      });
    }

    return results.sort((left, right) => left.currencyCode.localeCompare(right.currencyCode));
  }

  private async sumPaymentsInBase(
    orgId: string,
    baseCurrency: string,
    payments: PaymentAggregationRow[],
    asOf: string
  ): Promise<string> {
    let total = '0.000000';

    for (const payment of payments) {
      const converted = await this.convertAmountToBase(orgId, baseCurrency, payment.amount, payment.currency_code, asOf);
      total = addAmounts(total, converted);
    }

    return total;
  }

  private async convertAmountToBase(
    orgId: string,
    baseCurrency: string,
    amount: string,
    fromCurrency: string,
    asOf: string
  ): Promise<string> {
    if (fromCurrency === baseCurrency) {
      return amount;
    }

    const converted = await this.fxService.convertAmount({
      amount,
      fromCurrency,
      toCurrency: baseCurrency,
      asOf
    });

    return typeof converted === 'string' ? converted : converted.amount;
  }

  private async ensureFreshPositions(orgId: string): Promise<string> {
    const latestAsOf = await this.repository.getLatestSnapshotAge('organization', orgId);
    if (!latestAsOf || Date.now() - new Date(latestAsOf).getTime() > POSITION_CACHE_TTL_MS) {
      const summary = await this.recalculate(orgId);
      return summary.asOf;
    }
    return latestAsOf;
  }

  private async fetchOrganization(orgId: string): Promise<OrganizationRow> {
    const { data, error } = await this.db
      .from('organizations')
      .select('id,base_currency')
      .eq('id', orgId)
      .maybeSingle();

    assertNoQueryError(error);
    if (!data) {
      throw new NotFoundError('Organization not found');
    }
    return data as OrganizationRow;
  }

  private async fetchActiveAccounts(orgId: string): Promise<AccountAggregationRow[]> {
    const { data, error } = await this.db
      .from('bank_accounts')
      .select('id,currency_code,region,liquidity_type,withdrawal_restricted,country_code')
      .eq('organization_id', orgId)
      .eq('status', 'active');

    if (!error) {
      return (data ?? []) as AccountAggregationRow[];
    }

    if (error.code !== '42703') {
      assertNoQueryError(error);
    }

    const fallback = await this.db
      .from('bank_accounts')
      .select('id,currency_code,country_code')
      .eq('organization_id', orgId)
      .eq('status', 'active');

    assertNoQueryError(fallback.error);
    return ((fallback.data ?? []) as Array<{ id: string; currency_code: string; country_code: string | null }>).map(
      (account) => ({
        id: account.id,
        currency_code: account.currency_code,
        country_code: account.country_code,
        region: account.country_code ? REGION_BY_COUNTRY[account.country_code] ?? null : null,
        liquidity_type: 'operating',
        withdrawal_restricted: false
      })
    );
  }

  private async fetchTransactions(orgId: string, asOf: Date): Promise<TransactionAggregationRow[]> {
    const { data, error } = await this.db
      .from('transactions')
      .select('bank_account_id,amount,direction,booking_date')
      .eq('organization_id', orgId)
      .lte('booking_date', asOf.toISOString().slice(0, 10));

    assertNoQueryError(error);
    return (data ?? []) as TransactionAggregationRow[];
  }

  private async fetchReservedPayments(orgId: string, asOfIso: string): Promise<PaymentAggregationRow[]> {
    const { data, error } = await this.db
      .from('payments')
      .select('source_account_id,amount,currency_code,status,value_date,created_at')
      .eq('organization_id', orgId)
      .in('status', [...RESERVED_PAYMENT_STATUSES])
      .lte('created_at', asOfIso);

    assertNoQueryError(error);
    return (data ?? []) as PaymentAggregationRow[];
  }

  private async getRiskWatchCount(orgId: string): Promise<number> {
    const { count, error } = await this.db
      .from('risk_exposures')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .in('status', ['warning', 'breached']);

    assertNoQueryError(error);
    return count ?? 0;
  }
}

export function calculateAccountPositions(
  accounts: AccountAggregationRow[],
  transactions: TransactionAggregationRow[],
  reservedPayments: PaymentAggregationRow[]
): ComputedAccountPosition[] {
  const currentBalances = new Map<string, bigint>();
  const reservedBalances = new Map<string, bigint>();

  for (const account of accounts) {
    currentBalances.set(account.id, 0n);
    reservedBalances.set(account.id, 0n);
  }

  for (const transaction of transactions) {
    const signedAmount =
      transaction.direction === 'inflow'
        ? decimalToScaledInteger(transaction.amount, 6)
        : -decimalToScaledInteger(transaction.amount, 6);

    currentBalances.set(transaction.bank_account_id, (currentBalances.get(transaction.bank_account_id) ?? 0n) + signedAmount);
  }

  for (const payment of reservedPayments) {
    reservedBalances.set(
      payment.source_account_id,
      (reservedBalances.get(payment.source_account_id) ?? 0n) + decimalToScaledInteger(payment.amount, 6)
    );
  }

  return accounts.map((account) => {
    const currentBalance = currentBalances.get(account.id) ?? 0n;
    const restrictedBalance = reservedBalances.get(account.id) ?? 0n;

    return {
      accountId: account.id,
      currencyCode: account.currency_code,
      currentBalance: scaledIntegerToAmount(currentBalance, 6),
      availableBalance: scaledIntegerToAmount(currentBalance - restrictedBalance, 6),
      restrictedBalance: scaledIntegerToAmount(restrictedBalance, 6)
    };
  });
}

export function rollupCurrencyPositions(accountPositions: ComputedAccountPosition[]): CurrencyPositionTotals[] {
  const totals = new Map<string, CurrencyPositionTotals>();

  for (const position of accountPositions) {
    const existing = totals.get(position.currencyCode) ?? {
      currencyCode: position.currencyCode,
      currentBalance: '0.000000',
      availableBalance: '0.000000',
      restrictedBalance: '0.000000'
    };

    existing.currentBalance = addAmounts(existing.currentBalance, position.currentBalance);
    existing.availableBalance = addAmounts(existing.availableBalance, position.availableBalance);
    existing.restrictedBalance = addAmounts(existing.restrictedBalance, position.restrictedBalance);

    totals.set(position.currencyCode, existing);
  }

  return Array.from(totals.values()).sort((left, right) => left.currencyCode.localeCompare(right.currencyCode));
}

export async function buildRegionalBreakdown(input: {
  organizationId: string;
  baseCurrency: string;
  asOf: string;
  accounts: AccountAggregationRow[];
  accountPositions: ComputedAccountPosition[];
  convertAmount: (amount: string, fromCurrency: string, asOf: string) => Promise<string>;
}): Promise<RegionalBreakdown[]> {
  const positionsByAccountId = new Map(input.accountPositions.map((position) => [position.accountId, position]));
  const regionTotals = new Map<string, RegionalBreakdown>();

  for (const account of input.accounts) {
    const position = positionsByAccountId.get(account.id);
    if (!position) {
      continue;
    }

    const region = account.region ?? 'Unassigned';
    const existing = regionTotals.get(region) ?? {
      region,
      operating: '0.000000',
      reserve: '0.000000',
      trapped: '0.000000'
    };
    const convertedCurrent = await input.convertAmount(position.currentBalance, position.currencyCode, input.asOf);

    if (account.withdrawal_restricted) {
      existing.trapped = addAmounts(existing.trapped, convertedCurrent);
    } else if (account.liquidity_type === 'reserve') {
      existing.reserve = addAmounts(existing.reserve, convertedCurrent);
    } else {
      existing.operating = addAmounts(existing.operating, convertedCurrent);
    }

    regionTotals.set(region, existing);
  }

  return Array.from(regionTotals.values()).sort((left, right) => left.region.localeCompare(right.region));
}

export async function buildCashTrendSeries(input: {
  organizationId: string;
  baseCurrency: string;
  startDate: Date;
  endDate: Date;
  accounts: AccountAggregationRow[];
  historyRows: CashPosition[];
  transactions: TransactionAggregationRow[];
  reservedPayments: PaymentAggregationRow[];
  convertAmount: (amount: string, fromCurrency: string, asOf: string) => Promise<string>;
}): Promise<CashTrendPoint[]> {
  const historyByDate = new Map<string, CurrencyPositionTotals[]>();

  for (const row of input.historyRows) {
    const key = row.as_of_at.slice(0, 10);
    const bucket = historyByDate.get(key) ?? [];
    bucket.push({
      currencyCode: row.currency_code,
      currentBalance: row.current_balance,
      availableBalance: row.available_balance,
      restrictedBalance: row.restricted_balance
    });
    historyByDate.set(key, bucket);
  }

  const series: CashTrendPoint[] = [];
  const dayCursor = new Date(input.startDate);
  const transactionsByDay = groupTransactionsByDay(input.transactions);
  const paymentsByCreationDay = groupPaymentsByCreationDay(input.reservedPayments);
  const runningTransactions: TransactionAggregationRow[] = [];
  const activeReservedPayments: PaymentAggregationRow[] = [];

  while (dayCursor <= input.endDate) {
    const dayKey = dayCursor.toISOString().slice(0, 10);
    for (const transaction of transactionsByDay.get(dayKey) ?? []) {
      runningTransactions.push(transaction);
    }
    for (const payment of paymentsByCreationDay.get(dayKey) ?? []) {
      activeReservedPayments.push(payment);
    }

    const dayPositions =
      historyByDate.get(dayKey) ??
      rollupCurrencyPositions(calculateAccountPositions(input.accounts, runningTransactions, activeReservedPayments));

    let currentTotal = '0.000000';
    let availableTotal = '0.000000';
    let dueSoonTotal = '0.000000';

    for (const position of dayPositions) {
      currentTotal = addAmounts(
        currentTotal,
        await input.convertAmount(position.currentBalance, position.currencyCode, `${dayKey}T23:59:59.999Z`)
      );
      availableTotal = addAmounts(
        availableTotal,
        await input.convertAmount(position.availableBalance, position.currencyCode, `${dayKey}T23:59:59.999Z`)
      );
    }

    const projectionWindowEnd = addUtcDays(dayCursor, 2).toISOString().slice(0, 10);
    for (const payment of activeReservedPayments) {
      if (payment.value_date <= projectionWindowEnd) {
        dueSoonTotal = addAmounts(
          dueSoonTotal,
          await input.convertAmount(payment.amount, payment.currency_code, `${dayKey}T23:59:59.999Z`)
        );
      }
    }

    series.push({
      date: dayKey,
      label: formatSeriesLabel(dayCursor),
      value: currentTotal,
      projected: subtractAmounts(currentTotal, dueSoonTotal),
      buffer: availableTotal
    });

    dayCursor.setUTCDate(dayCursor.getUTCDate() + 1);
  }

  return series;
}

export function buildPaymentVolumeSeries(
  reservedPayments: PaymentAggregationRow[],
  asOf: Date,
  days: number
): PaymentVolumePoint[] {
  const series = new Map<string, PaymentVolumePoint>();
  const startDate = startOfUtcDay(asOf);

  for (let offset = 0; offset < days; offset += 1) {
    const day = addUtcDays(startDate, offset);
    const label = formatSeriesLabel(day);
    series.set(day.toISOString().slice(0, 10), {
      label,
      urgent: 0,
      scheduled: 0
    });
  }

  const urgentCutoff = addUtcDays(asOf, 1).toISOString().slice(0, 10);

  for (const payment of reservedPayments) {
    const bucket = series.get(payment.value_date);
    if (!bucket) {
      continue;
    }

    if (payment.value_date <= urgentCutoff) {
      bucket.urgent += 1;
    } else {
      bucket.scheduled += 1;
    }
  }

  return Array.from(series.values());
}

function buildSourceVersion(asOf: string): string {
  return `cash-position-aggregation:${asOf}`;
}

function groupTransactionsByDay(transactions: TransactionAggregationRow[]) {
  const grouped = new Map<string, TransactionAggregationRow[]>();

  for (const transaction of transactions) {
    const bucket = grouped.get(transaction.booking_date) ?? [];
    bucket.push(transaction);
    grouped.set(transaction.booking_date, bucket);
  }

  return grouped;
}

function groupPaymentsByCreationDay(payments: PaymentAggregationRow[]) {
  const grouped = new Map<string, PaymentAggregationRow[]>();

  for (const payment of payments) {
    const bucket = grouped.get(payment.created_at.slice(0, 10)) ?? [];
    bucket.push(payment);
    grouped.set(payment.created_at.slice(0, 10), bucket);
  }

  return grouped;
}

function formatSeriesLabel(value: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  }).format(value);
}

function addUtcDays(value: Date, days: number): Date {
  const copy = new Date(value);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

function startOfUtcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate(), 0, 0, 0, 0));
}
