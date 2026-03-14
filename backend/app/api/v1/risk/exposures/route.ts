import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseQuery, parseResponse } from '@/api/validation';
import { ListRiskExposureQuerySchema } from '@/schemas/risk/schema';
import { toServiceContext } from '@/api/serviceContext';
import { buildServices } from '@/services/serviceFactory';
import { ok } from '@/lib/http';

const RiskStatusSchema = z.enum(['normal', 'warning', 'breached']);
const DecimalSchema = z.string();

const MatrixRowSchema = z.object({
  riskType: z.enum(['fx', 'interest_rate', 'credit', 'liquidity']),
  title: z.string(),
  exposureAmount: DecimalSchema,
  limitAmount: DecimalSchema.nullable(),
  coverageRatio: DecimalSchema.nullable(),
  status: RiskStatusSchema,
  details: z.record(z.string(), z.unknown())
});

const FxExposureSchema = z.object({
  riskType: z.literal('fx'),
  currencyPair: z.string(),
  foreignCurrency: z.string().length(3),
  baseCurrency: z.string().length(3),
  valuationDate: z.string(),
  grossExposureAmount: DecimalSchema,
  netExposureAmount: DecimalSchema,
  hedgedAmount: DecimalSchema,
  unhedgedAmount: DecimalSchema,
  hedgeCoverageRatio: DecimalSchema,
  limitAmount: DecimalSchema.nullable(),
  minimumCoverageRatio: DecimalSchema.nullable(),
  warningThresholdRatio: DecimalSchema,
  status: RiskStatusSchema,
  fxRate: DecimalSchema
});

const ShockScenarioSchema = z.object({
  name: z.enum(['up_100bps', 'up_200bps']),
  rateBps: z.number().int(),
  projectedAnnualImpact: DecimalSchema
});

const InterestRateSchema = z.object({
  riskType: z.literal('interest_rate'),
  valuationDate: z.string(),
  baseCurrency: z.string().length(3),
  floatingDebtAmount: DecimalSchema,
  floatingInvestmentAmount: DecimalSchema,
  netFloatingRateExposure: DecimalSchema,
  limitAmount: DecimalSchema.nullable(),
  warningThresholdRatio: DecimalSchema,
  shockScenarios: z.array(ShockScenarioSchema),
  status: RiskStatusSchema
});

const ConcentrationSchema = z.object({
  riskType: z.literal('credit'),
  counterpartyId: z.string().uuid().nullable(),
  counterpartyName: z.string(),
  valuationDate: z.string(),
  baseCurrency: z.string().length(3),
  exposureAmount: DecimalSchema,
  totalExposureAmount: DecimalSchema,
  concentrationRatio: DecimalSchema,
  limitRatio: DecimalSchema,
  warningThresholdRatio: DecimalSchema,
  status: RiskStatusSchema
});

const LiquiditySchema = z.object({
  riskType: z.literal('liquidity'),
  valuationDate: z.string(),
  baseCurrency: z.string().length(3),
  currentCashBuffer: DecimalSchema,
  baselineMinimumCashBuffer: DecimalSchema,
  stressedMinimumCashBuffer: DecimalSchema,
  minimumPolicyBuffer: DecimalSchema.nullable(),
  inflowStressRatio: DecimalSchema,
  outflowStressRatio: DecimalSchema,
  forecastWindowDays: z.number().int(),
  status: RiskStatusSchema
});

const RiskExposureSnapshotSchema = z.object({
  baseCurrency: z.string().length(3),
  valuationDate: z.string().nullable(),
  lastCalculatedAt: z.string().nullable(),
  summary: z.object({
    breached: z.number().int().nonnegative(),
    warning: z.number().int().nonnegative(),
    normal: z.number().int().nonnegative()
  }),
  matrix: z.array(MatrixRowSchema),
  fx: z.array(FxExposureSchema),
  interestRate: InterestRateSchema.nullable(),
  concentration: z.array(ConcentrationSchema),
  liquidity: LiquiditySchema.nullable()
});

export async function GET(request: NextRequest) {
  return executeRoute(request, {}, async (_req, context) => {
    const query = parseQuery(request, ListRiskExposureQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.risk.listExposures({
      riskType: query.riskType,
      date: query.date,
      currency: query.currency
    });

    return ok(parseResponse(result, RiskExposureSnapshotSchema), context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
