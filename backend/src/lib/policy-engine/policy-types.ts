import { z } from 'zod';
import { CurrencyCodeSchema, DecimalStringSchema } from '@/utils/money';

export const POLICY_DOMAINS = ['payment', 'investment', 'forex', 'liquidity'] as const;
export const POLICY_ACTIONS = ['block', 'warn', 'require_approval', 'auto_approve'] as const;

export type PolicyDomain = (typeof POLICY_DOMAINS)[number];
export type PolicyAction = (typeof POLICY_ACTIONS)[number];

export interface AmountExceedsCondition {
  type: 'amount_exceeds';
  threshold: string;
  currency: string;
}

export interface CounterpartyConcentrationCondition {
  type: 'counterparty_concentration';
  maxPercentage: number;
}

export interface PaymentToRestrictedCountryCondition {
  type: 'payment_to_restricted_country';
  countries: string[];
}

export interface FxExposureExceedsCondition {
  type: 'fx_exposure_exceeds';
  percentage: number;
  currency: string;
}

export interface BalanceBelowMinimumCondition {
  type: 'balance_below_minimum';
  threshold: string;
  accountId?: string;
}

export interface CovenantRatioBreachedCondition {
  type: 'covenant_ratio_breached';
  facilityId: string;
  ratio: string;
}

export interface AndCondition {
  type: 'and';
  conditions: PolicyCondition[];
}

export interface OrCondition {
  type: 'or';
  conditions: PolicyCondition[];
}

export type PolicyCondition =
  | AmountExceedsCondition
  | CounterpartyConcentrationCondition
  | PaymentToRestrictedCountryCondition
  | FxExposureExceedsCondition
  | BalanceBelowMinimumCondition
  | CovenantRatioBreachedCondition
  | AndCondition
  | OrCondition;

export interface PolicyRule {
  id: string;
  name: string;
  condition: PolicyCondition;
  action: PolicyAction;
  message: string;
}

export interface PolicyViolation {
  policyId: string;
  policyName: string;
  ruleId: string;
  ruleName: string;
  action: Extract<PolicyAction, 'block'>;
  message: string;
}

export interface PolicyWarning {
  policyId: string;
  policyName: string;
  ruleId: string;
  ruleName: string;
  action: Exclude<PolicyAction, 'block'>;
  message: string;
}

export interface PolicyEvaluationResult {
  allowed: boolean;
  action: string;
  violations: PolicyViolation[];
  warnings: PolicyWarning[];
}

export interface PolicyContext {
  domain: PolicyDomain;
  payment?: {
    amount: string;
    currency: string;
    counterpartyId: string;
    sourceAccountId: string;
  };
  investment?: {
    amount: string;
    instrumentType: string;
    counterpartyId: string;
  };
  forex?: {
    notional: string;
    currencyPair: string;
    instrumentType: string;
  };
}

export const PolicyDomainSchema = z.enum(POLICY_DOMAINS);
export const PolicyActionSchema = z.enum(POLICY_ACTIONS);

export const PolicyConditionSchema: z.ZodType<PolicyCondition> = z.lazy(() =>
  z.union([
    z.object({
      type: z.literal('amount_exceeds'),
      threshold: DecimalStringSchema,
      currency: CurrencyCodeSchema
    }),
    z.object({
      type: z.literal('counterparty_concentration'),
      maxPercentage: z.number().min(0).max(100)
    }),
    z.object({
      type: z.literal('payment_to_restricted_country'),
      countries: z.array(z.string().trim().length(2).transform((value) => value.toUpperCase())).min(1)
    }),
    z.object({
      type: z.literal('fx_exposure_exceeds'),
      percentage: z.number().min(0).max(100),
      currency: CurrencyCodeSchema
    }),
    z.object({
      type: z.literal('balance_below_minimum'),
      threshold: DecimalStringSchema,
      accountId: z.string().uuid().optional()
    }),
    z.object({
      type: z.literal('covenant_ratio_breached'),
      facilityId: z.string().uuid(),
      ratio: z.string().trim().min(1).max(120)
    }),
    z.object({
      type: z.literal('and'),
      conditions: z.array(PolicyConditionSchema).min(1)
    }),
    z.object({
      type: z.literal('or'),
      conditions: z.array(PolicyConditionSchema).min(1)
    })
  ])
);

export const PolicyRuleSchema: z.ZodType<PolicyRule> = z.object({
  id: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(160),
  condition: PolicyConditionSchema,
  action: PolicyActionSchema,
  message: z.string().trim().min(1).max(280)
});

export const PolicyRuleArraySchema = z.array(PolicyRuleSchema);
export const PolicyRulesDocumentSchema = z.object({
  dsl: PolicyRuleArraySchema
});

export function unwrapPolicyRules(input: unknown): PolicyRule[] {
  if (Array.isArray(input)) {
    return PolicyRuleArraySchema.parse(input);
  }

  return PolicyRulesDocumentSchema.parse(input).dsl;
}

export function wrapPolicyRules(rules: PolicyRule[]) {
  return { dsl: rules };
}

export function collectLeafConditionTypes(condition: PolicyCondition, target = new Set<PolicyCondition['type']>()) {
  if (condition.type === 'and' || condition.type === 'or') {
    for (const child of condition.conditions) {
      collectLeafConditionTypes(child, target);
    }
    return target;
  }

  target.add(condition.type);
  return target;
}
