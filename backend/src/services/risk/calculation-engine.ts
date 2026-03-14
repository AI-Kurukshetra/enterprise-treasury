import type { SupabaseClient } from '@supabase/supabase-js';
import { ValidationError } from '@/errors/ValidationError';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { FxService } from '@/services/fx/service';
import type {
  ConcentrationRisk,
  FxExposureSummary,
  InterestRateShockScenario,
  IrExposureSummary,
  LiquidityStressResult,
  RiskPolicySet,
  RiskStatus
} from '@/types/risk/types';
import {
  absoluteAmount,
  compareDecimalStrings,
  divideDecimalStrings,
  formatDecimalString,
  minDecimalString,
  multiplyDecimalStrings,
  subtractAmounts,
  sumDecimalStrings
} from '@/utils/money';

interface OrganizationRow {
  id: string;
  base_currency: string;
}

interface PaymentRow {
  id: string;
  amount: string;
  currency_code: string;
  status: string;
  beneficiary_counterparty_id: string;
}

interface TransactionRow {
  id: string;
  amount: string;
  currency_code: string;
  direction: 'inflow' | 'outflow';
  category: string | null;
  reconciliation_status: 'unreconciled' | 'reconciled';
  counterparty_id: string | null;
}

interface HedgeRow {
  id: string;
  notional_amount: string;
  base_currency: string;
  quote_currency: string | null;
  status: 'draft' | 'active' | 'matured' | 'closed';
}

interface PolicyRow {
  rules: Record<string, unknown> | null;
}

interface DebtFacilityRow {
  id: string;
  utilized_amount: string;
  currency_code: string;
  interest_basis: string | null;
  lender_counterparty_id: string | null;
  status: string;
}

interface InvestmentRow {
  id: string;
  principal_amount: string;
  currency_code: string;
  instrument_type: string;
  instrument_name: string;
  rate: string | null;
  status: string;
}

interface CounterpartyRow {
  id: string;
  name: string;
}

interface ForecastRow {
  id: string;
  currency_code: string;
}

interface ForecastLineRow {
  forecast_date: string;
  projected_inflow: string;
  projected_outflow: string;
  projected_net: string;
  scenario: string;
}

interface CashPositionRow {
  currency_code: string;
  available_balance: string;
}

interface FxExposureAccumulator {
  currency: string;
  pair: string;
  rate: string;
  receivablesBase: string;
  payablesBase: string;
  grossBase: string;
  netBase: string;
  hedgedBase: string;
}

type FxRateProvider = Pick<FxService, 'getRate'>;

const OPEN_PAYMENT_STATUSES = ['draft', 'pending_approval', 'approved', 'sent'] as const;
const ACTIVE_DEBT_STATUSES = ['active'] as const;
const ACTIVE_INVESTMENT_STATUSES = ['active'] as const;
const ACTIVE_HEDGE_STATUSES = ['active'] as const;
const DEFAULT_WARNING_THRESHOLD = '0.800000';
const DEFAULT_COUNTERPARTY_LIMIT = '0.250000';
const DEFAULT_STRESS_INFLOW_REDUCTION = '0.200000';
const DEFAULT_STRESS_OUTFLOW_INCREASE = '0.200000';
const SHOCK_SCENARIOS = [
  { name: 'up_100bps', rateBps: 100, multiplier: '0.010000' },
  { name: 'up_200bps', rateBps: 200, multiplier: '0.020000' }
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function deepMerge(target: Record<string, unknown>, source: Record<string, unknown>): Record<string, unknown> {
  const result = { ...target };

  for (const [key, value] of Object.entries(source)) {
    if (isRecord(value) && isRecord(result[key])) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value);
      continue;
    }

    result[key] = value;
  }

  return result;
}

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isVariableRateDescriptor(value: string | null | undefined): boolean {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized.includes('variable') || normalized.includes('floating') || normalized.includes('sofr') || normalized.includes('libor');
}

function ratioStatus(value: string, limit: string | null, warningThreshold: string): RiskStatus {
  if (!limit) {
    return 'normal';
  }

  if (compareDecimalStrings(value, limit) > 0) {
    return 'breached';
  }

  const warningLimit = multiplyDecimalStrings(limit, warningThreshold);
  return compareDecimalStrings(value, warningLimit) >= 0 ? 'warning' : 'normal';
}

function minimumRequiredStatus(value: string, minimum: string | null, warningThreshold: string): RiskStatus {
  if (!minimum) {
    return 'normal';
  }

  if (compareDecimalStrings(value, minimum) < 0) {
    return 'breached';
  }

  const warningFloor = divideDecimalStrings(minimum, warningThreshold);
  return compareDecimalStrings(value, warningFloor) < 0 ? 'warning' : 'normal';
}

function worstStatus(statuses: RiskStatus[]): RiskStatus {
  if (statuses.includes('breached')) {
    return 'breached';
  }
  if (statuses.includes('warning')) {
    return 'warning';
  }
  return 'normal';
}

function extractRulesValue<T>(
  rules: Record<string, unknown>,
  paths: string[],
  guard: (value: unknown) => value is T
): T | null {
  for (const path of paths) {
    const value = path.split('.').reduce<unknown>((current, segment) => {
      if (!isRecord(current)) {
        return null;
      }

      return current[segment];
    }, rules);

    if (guard(value)) {
      return value;
    }
  }

  return null;
}

export class RiskCalculationEngine {
  private readonly db: SupabaseClient;
  private readonly fxService: FxRateProvider;
  private readonly now: () => Date;

  constructor(options: { dbClient?: SupabaseClient; fxService?: FxRateProvider; now?: () => Date } = {}) {
    this.db = options.dbClient ?? createServiceSupabaseClient();
    this.fxService = options.fxService ?? new FxService(this.db);
    this.now = options.now ?? (() => new Date());
  }

  async calculateFxExposure(orgId: string): Promise<FxExposureSummary[]> {
    const asOf = toDateOnly(this.now());
    const [organization, policySet, payments, transactions, hedges] = await Promise.all([
      this.getOrganization(orgId),
      this.getPolicySet(orgId),
      this.getOpenPayments(orgId),
      this.getOutstandingTransactions(orgId),
      this.getActiveHedges(orgId)
    ]);

    const baseCurrency = organization.base_currency;
    const exposuresByPair = new Map<string, FxExposureAccumulator>();

    const recordExposure = (currency: string, signedBaseAmount: string, rate: string) => {
      const pair = `${currency}/${baseCurrency}`;
      const existing = exposuresByPair.get(pair);

      if (existing) {
        existing.receivablesBase = compareDecimalStrings(signedBaseAmount, '0') > 0
          ? sumDecimalStrings([existing.receivablesBase, signedBaseAmount])
          : existing.receivablesBase;
        existing.payablesBase = compareDecimalStrings(signedBaseAmount, '0') < 0
          ? sumDecimalStrings([existing.payablesBase, absoluteAmount(signedBaseAmount)])
          : existing.payablesBase;
        existing.grossBase = sumDecimalStrings([existing.grossBase, absoluteAmount(signedBaseAmount)]);
        existing.netBase = sumDecimalStrings([existing.netBase, signedBaseAmount]);
        return;
      }

      exposuresByPair.set(pair, {
        currency,
        pair,
        rate: formatDecimalString(rate),
        receivablesBase: compareDecimalStrings(signedBaseAmount, '0') > 0 ? signedBaseAmount : '0.000000',
        payablesBase: compareDecimalStrings(signedBaseAmount, '0') < 0 ? absoluteAmount(signedBaseAmount) : '0.000000',
        grossBase: absoluteAmount(signedBaseAmount),
        netBase: signedBaseAmount,
        hedgedBase: '0.000000'
      });
    };

    await Promise.all(
      payments
        .filter((payment) => payment.currency_code !== baseCurrency)
        .map(async (payment) => {
          const rate = (await this.fxService.getRate({ base: payment.currency_code, quote: baseCurrency, asOf })).rate.toFixed(6);
          const baseAmount = multiplyDecimalStrings(payment.amount, rate);
          recordExposure(payment.currency_code, `-${baseAmount}`, rate);
        })
    );

    await Promise.all(
      transactions
        .filter((transaction) => transaction.currency_code !== baseCurrency)
        .map(async (transaction) => {
          const rate = (await this.fxService.getRate({ base: transaction.currency_code, quote: baseCurrency, asOf })).rate.toFixed(6);
          const baseAmount = multiplyDecimalStrings(transaction.amount, rate);
          recordExposure(transaction.currency_code, transaction.direction === 'inflow' ? baseAmount : `-${baseAmount}`, rate);
        })
    );

    for (const hedge of hedges) {
      const foreignCurrency = hedge.base_currency === baseCurrency ? hedge.quote_currency : hedge.base_currency;
      if (!foreignCurrency) {
        continue;
      }

      const exposure = exposuresByPair.get(`${foreignCurrency}/${baseCurrency}`);
      if (!exposure) {
        continue;
      }

      const rate = (await this.fxService.getRate({ base: foreignCurrency, quote: baseCurrency, asOf })).rate.toFixed(6);
      exposure.hedgedBase = sumDecimalStrings([
        exposure.hedgedBase,
        multiplyDecimalStrings(hedge.notional_amount, rate)
      ]);
      exposure.rate = formatDecimalString(rate);
    }

    return Array.from(exposuresByPair.values())
      .sort((left, right) => left.pair.localeCompare(right.pair))
      .map((exposure) => {
        const netExposureAmount = absoluteAmount(exposure.netBase);
        const hedgedAmount =
          compareDecimalStrings(exposure.hedgedBase, netExposureAmount) > 0 ? netExposureAmount : exposure.hedgedBase;
        const unhedgedAmount = subtractAmounts(netExposureAmount, hedgedAmount);
        const hedgeCoverageRatio =
          compareDecimalStrings(netExposureAmount, '0') === 0 ? '1.000000' : divideDecimalStrings(hedgedAmount, netExposureAmount);
        const pairLimit = policySet.fxLimitsByPair[exposure.pair] ?? policySet.defaultFxLimit;
        const status = worstStatus([
          ratioStatus(unhedgedAmount, pairLimit?.maxUnhedgedAmount ?? null, policySet.warningThresholdRatio),
          minimumRequiredStatus(hedgeCoverageRatio, pairLimit?.minCoverageRatio ?? null, policySet.warningThresholdRatio)
        ]);

        return {
          riskType: 'fx',
          currencyPair: exposure.pair,
          foreignCurrency: exposure.currency,
          baseCurrency,
          valuationDate: asOf,
          grossExposureAmount: exposure.grossBase,
          netExposureAmount,
          hedgedAmount,
          unhedgedAmount,
          hedgeCoverageRatio,
          limitAmount: pairLimit?.maxUnhedgedAmount ?? null,
          minimumCoverageRatio: pairLimit?.minCoverageRatio ?? null,
          warningThresholdRatio: policySet.warningThresholdRatio,
          status,
          fxRate: exposure.rate
        };
      });
  }

  async calculateInterestRateExposure(orgId: string): Promise<IrExposureSummary> {
    const asOf = toDateOnly(this.now());
    const [organization, policySet, debtFacilities, investments] = await Promise.all([
      this.getOrganization(orgId),
      this.getPolicySet(orgId),
      this.getVariableRateDebtFacilities(orgId),
      this.getVariableRateInvestments(orgId)
    ]);

    const baseCurrency = organization.base_currency;
    const floatingDebtAmount = sumDecimalStrings(
      await Promise.all(
        debtFacilities.map(async (facility) => {
          const rate = (await this.fxService.getRate({ base: facility.currency_code, quote: baseCurrency, asOf })).rate.toFixed(6);
          return multiplyDecimalStrings(facility.utilized_amount, rate);
        })
      )
    );
    const floatingInvestmentAmount = sumDecimalStrings(
      await Promise.all(
        investments.map(async (investment) => {
          const rate = (await this.fxService.getRate({ base: investment.currency_code, quote: baseCurrency, asOf })).rate.toFixed(6);
          return multiplyDecimalStrings(investment.principal_amount, rate);
        })
      )
    );

    const netFloatingRateExposure = absoluteAmount(subtractAmounts(floatingDebtAmount, floatingInvestmentAmount));
    const shockScenarios: InterestRateShockScenario[] = SHOCK_SCENARIOS.map((scenario) => ({
      name: scenario.name,
      rateBps: scenario.rateBps,
      projectedAnnualImpact: multiplyDecimalStrings(netFloatingRateExposure, scenario.multiplier)
    }));

    return {
      riskType: 'interest_rate',
      valuationDate: asOf,
      baseCurrency,
      floatingDebtAmount,
      floatingInvestmentAmount,
      netFloatingRateExposure,
      limitAmount: policySet.interestRate.maxNetFloatingExposure,
      warningThresholdRatio: policySet.warningThresholdRatio,
      shockScenarios,
      status: ratioStatus(
        netFloatingRateExposure,
        policySet.interestRate.maxNetFloatingExposure,
        policySet.warningThresholdRatio
      )
    };
  }

  async calculateCounterpartyConcentration(orgId: string): Promise<ConcentrationRisk[]> {
    const asOf = toDateOnly(this.now());
    const [organization, policySet, payments, transactions, debtFacilities, counterparties] = await Promise.all([
      this.getOrganization(orgId),
      this.getPolicySet(orgId),
      this.getOpenPayments(orgId),
      this.getOutstandingTransactions(orgId),
      this.getActiveDebtFacilities(orgId),
      this.getCounterparties(orgId)
    ]);

    const baseCurrency = organization.base_currency;
    const exposureByCounterparty = new Map<string, string>();
    const counterpartyNames = new Map(counterparties.map((counterparty) => [counterparty.id, counterparty.name]));

    const addExposure = async (counterpartyId: string | null, amount: string, currency: string) => {
      if (!counterpartyId) {
        return;
      }

      const rate = (await this.fxService.getRate({ base: currency, quote: baseCurrency, asOf })).rate.toFixed(6);
      const normalized = multiplyDecimalStrings(amount, rate);
      exposureByCounterparty.set(
        counterpartyId,
        sumDecimalStrings([exposureByCounterparty.get(counterpartyId) ?? '0.000000', normalized])
      );
    };

    await Promise.all([
      ...payments.map((payment) => addExposure(payment.beneficiary_counterparty_id, payment.amount, payment.currency_code)),
      ...transactions.map((transaction) => addExposure(transaction.counterparty_id, transaction.amount, transaction.currency_code)),
      ...debtFacilities.map((facility) => addExposure(facility.lender_counterparty_id, facility.utilized_amount, facility.currency_code))
    ]);

    const totalExposureAmount = sumDecimalStrings(Array.from(exposureByCounterparty.values()));
    const limitRatio = policySet.counterparty.maxConcentrationRatio ?? DEFAULT_COUNTERPARTY_LIMIT;

    return Array.from(exposureByCounterparty.entries())
      .sort((left, right) => compareDecimalStrings(right[1], left[1]))
      .map(([counterpartyId, exposureAmount]) => {
        const concentrationRatio =
          compareDecimalStrings(totalExposureAmount, '0') === 0
            ? '0.000000'
            : divideDecimalStrings(exposureAmount, totalExposureAmount);

        return {
          riskType: 'credit',
          counterpartyId,
          counterpartyName: counterpartyNames.get(counterpartyId) ?? 'Unknown counterparty',
          valuationDate: asOf,
          baseCurrency,
          exposureAmount,
          totalExposureAmount,
          concentrationRatio,
          limitRatio,
          warningThresholdRatio: policySet.warningThresholdRatio,
          status: ratioStatus(concentrationRatio, limitRatio, policySet.warningThresholdRatio)
        };
      });
  }

  async calculateLiquidityStress(orgId: string): Promise<LiquidityStressResult> {
    const asOf = toDateOnly(this.now());
    const [organization, policySet, forecast, currentCashBuffer] = await Promise.all([
      this.getOrganization(orgId),
      this.getPolicySet(orgId),
      this.getThirtyDayForecast(orgId, asOf),
      this.getCurrentCashBuffer(orgId)
    ]);

    if (forecast.currency_code !== organization.base_currency) {
      throw new ValidationError('Published 30-day forecast must be denominated in the organization base currency');
    }

    const lines = await this.getForecastLines(orgId, forecast.id);
    const inflowStressRatio = policySet.liquidity.inflowStressRatio ?? DEFAULT_STRESS_INFLOW_REDUCTION;
    const outflowStressRatio = policySet.liquidity.outflowStressRatio ?? DEFAULT_STRESS_OUTFLOW_INCREASE;

    let baselineRunning = currentCashBuffer;
    let baselineMinimum = currentCashBuffer;
    let stressedRunning = currentCashBuffer;
    let stressedMinimum = currentCashBuffer;

    for (const line of lines) {
      baselineRunning = sumDecimalStrings([baselineRunning, line.projected_net]);
      baselineMinimum = minDecimalString(baselineMinimum, baselineRunning);

      const stressedInflow = multiplyDecimalStrings(line.projected_inflow, subtractAmounts('1.000000', inflowStressRatio));
      const stressedOutflow = multiplyDecimalStrings(line.projected_outflow, sumDecimalStrings(['1.000000', outflowStressRatio]));
      const stressedNet = subtractAmounts(stressedInflow, stressedOutflow);

      stressedRunning = sumDecimalStrings([stressedRunning, stressedNet]);
      stressedMinimum = minDecimalString(stressedMinimum, stressedRunning);
    }

    return {
      riskType: 'liquidity',
      valuationDate: asOf,
      baseCurrency: organization.base_currency,
      currentCashBuffer,
      baselineMinimumCashBuffer: baselineMinimum,
      stressedMinimumCashBuffer: stressedMinimum,
      minimumPolicyBuffer: policySet.liquidity.minimumStressBuffer,
      inflowStressRatio,
      outflowStressRatio,
      forecastWindowDays: 30,
      status: minimumRequiredStatus(
        stressedMinimum,
        policySet.liquidity.minimumStressBuffer,
        policySet.warningThresholdRatio
      )
    };
  }

  async getPolicySet(orgId: string): Promise<RiskPolicySet> {
    const today = toDateOnly(this.now());
    const { data, error } = await this.db
      .from('treasury_policies')
      .select('rules')
      .eq('organization_id', orgId)
      .eq('is_active', true)
      .lte('effective_from', today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .order('effective_from', { ascending: false });

    if (error) {
      throw new ValidationError('Failed to load treasury policies', { reason: error.message });
    }

    const mergedRules = ((data ?? []) as PolicyRow[]).reduce<Record<string, unknown>>(
      (accumulator, row) => deepMerge(accumulator, row.rules ?? {}),
      {}
    );

    const warningThresholdRatio =
      extractRulesValue(mergedRules, ['risk.warningThresholdRatio', 'warningThresholdRatio'], isString) ??
      DEFAULT_WARNING_THRESHOLD;
    const defaultFxRule = extractRulesValue(mergedRules, ['fx.default', 'risk.fx.default'], isRecord);
    const pairRules = extractRulesValue(mergedRules, ['fx.limits', 'risk.fx.limits'], isRecord) ?? {};

    return {
      warningThresholdRatio,
      defaultFxLimit: defaultFxRule
        ? {
            maxUnhedgedAmount: nullableString(defaultFxRule.maxUnhedgedAmount),
            minCoverageRatio: nullableString(defaultFxRule.minCoverageRatio)
          }
        : null,
      fxLimitsByPair: Object.fromEntries(
        Object.entries(pairRules).map(([pair, value]) => [
          pair,
          isRecord(value)
            ? {
                maxUnhedgedAmount: nullableString(value.maxUnhedgedAmount),
                minCoverageRatio: nullableString(value.minCoverageRatio)
              }
            : {
                maxUnhedgedAmount: null,
                minCoverageRatio: null
              }
        ])
      ),
      interestRate: {
        maxNetFloatingExposure: extractRulesValue(
          mergedRules,
          ['interestRate.maxNetFloatingExposure', 'risk.interestRate.maxNetFloatingExposure'],
          isString
        )
      },
      counterparty: {
        maxConcentrationRatio:
          extractRulesValue(
            mergedRules,
            ['counterparty.maxConcentrationRatio', 'risk.counterparty.maxConcentrationRatio'],
            isString
          ) ?? DEFAULT_COUNTERPARTY_LIMIT
      },
      liquidity: {
        minimumStressBuffer: extractRulesValue(
          mergedRules,
          ['liquidity.minimumStressBuffer', 'risk.liquidity.minimumStressBuffer'],
          isString
        ),
        inflowStressRatio:
          extractRulesValue(
            mergedRules,
            ['liquidity.inflowStressRatio', 'risk.liquidity.inflowStressRatio'],
            isString
          ) ?? DEFAULT_STRESS_INFLOW_REDUCTION,
        outflowStressRatio:
          extractRulesValue(
            mergedRules,
            ['liquidity.outflowStressRatio', 'risk.liquidity.outflowStressRatio'],
            isString
          ) ?? DEFAULT_STRESS_OUTFLOW_INCREASE
      }
    };
  }

  private async getOrganization(orgId: string): Promise<OrganizationRow> {
    const { data, error } = await this.db.from('organizations').select('id,base_currency').eq('id', orgId).single();

    if (error) {
      throw new ValidationError('Failed to load organization', { reason: error.message });
    }

    return data as OrganizationRow;
  }

  private async getOpenPayments(orgId: string): Promise<PaymentRow[]> {
    const { data, error } = await this.db
      .from('payments')
      .select('id,amount,currency_code,status,beneficiary_counterparty_id')
      .eq('organization_id', orgId)
      .in('status', [...OPEN_PAYMENT_STATUSES]);

    if (error) {
      throw new ValidationError('Failed to load open payments', { reason: error.message });
    }

    return (data ?? []) as PaymentRow[];
  }

  private async getOutstandingTransactions(orgId: string): Promise<TransactionRow[]> {
    const { data, error } = await this.db
      .from('transactions')
      .select('id,amount,currency_code,direction,category,reconciliation_status,counterparty_id')
      .eq('organization_id', orgId)
      .eq('reconciliation_status', 'unreconciled')
      .in('category', ['receivable', 'payable']);

    if (error) {
      throw new ValidationError('Failed to load outstanding receivables and payables', { reason: error.message });
    }

    return (data ?? []) as TransactionRow[];
  }

  private async getActiveHedges(orgId: string): Promise<HedgeRow[]> {
    const { data, error } = await this.db
      .from('hedging_instruments')
      .select('id,notional_amount,base_currency,quote_currency,status')
      .eq('organization_id', orgId)
      .in('status', [...ACTIVE_HEDGE_STATUSES]);

    if (error) {
      throw new ValidationError('Failed to load hedging instruments', { reason: error.message });
    }

    return (data ?? []) as HedgeRow[];
  }

  private async getActiveDebtFacilities(orgId: string): Promise<DebtFacilityRow[]> {
    const { data, error } = await this.db
      .from('debt_facilities')
      .select('id,utilized_amount,currency_code,interest_basis,lender_counterparty_id,status')
      .eq('organization_id', orgId)
      .in('status', [...ACTIVE_DEBT_STATUSES]);

    if (error) {
      throw new ValidationError('Failed to load debt facilities', { reason: error.message });
    }

    return (data ?? []) as DebtFacilityRow[];
  }

  private async getVariableRateDebtFacilities(orgId: string): Promise<DebtFacilityRow[]> {
    const facilities = await this.getActiveDebtFacilities(orgId);
    return facilities.filter(
      (facility) =>
        compareDecimalStrings(facility.utilized_amount, '0') > 0 && isVariableRateDescriptor(facility.interest_basis)
    );
  }

  private async getVariableRateInvestments(orgId: string): Promise<InvestmentRow[]> {
    const { data, error } = await this.db
      .from('investments')
      .select('id,principal_amount,currency_code,instrument_type,instrument_name,rate,status')
      .eq('organization_id', orgId)
      .in('status', [...ACTIVE_INVESTMENT_STATUSES]);

    if (error) {
      throw new ValidationError('Failed to load investments', { reason: error.message });
    }

    return ((data ?? []) as InvestmentRow[]).filter(
      (investment) =>
        isVariableRateDescriptor(investment.instrument_type) || isVariableRateDescriptor(investment.instrument_name)
    );
  }

  private async getCounterparties(orgId: string): Promise<CounterpartyRow[]> {
    const { data, error } = await this.db.from('counterparties').select('id,name').eq('organization_id', orgId);

    if (error) {
      throw new ValidationError('Failed to load counterparties', { reason: error.message });
    }

    return (data ?? []) as CounterpartyRow[];
  }

  private async getThirtyDayForecast(orgId: string, asOf: string): Promise<ForecastRow> {
    const endDate = new Date(`${asOf}T00:00:00.000Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 30);

    const { data, error } = await this.db
      .from('cash_flow_forecasts')
      .select('id,currency_code')
      .eq('organization_id', orgId)
      .eq('status', 'published')
      .eq('forecast_type', 'short_term')
      .lte('start_date', asOf)
      .gte('end_date', toDateOnly(endDate))
      .order('updated_at', { ascending: false })
      .limit(1)
      .single();

    if (error) {
      throw new ValidationError('No published 30-day forecast is available', { reason: error.message });
    }

    return data as ForecastRow;
  }

  private async getForecastLines(orgId: string, forecastId: string): Promise<ForecastLineRow[]> {
    const { data, error } = await this.db
      .from('cash_flow_forecast_lines')
      .select('forecast_date,projected_inflow,projected_outflow,projected_net,scenario')
      .eq('organization_id', orgId)
      .eq('forecast_id', forecastId)
      .eq('scenario', 'base')
      .order('forecast_date', { ascending: true });

    if (error) {
      throw new ValidationError('Failed to load forecast lines', { reason: error.message });
    }

    return (data ?? []) as ForecastLineRow[];
  }

  private async getCurrentCashBuffer(orgId: string): Promise<string> {
    const [organization, positionsResult] = await Promise.all([
      this.getOrganization(orgId),
      this.db
        .from('cash_positions_latest')
        .select('currency_code,available_balance')
        .eq('organization_id', orgId)
        .eq('scope_type', 'organization')
    ]);
    const { data, error } = positionsResult;

    if (error) {
      throw new ValidationError('Failed to load cash positions', { reason: error.message });
    }

    const asOf = toDateOnly(this.now());
    const balances = await Promise.all(
      ((data ?? []) as CashPositionRow[]).map(async (position) => {
        const rate = (await this.fxService.getRate({
          base: position.currency_code,
          quote: organization.base_currency,
          asOf
        })).rate.toFixed(6);
        return multiplyDecimalStrings(position.available_balance, rate);
      })
    );

    return balances.length > 0 ? sumDecimalStrings(balances) : '0.000000';
  }
}
