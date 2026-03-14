import type { SupabaseClient } from '@supabase/supabase-js';
import { ValidationError } from '@/errors/ValidationError';
import { createServiceSupabaseClient } from '@/lib/supabase';
import {
  collectLeafConditionTypes,
  type PolicyCondition,
  type PolicyContext,
  type PolicyEvaluationResult,
  type PolicyRule,
  type PolicyWarning,
  type PolicyViolation,
  unwrapPolicyRules
} from '@/lib/policy-engine/policy-types';
import { FxService } from '@/services/fx/service';
import type { ServiceContext } from '@/services/context';
import {
  compareDecimalStrings,
  divideDecimalStrings,
  multiplyDecimalStrings,
  subtractAmounts,
  sumDecimalStrings
} from '@/utils/money';

interface TreasuryPolicyRow {
  id: string;
  policy_name: string;
  policy_type: string;
  rules: unknown;
}

export interface LoadedPolicy {
  id: string;
  name: string;
  domain: string;
  rules: PolicyRule[];
}

interface OrganizationRow {
  id: string;
  base_currency: string;
}

interface CounterpartyRow {
  id: string;
  name: string;
  country_code: string | null;
}

interface OpenPaymentRow {
  id: string;
  amount: string;
  currency_code: string;
  beneficiary_counterparty_id: string;
}

interface OutstandingTransactionRow {
  id: string;
  amount: string;
  currency_code: string;
  counterparty_id: string | null;
}

interface DebtFacilityExposureRow {
  id: string;
  utilized_amount: string;
  currency_code: string;
  lender_counterparty_id: string | null;
}

interface FxExposureRow {
  id: string;
  currency_code: string | null;
  exposure_amount: string;
}

interface CashPositionRow {
  scope_type: 'account' | 'entity' | 'organization';
  scope_id: string | null;
  currency_code: string;
  available_balance: string;
}

interface DebtFacilityRow {
  id: string;
  facility_name: string;
  currency_code: string;
  covenant_summary: Record<string, unknown> | null;
}

export interface EvaluationData {
  leafTypes: Set<PolicyCondition['type']>;
  policies: LoadedPolicy[];
  organization: OrganizationRow | null;
  counterpartiesById: Map<string, CounterpartyRow>;
  openPayments: OpenPaymentRow[];
  outstandingTransactions: OutstandingTransactionRow[];
  debtFacilitiesForExposure: DebtFacilityExposureRow[];
  fxExposures: FxExposureRow[];
  cashPositions: CashPositionRow[];
  debtFacilitiesById: Map<string, DebtFacilityRow>;
}

const OPEN_PAYMENT_STATUSES = ['draft', 'pending_approval', 'approved', 'sent'] as const;
const ACTIVE_DEBT_STATUSES = ['active'] as const;
const PERCENT_SCALE = '100.000000';

function toDateOnly(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values));
}

function getActionPriority(action: string): number {
  switch (action) {
    case 'block':
      return 4;
    case 'require_approval':
      return 3;
    case 'warn':
      return 2;
    case 'auto_approve':
      return 1;
    default:
      return 0;
  }
}

export class PolicyEvaluator {
  private readonly db: SupabaseClient;
  private readonly fxService: FxService;
  private readonly now: () => Date;
  private readonly rateCache = new Map<string, string>();
  private readonly loadPoliciesOverride?: (orgId: string, domain: string) => Promise<LoadedPolicy[]>;
  private readonly prepareEvaluationDataOverride?: (
    orgId: string,
    context: PolicyContext,
    policies: LoadedPolicy[]
  ) => Promise<EvaluationData>;
  private readonly insertAuditEntriesOverride?: (entries: Array<Record<string, unknown>>) => Promise<void>;

  constructor(
    private readonly serviceContext: ServiceContext,
    options?: {
      db?: SupabaseClient;
      fxService?: FxService;
      now?: () => Date;
      loadPolicies?: (orgId: string, domain: string) => Promise<LoadedPolicy[]>;
      prepareEvaluationData?: (orgId: string, context: PolicyContext, policies: LoadedPolicy[]) => Promise<EvaluationData>;
      insertAuditEntries?: (entries: Array<Record<string, unknown>>) => Promise<void>;
    }
  ) {
    this.db = options?.db ?? createServiceSupabaseClient();
    this.fxService = options?.fxService ?? new FxService(serviceContext, { now: options?.now });
    this.now = options?.now ?? (() => new Date());
    this.loadPoliciesOverride = options?.loadPolicies;
    this.prepareEvaluationDataOverride = options?.prepareEvaluationData;
    this.insertAuditEntriesOverride = options?.insertAuditEntries;
  }

  async evaluate(orgId: string, context: PolicyContext): Promise<PolicyEvaluationResult> {
    const policies = this.loadPoliciesOverride
      ? await this.loadPoliciesOverride(orgId, context.domain)
      : await this.loadActivePolicies(orgId, context.domain);
    if (policies.length === 0) {
      return {
        allowed: true,
        action: 'allow',
        violations: [],
        warnings: []
      };
    }

    const evaluationData = this.prepareEvaluationDataOverride
      ? await this.prepareEvaluationDataOverride(orgId, context, policies)
      : await this.prepareEvaluationData(orgId, context, policies);
    const violations: PolicyViolation[] = [];
    const warnings: PolicyWarning[] = [];
    let selectedAction = 'allow';
    const auditEntries: Array<Record<string, unknown>> = [];

    for (const policy of evaluationData.policies) {
      for (const rule of policy.rules) {
        const matched = await this.evaluateConditionWithData(rule.condition, context, evaluationData);
        if (!matched) {
          continue;
        }

        if (getActionPriority(rule.action) > getActionPriority(selectedAction)) {
          selectedAction = rule.action;
        }

        if (rule.action === 'block') {
          violations.push({
            policyId: policy.id,
            policyName: policy.name,
            ruleId: rule.id,
            ruleName: rule.name,
            action: 'block',
            message: rule.message
          });
        } else {
          warnings.push({
            policyId: policy.id,
            policyName: policy.name,
            ruleId: rule.id,
            ruleName: rule.name,
            action: rule.action,
            message: rule.message
          });
        }

        auditEntries.push({
          organization_id: orgId,
          user_id: this.serviceContext.userId,
          action: `policy_engine.${rule.action}`,
          entity_type: 'treasury_policy',
          entity_id: policy.id,
          request_id: this.serviceContext.requestId,
          source_channel: 'policy_engine',
          metadata: {
            domain: context.domain,
            policyName: policy.name,
            ruleId: rule.id,
            ruleName: rule.name,
            action: rule.action,
            context
          }
        });
      }
    }

    if (auditEntries.length > 0) {
      if (this.insertAuditEntriesOverride) {
        await this.insertAuditEntriesOverride(auditEntries);
      } else {
        const { error } = await this.db.from('audit_logs').insert(auditEntries);
        if (error) {
          throw new ValidationError('Failed to persist policy audit log entries', { reason: error.message });
        }
      }
    }

    return {
      allowed: violations.length === 0,
      action: selectedAction,
      violations,
      warnings
    };
  }

  async evaluateCondition(condition: PolicyCondition, context: PolicyContext): Promise<boolean> {
    const mockPolicy: LoadedPolicy = {
      id: 'inline',
      name: 'inline',
      domain: context.domain,
      rules: [
        {
          id: 'inline',
          name: 'inline',
          condition,
          action: 'warn',
          message: 'inline'
        }
      ]
    };
    const evaluationData = this.prepareEvaluationDataOverride
      ? await this.prepareEvaluationDataOverride(this.serviceContext.organizationId, context, [mockPolicy])
      : await this.prepareEvaluationData(this.serviceContext.organizationId, context, [mockPolicy]);
    return this.evaluateConditionWithData(condition, context, evaluationData);
  }

  private async loadActivePolicies(orgId: string, domain: string): Promise<LoadedPolicy[]> {
    const today = toDateOnly(this.now());
    const { data, error } = await this.db
      .from('treasury_policies')
      .select('id,policy_name,policy_type,rules')
      .eq('organization_id', orgId)
      .eq('policy_type', domain)
      .eq('is_active', true)
      .lte('effective_from', today)
      .or(`effective_to.is.null,effective_to.gte.${today}`)
      .order('effective_from', { ascending: false });

    if (error) {
      throw new ValidationError('Failed to load active treasury policies', { reason: error.message, domain });
    }

    return ((data ?? []) as TreasuryPolicyRow[]).map((row) => ({
      id: row.id,
      name: row.policy_name,
      domain: row.policy_type,
      rules: unwrapPolicyRules(row.rules)
    }));
  }

  private async prepareEvaluationData(
    orgId: string,
    context: PolicyContext,
    policies: LoadedPolicy[]
  ): Promise<EvaluationData> {
    const leafTypes = new Set<PolicyCondition['type']>();
    for (const policy of policies) {
      for (const rule of policy.rules) {
        collectLeafConditionTypes(rule.condition, leafTypes);
      }
    }

    const accountIds = unique(
      [
        context.payment?.sourceAccountId,
        ...policies.flatMap((policy) =>
          policy.rules
            .flatMap((rule) => Array.from(this.extractAccountIds(rule.condition)))
            .filter((value): value is string => Boolean(value))
        )
      ].filter((value): value is string => Boolean(value))
    );
    const facilityIds = unique(
      policies.flatMap((policy) =>
        policy.rules
          .flatMap((rule) => Array.from(this.extractFacilityIds(rule.condition)))
          .filter((value): value is string => Boolean(value))
      )
    );
    const counterpartyIds = unique(
      [
        context.payment?.counterpartyId,
        context.investment?.counterpartyId
      ].filter((value): value is string => Boolean(value))
    );

    const shouldLoadOrganization =
      leafTypes.has('counterparty_concentration') ||
      leafTypes.has('fx_exposure_exceeds') ||
      (leafTypes.has('balance_below_minimum') && accountIds.length === 0) ||
      (context.domain === 'investment' && (leafTypes.has('amount_exceeds') || leafTypes.has('counterparty_concentration')));

    const [
      organizationResult,
      counterpartiesResult,
      openPaymentsResult,
      outstandingTransactionsResult,
      debtExposureResult,
      fxExposureResult,
      cashPositionsResult,
      debtFacilitiesResult
    ] = await Promise.all([
      shouldLoadOrganization
        ? this.db.from('organizations').select('id,base_currency').eq('id', orgId).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
      counterpartyIds.length > 0
        ? this.db.from('counterparties').select('id,name,country_code').eq('organization_id', orgId).in('id', counterpartyIds)
        : Promise.resolve({ data: [], error: null }),
      leafTypes.has('counterparty_concentration')
        ? this.db
            .from('payments')
            .select('id,amount,currency_code,beneficiary_counterparty_id')
            .eq('organization_id', orgId)
            .in('status', [...OPEN_PAYMENT_STATUSES])
        : Promise.resolve({ data: [], error: null }),
      leafTypes.has('counterparty_concentration')
        ? this.db
            .from('transactions')
            .select('id,amount,currency_code,counterparty_id')
            .eq('organization_id', orgId)
            .eq('reconciliation_status', 'unreconciled')
            .in('category', ['receivable', 'payable'])
        : Promise.resolve({ data: [], error: null }),
      leafTypes.has('counterparty_concentration')
        ? this.db
            .from('debt_facilities')
            .select('id,utilized_amount,currency_code,lender_counterparty_id')
            .eq('organization_id', orgId)
            .in('status', [...ACTIVE_DEBT_STATUSES])
        : Promise.resolve({ data: [], error: null }),
      leafTypes.has('fx_exposure_exceeds')
        ? this.db
            .from('risk_exposures')
            .select('id,currency_code,exposure_amount')
            .eq('organization_id', orgId)
            .eq('risk_type', 'fx')
        : Promise.resolve({ data: [], error: null }),
      leafTypes.has('balance_below_minimum')
        ? this.db
            .from('cash_positions_latest')
            .select('scope_type,scope_id,currency_code,available_balance')
            .eq('organization_id', orgId)
            .or(
              accountIds.length > 0
                ? `scope_type.eq.organization,and(scope_type.eq.account,scope_id.in.(${accountIds.join(',')}))`
                : 'scope_type.eq.organization'
            )
        : Promise.resolve({ data: [], error: null }),
      facilityIds.length > 0
        ? this.db
            .from('debt_facilities')
            .select('id,facility_name,currency_code,covenant_summary')
            .eq('organization_id', orgId)
            .in('id', facilityIds)
        : Promise.resolve({ data: [], error: null })
    ]);

    if (organizationResult.error) {
      throw new ValidationError('Failed to load organization policy context', { reason: organizationResult.error.message });
    }
    if (counterpartiesResult.error) {
      throw new ValidationError('Failed to load policy counterparties', { reason: counterpartiesResult.error.message });
    }
    if (openPaymentsResult.error) {
      throw new ValidationError('Failed to load open payments for policy evaluation', { reason: openPaymentsResult.error.message });
    }
    if (outstandingTransactionsResult.error) {
      throw new ValidationError('Failed to load transaction exposure for policy evaluation', {
        reason: outstandingTransactionsResult.error.message
      });
    }
    if (debtExposureResult.error) {
      throw new ValidationError('Failed to load debt exposure for policy evaluation', {
        reason: debtExposureResult.error.message
      });
    }
    if (fxExposureResult.error) {
      throw new ValidationError('Failed to load FX exposure for policy evaluation', { reason: fxExposureResult.error.message });
    }
    if (cashPositionsResult.error) {
      throw new ValidationError('Failed to load cash positions for policy evaluation', {
        reason: cashPositionsResult.error.message
      });
    }
    if (debtFacilitiesResult.error) {
      throw new ValidationError('Failed to load debt facility covenant data', { reason: debtFacilitiesResult.error.message });
    }

    return {
      leafTypes,
      policies,
      organization: (organizationResult.data as OrganizationRow | null) ?? null,
      counterpartiesById: new Map(((counterpartiesResult.data ?? []) as CounterpartyRow[]).map((row) => [row.id, row])),
      openPayments: (openPaymentsResult.data ?? []) as OpenPaymentRow[],
      outstandingTransactions: (outstandingTransactionsResult.data ?? []) as OutstandingTransactionRow[],
      debtFacilitiesForExposure: (debtExposureResult.data ?? []) as DebtFacilityExposureRow[],
      fxExposures: (fxExposureResult.data ?? []) as FxExposureRow[],
      cashPositions: (cashPositionsResult.data ?? []) as CashPositionRow[],
      debtFacilitiesById: new Map(((debtFacilitiesResult.data ?? []) as DebtFacilityRow[]).map((row) => [row.id, row]))
    };
  }

  private async evaluateConditionWithData(
    condition: PolicyCondition,
    context: PolicyContext,
    data: EvaluationData
  ): Promise<boolean> {
    switch (condition.type) {
      case 'and':
        for (const nestedCondition of condition.conditions) {
          if (!(await this.evaluateConditionWithData(nestedCondition, context, data))) {
            return false;
          }
        }
        return true;
      case 'or':
        for (const nestedCondition of condition.conditions) {
          if (await this.evaluateConditionWithData(nestedCondition, context, data)) {
            return true;
          }
        }
        return false;
      case 'amount_exceeds':
        return this.evaluateAmountExceeds(condition, context, data);
      case 'counterparty_concentration':
        return this.evaluateCounterpartyConcentration(condition, context, data);
      case 'payment_to_restricted_country':
        return this.evaluateRestrictedCountry(condition, context, data);
      case 'fx_exposure_exceeds':
        return this.evaluateFxExposure(condition, context, data);
      case 'balance_below_minimum':
        return this.evaluateBalanceMinimum(condition, context, data);
      case 'covenant_ratio_breached':
        return this.evaluateCovenantRatio(condition, data);
      default:
        return false;
    }
  }

  private async evaluateAmountExceeds(
    condition: Extract<PolicyCondition, { type: 'amount_exceeds' }>,
    context: PolicyContext,
    data: EvaluationData
  ) {
    const monetaryContext = this.resolveContextAmount(context, data.organization?.base_currency ?? null);
    if (!monetaryContext) {
      return false;
    }

    const normalizedAmount = await this.convertAmount(monetaryContext.amount, monetaryContext.currency, condition.currency);
    return compareDecimalStrings(normalizedAmount, condition.threshold) > 0;
  }

  private async evaluateCounterpartyConcentration(
    condition: Extract<PolicyCondition, { type: 'counterparty_concentration' }>,
    context: PolicyContext,
    data: EvaluationData
  ) {
    const counterpartyId = context.payment?.counterpartyId ?? context.investment?.counterpartyId ?? null;
    const baseCurrency = data.organization?.base_currency;
    if (!counterpartyId || !baseCurrency) {
      return false;
    }

    const exposureByCounterparty = new Map<string, string>();
    const addExposure = async (targetCounterpartyId: string | null, amount: string, currency: string) => {
      if (!targetCounterpartyId) {
        return;
      }

      const converted = await this.convertAmount(amount, currency, baseCurrency);
      exposureByCounterparty.set(
        targetCounterpartyId,
        sumDecimalStrings([exposureByCounterparty.get(targetCounterpartyId) ?? '0.000000', converted])
      );
    };

    await Promise.all([
      ...data.openPayments.map((payment) =>
        addExposure(payment.beneficiary_counterparty_id, payment.amount, payment.currency_code)
      ),
      ...data.outstandingTransactions.map((transaction) =>
        addExposure(transaction.counterparty_id, transaction.amount, transaction.currency_code)
      ),
      ...data.debtFacilitiesForExposure.map((facility) =>
        addExposure(facility.lender_counterparty_id, facility.utilized_amount, facility.currency_code)
      )
    ]);

    const pendingMonetaryContext = this.resolveContextAmount(context, baseCurrency);
    if (pendingMonetaryContext) {
      await addExposure(counterpartyId, pendingMonetaryContext.amount, pendingMonetaryContext.currency);
    }

    const totalExposure = sumDecimalStrings(Array.from(exposureByCounterparty.values()));
    if (compareDecimalStrings(totalExposure, '0') <= 0) {
      return false;
    }

    const targetExposure = exposureByCounterparty.get(counterpartyId) ?? '0.000000';
    const ratio = divideDecimalStrings(targetExposure, totalExposure);
    const threshold = divideDecimalStrings(condition.maxPercentage.toFixed(6), PERCENT_SCALE);

    return compareDecimalStrings(ratio, threshold) > 0;
  }

  private evaluateRestrictedCountry(
    condition: Extract<PolicyCondition, { type: 'payment_to_restricted_country' }>,
    context: PolicyContext,
    data: EvaluationData
  ) {
    if (context.domain !== 'payment' || !context.payment?.counterpartyId) {
      return false;
    }

    const counterparty = data.counterpartiesById.get(context.payment.counterpartyId);
    const countryCode = counterparty?.country_code?.toUpperCase();
    if (!countryCode) {
      return false;
    }

    return condition.countries.includes(countryCode);
  }

  private async evaluateFxExposure(
    condition: Extract<PolicyCondition, { type: 'fx_exposure_exceeds' }>,
    context: PolicyContext,
    data: EvaluationData
  ) {
    const baseCurrency = data.organization?.base_currency;
    if (!baseCurrency) {
      return false;
    }

    const exposureAmounts = await Promise.all(
      data.fxExposures.map(async (exposure) => {
        const currency = exposure.currency_code ?? baseCurrency;
        const converted = await this.convertAmount(exposure.exposure_amount, currency, baseCurrency);
        return {
          currency,
          amount: converted
        };
      })
    );

    let totalExposure = sumDecimalStrings(exposureAmounts.map((entry) => entry.amount));
    let targetExposure = sumDecimalStrings(
      exposureAmounts.filter((entry) => entry.currency === condition.currency).map((entry) => entry.amount)
    );

    if (context.domain === 'forex' && context.forex) {
      const [base, quote] = context.forex.currencyPair.split('/').map((value) => value.toUpperCase());
      if (base === condition.currency || quote === condition.currency) {
        const convertedPending = await this.convertAmount(context.forex.notional, condition.currency, baseCurrency);
        totalExposure = sumDecimalStrings([totalExposure, convertedPending]);
        targetExposure = sumDecimalStrings([targetExposure, convertedPending]);
      }
    }

    if (compareDecimalStrings(totalExposure, '0') <= 0) {
      return false;
    }

    const ratio = divideDecimalStrings(targetExposure, totalExposure);
    const threshold = divideDecimalStrings(condition.percentage.toFixed(6), PERCENT_SCALE);
    return compareDecimalStrings(ratio, threshold) > 0;
  }

  private async evaluateBalanceMinimum(
    condition: Extract<PolicyCondition, { type: 'balance_below_minimum' }>,
    context: PolicyContext,
    data: EvaluationData
  ) {
    const targetAccountId = condition.accountId ?? context.payment?.sourceAccountId;
    if (targetAccountId) {
      const accountPosition = data.cashPositions.find(
        (position) => position.scope_type === 'account' && position.scope_id === targetAccountId
      );
      if (!accountPosition) {
        throw new ValidationError('Policy account balance could not be evaluated because no account cash position exists', {
          accountId: targetAccountId
        });
      }

      let availableBalance = accountPosition.available_balance;
      if (context.domain === 'payment' && context.payment?.sourceAccountId === targetAccountId) {
        const paymentAmount = await this.convertAmount(
          context.payment.amount,
          context.payment.currency,
          accountPosition.currency_code
        );
        availableBalance = subtractAmounts(availableBalance, paymentAmount);
      }

      return compareDecimalStrings(availableBalance, condition.threshold) < 0;
    }

    const baseCurrency = data.organization?.base_currency;
    if (!baseCurrency) {
      return false;
    }

    const organizationBalances = await Promise.all(
      data.cashPositions
        .filter((position) => position.scope_type === 'organization')
        .map((position) => this.convertAmount(position.available_balance, position.currency_code, baseCurrency))
    );
    let totalAvailable = organizationBalances.length > 0 ? sumDecimalStrings(organizationBalances) : '0.000000';

    if (context.domain === 'payment' && context.payment) {
      const pending = await this.convertAmount(context.payment.amount, context.payment.currency, baseCurrency);
      totalAvailable = subtractAmounts(totalAvailable, pending);
    }

    return compareDecimalStrings(totalAvailable, condition.threshold) < 0;
  }

  private async evaluateCovenantRatio(
    condition: Extract<PolicyCondition, { type: 'covenant_ratio_breached' }>,
    data: EvaluationData
  ) {
    const facility = data.debtFacilitiesById.get(condition.facilityId);
    if (!facility) {
      throw new ValidationError('Policy debt facility could not be found for covenant evaluation', {
        facilityId: condition.facilityId
      });
    }

    const covenant = this.extractCovenantEntry(facility.covenant_summary, condition.ratio);
    if (!covenant) {
      throw new ValidationError('Policy covenant ratio data is missing or malformed', {
        facilityId: condition.facilityId,
        ratio: condition.ratio
      });
    }

    if (covenant.breached === true) {
      return true;
    }

    if (covenant.max && compareDecimalStrings(covenant.actual, covenant.max) > 0) {
      return true;
    }

    if (covenant.min && compareDecimalStrings(covenant.actual, covenant.min) < 0) {
      return true;
    }

    return false;
  }

  private extractAccountIds(condition: PolicyCondition, target = new Set<string>()) {
    if (condition.type === 'and' || condition.type === 'or') {
      for (const nestedCondition of condition.conditions) {
        this.extractAccountIds(nestedCondition, target);
      }
      return target;
    }

    if (condition.type === 'balance_below_minimum' && condition.accountId) {
      target.add(condition.accountId);
    }
    return target;
  }

  private extractFacilityIds(condition: PolicyCondition, target = new Set<string>()) {
    if (condition.type === 'and' || condition.type === 'or') {
      for (const nestedCondition of condition.conditions) {
        this.extractFacilityIds(nestedCondition, target);
      }
      return target;
    }

    if (condition.type === 'covenant_ratio_breached') {
      target.add(condition.facilityId);
    }
    return target;
  }

  private resolveContextAmount(context: PolicyContext, fallbackCurrency: string | null) {
    if (context.payment) {
      return {
        amount: context.payment.amount,
        currency: context.payment.currency
      };
    }

    if (context.investment) {
      if (!fallbackCurrency) {
        return null;
      }

      return {
        amount: context.investment.amount,
        currency: fallbackCurrency
      };
    }

    if (context.forex) {
      const baseCurrency = context.forex.currencyPair.split('/')[0]?.toUpperCase();
      if (!baseCurrency) {
        return null;
      }

      return {
        amount: context.forex.notional,
        currency: baseCurrency
      };
    }

    return null;
  }

  private extractCovenantEntry(summary: Record<string, unknown> | null, ratioName: string) {
    if (!summary) {
      return null;
    }

    const record = summary as Record<string, unknown>;
    const direct = record[ratioName];
    const nested = typeof record.ratios === 'object' && record.ratios !== null ? (record.ratios as Record<string, unknown>)[ratioName] : undefined;
    const candidate = (nested ?? direct) as Record<string, unknown> | undefined;

    if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
      const actual = this.readDecimal(candidate.actual ?? candidate.current ?? candidate.value);
      const max = this.readDecimal(candidate.max ?? candidate.limit ?? candidate.threshold);
      const min = this.readDecimal(candidate.min);
      const breached = typeof candidate.breached === 'boolean' ? candidate.breached : undefined;

      if (actual) {
        return { actual, max, min, breached };
      }
    }

    if (Array.isArray(record.breachedRatios) && record.breachedRatios.includes(ratioName)) {
      return {
        actual: '1.000000',
        max: '0.000000',
        min: null,
        breached: true
      };
    }

    return null;
  }

  private readDecimal(value: unknown) {
    if (typeof value !== 'string') {
      return null;
    }

    return value;
  }

  private async convertAmount(amount: string, fromCurrency: string, toCurrency: string) {
    const normalizedFrom = fromCurrency.toUpperCase();
    const normalizedTo = toCurrency.toUpperCase();
    if (normalizedFrom === normalizedTo) {
      return amount;
    }

    const cacheKey = `${normalizedFrom}:${normalizedTo}`;
    let rate = this.rateCache.get(cacheKey);
    if (!rate) {
      const loadedRate = await this.fxService.getRate({
        base: normalizedFrom,
        quote: normalizedTo,
        asOf: toDateOnly(this.now())
      });
      rate = loadedRate.rate.toFixed(6);
      this.rateCache.set(cacheKey, rate);
    }

    return multiplyDecimalStrings(amount, rate);
  }
}
