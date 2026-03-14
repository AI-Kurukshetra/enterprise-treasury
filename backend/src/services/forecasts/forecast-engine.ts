import { z } from 'zod';
import { ValidationError } from '@/errors/ValidationError';
import { invokeClaudeJson, type ClaudeJsonResult } from '@/lib/ai/claude-client';
import { ForecastsRepository, type ForecastLineInsert } from '@/repositories/forecasts/repository';
import type {
  CreateForecastInput,
  Forecast,
  ForecastDetail,
  ForecastResult,
  GenerateForecastScenarioInput
} from '@/types/forecasts/types';
import type { ServiceContext } from '@/services/context';
import { ForecastAccuracyTracker } from '@/services/forecasts/forecast-accuracy-tracker';
import { FxService } from '@/services/fx/service';
import {
  addAmounts,
  compareDecimalStrings,
  decimalToScaledInteger,
  formatDecimalString,
  multiplyDecimalStrings,
  scaledIntegerToAmount,
  subtractAmounts,
  sumDecimalStrings
} from '@/utils/money';

const MonetaryStringSchema = z.string().regex(/^-?\d{1,14}(\.\d{1,6})?$/);
const ConfidenceNumberSchema = z
  .union([z.number(), z.string()])
  .transform((value) => (typeof value === 'number' ? value : Number(value)))
  .refine((value) => Number.isFinite(value) && value >= 0 && value <= 1, 'Confidence score must be between 0 and 1');

const ForecastResponseLineSchema = z.object({
  date: z.string().date(),
  projected_inflow: MonetaryStringSchema,
  projected_outflow: MonetaryStringSchema,
  projected_net: MonetaryStringSchema,
  cumulative_balance: MonetaryStringSchema,
  confidence_score: ConfidenceNumberSchema,
  key_drivers: z.array(z.string().min(1)).min(1)
});

const ForecastResponseSchema = z.object({
  lines: z.array(ForecastResponseLineSchema),
  scenario_summary: z.string().min(1),
  key_risks: z.array(z.string().min(1)).default([]),
  recommended_actions: z.array(z.string().min(1)).default([])
});

const ScenarioNarrativeSchema = z.object({
  scenario_summary: z.string().min(1),
  key_risks: z.array(z.string().min(1)).default([]),
  recommended_actions: z.array(z.string().min(1)).default([])
});

export interface ForecastEngineOptions {
  forecastId?: string;
  requestedByUserId?: string;
  generationJobId?: string | null;
}

interface ForecastPromptContext {
  historicalSummary: unknown[];
  currentCashPosition: {
    availableBalance: string;
    currentBalance: string;
    currencyCode: string;
    asOf: string | null;
  };
  openPayments: unknown[];
  debtRepayments: unknown[];
  investmentInflows: unknown[];
  sweepingRules: unknown[];
  treasuryPolicies: {
    minimumBalance: string | null;
    targetBuffer: string | null;
    rawRules: Record<string, unknown>;
  };
  fewShotExamples: unknown[];
}

function toDateOnly(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T00:00:00.000Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return toDateOnly(next);
}

function startOfWeek(date: string): string {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  const day = parsed.getUTCDay();
  const offset = day === 0 ? -6 : 1 - day;
  parsed.setUTCDate(parsed.getUTCDate() + offset);
  return toDateOnly(parsed);
}

function deepMerge(left: Record<string, unknown>, right: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...left };

  for (const [key, value] of Object.entries(right)) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === 'object' &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(result[key] as Record<string, unknown>, value as Record<string, unknown>);
      continue;
    }

    result[key] = value;
  }

  return result;
}

function extractRulesValue(rules: Record<string, unknown>, paths: string[]): string | null {
  for (const path of paths) {
    const segments = path.split('.');
    let current: unknown = rules;

    for (const segment of segments) {
      if (!current || typeof current !== 'object' || Array.isArray(current) || !(segment in current)) {
        current = undefined;
        break;
      }
      current = (current as Record<string, unknown>)[segment];
    }

    if (typeof current === 'string' && current.trim().length > 0) {
      return current;
    }
  }

  return null;
}

function averageConfidence(lines: Array<{ confidence_score: number }>): string {
  if (lines.length === 0) {
    return '0.0000';
  }

  const total = lines.reduce((sum, line) => sum + line.confidence_score, 0);
  return clampConfidence(total / lines.length);
}

function clampConfidence(value: number): string {
  const clamped = Math.min(1, Math.max(0, value));
  return (Math.round(clamped * 10_000) / 10_000).toFixed(4);
}

function confidenceFactor(confidence: string): string {
  const confidenceBps = BigInt(Math.round(Number(confidence) * 10_000));
  const scaled = 20_000n - confidenceBps;
  const integer = scaled / 10_000n;
  const fraction = (scaled % 10_000n).toString().padStart(4, '0');
  return `${integer.toString()}.${fraction}00`;
}

function integerSqrt(value: bigint): bigint {
  if (value <= 0n) {
    return 0n;
  }

  let x0 = value;
  let x1 = (x0 + value / x0) >> 1n;

  while (x1 < x0) {
    x0 = x1;
    x1 = (x0 + value / x0) >> 1n;
  }

  return x0;
}

function computeProjectedNetStdDev(lines: Array<{ projected_net: string }>): string {
  if (lines.length <= 1) {
    return '0.000000';
  }

  const values = lines.map((line) => decimalToScaledInteger(line.projected_net));
  const total = values.reduce((sum, value) => sum + value, 0n);
  const mean = total / BigInt(values.length);
  const variance =
    values.reduce((sum, value) => {
      const delta = value - mean;
      return sum + (delta * delta);
    }, 0n) / BigInt(values.length);

  return scaledIntegerToAmount(integerSqrt(variance));
}

function extractJsonPayload(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new ValidationError('Claude returned an empty response');
  }

  const withoutFence = trimmed.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/\s*```$/i, '').trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new ValidationError('Claude response did not contain valid JSON');
  }

  return withoutFence.slice(start, end + 1);
}

function buildForecastName(input: CreateForecastInput): string {
  if (input.scenarioName?.trim()) {
    return input.scenarioName.trim();
  }

  return `${input.forecastType === 'short_term' ? 'Short-term' : 'Long-term'} ${input.horizon}-day forecast`;
}

function estimateGenerationTimeSeconds(horizon: number): number {
  if (horizon <= 30) {
    return 18;
  }
  if (horizon <= 90) {
    return 45;
  }
  return 70;
}

function buildExampleResponse(startDate: string, openingBalance: string): Record<string, unknown> {
  const dayOneNet = subtractAmounts('120000.000000', '95000.000000');
  const dayOneBalance = addAmounts(openingBalance, dayOneNet);
  const dayTwoNet = subtractAmounts('98000.000000', '112000.000000');
  const dayTwoBalance = addAmounts(dayOneBalance, dayTwoNet);

  return {
    lines: [
      {
        date: startDate,
        projected_inflow: '120000.000000',
        projected_outflow: '95000.000000',
        projected_net: dayOneNet,
        cumulative_balance: dayOneBalance,
        confidence_score: 0.84,
        key_drivers: ['Customer receipts cadence', 'Known vendor payment batch']
      },
      {
        date: addDays(startDate, 1),
        projected_inflow: '98000.000000',
        projected_outflow: '112000.000000',
        projected_net: dayTwoNet,
        cumulative_balance: dayTwoBalance,
        confidence_score: 0.78,
        key_drivers: ['Debt service payment', 'Routine operating disbursements']
      }
    ],
    scenario_summary: 'Base case assumes normal collections velocity and scheduled operating disbursements.',
    key_risks: ['Receivables timing variance', 'Higher than planned debt servicing cash usage'],
    recommended_actions: ['Hold excess buffer through debt service week', 'Accelerate top 10 receivables follow-up']
  };
}

export class ForecastEngine {
  private readonly repository: ForecastsRepository;
  private readonly fxService: FxService;
  private readonly accuracyTracker: ForecastAccuracyTracker;
  private readonly callClaude: (input: {
    system: string;
    prompt: string;
    maxTokens?: number;
    temperature?: number;
    usageContext: {
      organizationId: string;
      actorId?: string | null;
      entityType?: string;
      entityId?: string | null;
      requestId?: string | null;
      metadata?: Record<string, unknown>;
    };
  }) => Promise<ClaudeJsonResult>;
  private readonly context: ServiceContext;
  private readonly now: () => Date;

  constructor(
    context: ServiceContext,
    options?: {
      repository?: ForecastsRepository;
      fxService?: FxService;
      accuracyTracker?: ForecastAccuracyTracker;
      callClaude?: typeof invokeClaudeJson;
      now?: () => Date;
    }
  ) {
    this.context = context;
    this.repository = options?.repository ?? new ForecastsRepository({ organizationId: context.organizationId });
    this.fxService = options?.fxService ?? new FxService(context);
    this.accuracyTracker =
      options?.accuracyTracker ?? new ForecastAccuracyTracker(context, this.repository, this.fxService, options?.now);
    this.callClaude = options?.callClaude ?? invokeClaudeJson;
    this.now = options?.now ?? (() => new Date());
  }

  async generateForecast(orgId: string, input: CreateForecastInput, options: ForecastEngineOptions = {}): Promise<ForecastResult> {
    if (orgId !== this.context.organizationId) {
      throw new ValidationError('Organization context mismatch for forecast generation');
    }

    const startedAt = Date.now();
    const startDate = toDateOnly(this.now());
    const endDate = addDays(startDate, input.horizon - 1);
    const estimatedTimeSeconds = estimateGenerationTimeSeconds(input.horizon);

    const forecast = options.forecastId
      ? await this.requireForecastForGeneration(options.forecastId, estimatedTimeSeconds)
      : await this.repository.createGenerationRecord(input, options.requestedByUserId ?? this.context.userId, {
          startDate,
          endDate,
          name: buildForecastName(input),
          generationStatus: 'running',
          estimatedTimeSeconds,
          scenarioName: input.scenarioName?.trim() || 'base',
          notes: input.notes,
          baseForecastId: null,
          scenarioParameters: {}
        });

    try {
      const promptContext = await this.buildPromptContext(input, forecast);
      const openingBalance = promptContext.currentCashPosition.availableBalance;
      const claudeResponse = await this.callClaude({
        system:
          'You are a treasury analyst producing deterministic enterprise treasury forecasts. Return valid JSON only and do not include markdown fences.',
        prompt: this.buildForecastPrompt(input, forecast, promptContext, openingBalance),
        maxTokens: Math.max(4_096, input.horizon * 80),
        temperature: 0,
        usageContext: {
          organizationId: orgId,
          actorId: options.requestedByUserId ?? this.context.userId,
          entityType: 'cash_flow_forecasts',
          entityId: forecast.id,
          requestId: this.context.requestId,
          metadata: {
            operation: 'forecast.generate',
            forecastType: input.forecastType,
            horizon: input.horizon,
            currencyCode: input.currencyCode
          }
        }
      });

      const parsed = this.parseForecastResponse(claudeResponse.text, startDate, input.horizon);
      const persistedLines = this.toPersistedLines(parsed.lines, openingBalance, forecast.scenario_name);
      const completedInSeconds = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
      const topConfidence = averageConfidence(parsed.lines);

      await this.repository.replaceForecastLines(forecast.id, persistedLines);
      await this.repository.updateForecast(forecast.id, {
        confidence_score: topConfidence,
        generation_status: 'completed',
        generation_error: null,
        estimated_time_seconds: completedInSeconds,
        generated_at: new Date().toISOString(),
        ai_summary: parsed.scenario_summary,
        key_risks: parsed.key_risks,
        recommended_actions: parsed.recommended_actions,
        prompt_context: promptContext,
        few_shot_examples: promptContext.fewShotExamples
      });

      return {
        forecastId: forecast.id,
        status: 'completed',
        estimatedTimeSeconds: completedInSeconds
      };
    } catch (error) {
      await this.repository.updateForecast(forecast.id, {
        generation_status: 'failed',
        generation_error: error instanceof Error ? error.message : 'Unknown forecast generation error'
      });
      throw error;
    }
  }

  async generateScenario(forecastId: string, params: GenerateForecastScenarioInput): Promise<ForecastResult> {
    const baseForecast = await this.repository.getDetail(forecastId);
    if (!baseForecast) {
      throw new ValidationError('Base forecast not found');
    }
    if (baseForecast.generation_status !== 'completed') {
      throw new ValidationError('Base forecast generation is not complete');
    }

    const baseLines = baseForecast.lines
      .filter((line) => line.scenario === baseForecast.scenario_name)
      .sort((left, right) => left.forecast_date.localeCompare(right.forecast_date));
    if (baseLines.length === 0) {
      throw new ValidationError('Base forecast does not contain persisted lines');
    }

    const input: CreateForecastInput = {
      forecastType: baseForecast.forecast_type,
      horizon: baseForecast.horizon_days ?? baseLines.length,
      currencyCode: baseForecast.currency_code,
      scenarioName: params.scenario_name,
      notes: baseForecast.notes ?? undefined
    };

    const scenarioForecast = await this.repository.createGenerationRecord(input, this.context.userId, {
      startDate: baseForecast.start_date,
      endDate: baseForecast.end_date,
      name: params.scenario_name,
      generationStatus: 'running',
      estimatedTimeSeconds: 12,
      scenarioName: params.scenario_name,
      notes: baseForecast.notes ?? undefined,
      baseForecastId: baseForecast.id,
      scenarioParameters: {
        inflow_change_pct: params.inflow_change_pct,
        outflow_change_pct: params.outflow_change_pct,
        scenario_name: params.scenario_name
      }
    });

    try {
      const adjustedLines = this.buildScenarioLines(baseForecast, baseLines, params);
      const narrative = await this.generateScenarioNarrative(baseForecast, adjustedLines, params);

      await this.repository.replaceForecastLines(scenarioForecast.id, adjustedLines);
      await this.repository.updateForecast(scenarioForecast.id, {
        confidence_score: averageConfidence(
          adjustedLines.map((line) => ({
            confidence_score: Number(line.confidence_score)
          }))
        ),
        generation_status: 'completed',
        generation_error: null,
        generated_at: new Date().toISOString(),
        ai_summary: narrative.scenario_summary,
        key_risks: narrative.key_risks,
        recommended_actions: narrative.recommended_actions,
        prompt_context: {
          baseForecastId: baseForecast.id,
          adjustments: params
        },
        few_shot_examples: []
      });

      return {
        forecastId: scenarioForecast.id,
        status: 'completed',
        estimatedTimeSeconds: 12
      };
    } catch (error) {
      await this.repository.updateForecast(scenarioForecast.id, {
        generation_status: 'failed',
        generation_error: error instanceof Error ? error.message : 'Unknown scenario generation error'
      });
      throw error;
    }
  }

  async refreshAccuracy(forecastId: string) {
    return this.accuracyTracker.calculateForecastAccuracy(forecastId);
  }

  private async requireForecastForGeneration(forecastId: string, estimatedTimeSeconds: number): Promise<Forecast> {
    const updated = await this.repository.updateForecast(forecastId, {
      generation_status: 'running',
      generation_error: null,
      estimated_time_seconds: estimatedTimeSeconds
    });

    if (!updated) {
      throw new ValidationError('Forecast not found for queued generation');
    }

    return updated;
  }

  private async buildPromptContext(input: CreateForecastInput, forecast: Forecast): Promise<ForecastPromptContext> {
    const historyStart = addDays(forecast.start_date, -90);
    const fewShotExamples = await this.accuracyTracker.buildFewShotExamples({
      forecastType: input.forecastType,
      currencyCode: input.currencyCode
    });

    const [historicalTransactions, openPayments, debtRepayments, investmentInflows, sweepingRules, cashPositions, policyRows] =
      await Promise.all([
        this.repository.listHistoricalTransactions(historyStart, forecast.start_date),
        this.normalizeCashEvents(await this.repository.listOpenPayments(forecast.start_date, forecast.end_date), input.currencyCode, 'value_date'),
        this.normalizeDebtRepayments(await this.repository.listUpcomingDebtSchedules(forecast.start_date, forecast.end_date), input.currencyCode),
        this.normalizeCashEvents(
          await this.repository.listInvestmentMaturities(forecast.start_date, forecast.end_date),
          input.currencyCode,
          'maturity_date'
        ),
        this.repository.listSweepingRules(),
        this.repository.getCurrentCashPositions(),
        this.repository.listTreasuryPolicies(forecast.start_date)
      ]);

    const mergedRules = policyRows.reduce<Record<string, unknown>>((accumulator, row) => deepMerge(accumulator, row.rules ?? {}), {});
    const currentCashPosition = await this.normalizeCurrentCashPosition(cashPositions, input.currencyCode);

    return {
      historicalSummary: this.buildHistoricalSummary(historicalTransactions),
      currentCashPosition,
      openPayments,
      debtRepayments,
      investmentInflows,
      sweepingRules: sweepingRules.map((rule) => ({
        id: rule.id,
        frequency: rule.frequency,
        minBalance: rule.min_balance,
        targetBalance: rule.target_balance
      })),
      treasuryPolicies: {
        minimumBalance: extractRulesValue(mergedRules, ['liquidity.minimumBalance', 'minimumBalance', 'liquidity.minimumStressBuffer']),
        targetBuffer: extractRulesValue(mergedRules, ['liquidity.targetBuffer', 'targetBuffer']),
        rawRules: mergedRules
      },
      fewShotExamples: fewShotExamples.map((example) => ({
        scenarioName: example.scenarioName,
        forecastType: example.forecastType,
        horizonDays: example.horizonDays,
        accuracyScore: example.accuracyScore,
        overallMapePct: example.overallMapePct,
        summary: example.summary
      }))
    };
  }

  private buildForecastPrompt(
    input: CreateForecastInput,
    forecast: Forecast,
    promptContext: ForecastPromptContext,
    openingBalance: string
  ): string {
    const example = buildExampleResponse(forecast.start_date, openingBalance);

    return [
      `Generate a ${input.horizon}-day cash flow forecast with daily granularity for organization ${forecast.organization_id}.`,
      'Return valid JSON only.',
      'Use this exact JSON shape:',
      JSON.stringify(example, null, 2),
      'Rules:',
      '- Monetary values must be decimal strings with exactly 6 fractional digits.',
      '- confidence_score must be a number between 0 and 1.',
      '- dates must cover every day in the forecast horizon exactly once.',
      '- key_drivers must be concise treasury explanations.',
      '- Use the provided data only. Do not fabricate external facts.',
      '',
      'Forecast input:',
      JSON.stringify(
        {
          forecastType: input.forecastType,
          horizon: input.horizon,
          currencyCode: input.currencyCode,
          scenarioName: forecast.scenario_name,
          notes: input.notes ?? null,
          startDate: forecast.start_date,
          endDate: forecast.end_date
        },
        null,
        2
      ),
      '',
      'Treasury context:',
      JSON.stringify(promptContext, null, 2)
    ].join('\n');
  }

  private parseForecastResponse(text: string, startDate: string, horizon: number) {
    const payload = JSON.parse(extractJsonPayload(text)) as unknown;
    let parsed: z.infer<typeof ForecastResponseSchema>;

    try {
      parsed = ForecastResponseSchema.parse(payload);
    } catch (error) {
      throw new ValidationError('Claude response failed forecast schema validation', {
        reason: error instanceof Error ? error.message : 'Unknown forecast schema validation error'
      });
    }

    if (parsed.lines.length !== horizon) {
      throw new ValidationError('Forecast response did not include the expected number of daily lines');
    }

    const expectedDates = Array.from({ length: horizon }, (_value, index) => addDays(startDate, index));
    const dates = parsed.lines.map((line) => line.date);

    for (const [index, date] of expectedDates.entries()) {
      if (dates[index] !== date) {
        throw new ValidationError('Forecast response dates were not sequential for the requested horizon');
      }
    }

    return parsed;
  }

  private toPersistedLines(
    lines: Array<z.infer<typeof ForecastResponseLineSchema>>,
    openingBalance: string,
    scenario: string
  ): ForecastLineInsert[] {
    let runningBalance = openingBalance;
    const normalizedLines = lines.map((line) => {
      const projectedInflow = formatDecimalString(line.projected_inflow);
      const projectedOutflow = formatDecimalString(line.projected_outflow);
      const projectedNet = subtractAmounts(projectedInflow, projectedOutflow);
      runningBalance = addAmounts(runningBalance, projectedNet);

      return {
        forecast_date: line.date,
        projected_inflow: projectedInflow,
        projected_outflow: projectedOutflow,
        projected_net: projectedNet,
        cumulative_balance: runningBalance,
        confidence_score: clampConfidence(line.confidence_score),
        key_drivers: line.key_drivers,
        scenario
      };
    });

    const stdDev = computeProjectedNetStdDev(normalizedLines);

    return normalizedLines.map((line) => {
      const bandWidth = multiplyDecimalStrings(stdDev, confidenceFactor(line.confidence_score));
      return {
        ...line,
        balance_low: subtractAmounts(line.cumulative_balance, bandWidth),
        balance_high: addAmounts(line.cumulative_balance, bandWidth)
      };
    });
  }

  private buildHistoricalSummary(transactions: Array<{ booking_date: string; amount: string; currency_code: string; direction: string }>) {
    const grouped = new Map<string, { weekStart: string; direction: string; currencyCode: string; totalAmount: string; transactionCount: number }>();

    for (const transaction of transactions) {
      const weekStart = startOfWeek(transaction.booking_date);
      const key = `${weekStart}:${transaction.direction}:${transaction.currency_code}`;
      const current = grouped.get(key) ?? {
        weekStart,
        direction: transaction.direction,
        currencyCode: transaction.currency_code,
        totalAmount: '0.000000',
        transactionCount: 0
      };

      current.totalAmount = addAmounts(current.totalAmount, transaction.amount);
      current.transactionCount += 1;
      grouped.set(key, current);
    }

    return Array.from(grouped.values()).sort((left, right) => {
      if (left.weekStart === right.weekStart) {
        if (left.currencyCode === right.currencyCode) {
          return left.direction.localeCompare(right.direction);
        }
        return left.currencyCode.localeCompare(right.currencyCode);
      }
      return left.weekStart.localeCompare(right.weekStart);
    });
  }

  private async normalizeCurrentCashPosition(
    cashPositions: Array<{ currency_code: string; available_balance: string; current_balance: string; as_of_at: string }>,
    targetCurrency: string
  ) {
    let availableBalance = '0.000000';
    let currentBalance = '0.000000';
    let latestAsOf: string | null = null;

    for (const position of cashPositions) {
      const available =
        position.currency_code === targetCurrency
          ? position.available_balance
          : ((await this.fxService.convertAmount({
              amount: position.available_balance,
              fromCurrency: position.currency_code,
              toCurrency: targetCurrency,
              asOf: position.as_of_at
            })) as { amount: string }).amount;

      const current =
        position.currency_code === targetCurrency
          ? position.current_balance
          : ((await this.fxService.convertAmount({
              amount: position.current_balance,
              fromCurrency: position.currency_code,
              toCurrency: targetCurrency,
              asOf: position.as_of_at
            })) as { amount: string }).amount;

      availableBalance = addAmounts(availableBalance, available);
      currentBalance = addAmounts(currentBalance, current);
      if (latestAsOf === null || position.as_of_at > latestAsOf) {
        latestAsOf = position.as_of_at;
      }
    }

    return {
      availableBalance,
      currentBalance,
      currencyCode: targetCurrency,
      asOf: latestAsOf
    };
  }

  private async normalizeCashEvents<T extends { amount?: string; principal_amount?: string; currency_code: string; status: string }>(
    items: T[],
    targetCurrency: string,
    dateField: 'value_date' | 'maturity_date'
  ) {
    return Promise.all(
      items.map(async (item) => {
        const amount = item.amount ?? item.principal_amount ?? '0.000000';
        const normalizedAmount =
          item.currency_code === targetCurrency
            ? amount
            : ((await this.fxService.convertAmount({
                amount,
                fromCurrency: item.currency_code,
                toCurrency: targetCurrency,
                asOf: String((item as Record<string, unknown>)[dateField])
              })) as { amount: string }).amount;

        return {
          ...item,
          normalized_amount: normalizedAmount,
          normalized_currency: targetCurrency
        };
      })
    );
  }

  private async normalizeDebtRepayments(
    items: Array<{
      id: string;
      due_date: string;
      principal_due: string;
      interest_due: string;
      status: string;
      debt_facilities: { facility_name: string; currency_code: string } | null;
    }>,
    targetCurrency: string
  ) {
    return Promise.all(
      items.map(async (item) => {
        const sourceCurrency = item.debt_facilities?.currency_code ?? targetCurrency;
        const totalDue = sumDecimalStrings([item.principal_due, item.interest_due]);
        const normalizedAmount =
          sourceCurrency === targetCurrency
            ? totalDue
            : ((await this.fxService.convertAmount({
                amount: totalDue,
                fromCurrency: sourceCurrency,
                toCurrency: targetCurrency,
                asOf: item.due_date
              })) as { amount: string }).amount;

        return {
          id: item.id,
          due_date: item.due_date,
          status: item.status,
          facility_name: item.debt_facilities?.facility_name ?? 'Debt facility',
          total_due: totalDue,
          currency_code: sourceCurrency,
          normalized_amount: normalizedAmount,
          normalized_currency: targetCurrency
        };
      })
    );
  }

  private buildScenarioLines(
    baseForecast: ForecastDetail,
    baseLines: ForecastDetail['lines'],
    params: GenerateForecastScenarioInput
  ): ForecastLineInsert[] {
    const inflowFactor = ((100 + params.inflow_change_pct) / 100).toFixed(6);
    const outflowFactor = ((100 + params.outflow_change_pct) / 100).toFixed(6);
    const firstLine = baseLines[0]!;
    const openingBalance = firstLine.cumulative_balance
      ? subtractAmounts(firstLine.cumulative_balance, firstLine.projected_net)
      : '0.000000';
    let runningBalance = openingBalance;

    return baseLines.map((line) => {
      const projectedInflow = multiplyDecimalStrings(line.projected_inflow, inflowFactor);
      const projectedOutflow = multiplyDecimalStrings(line.projected_outflow, outflowFactor);
      const projectedNet = subtractAmounts(projectedInflow, projectedOutflow);
      runningBalance = addAmounts(runningBalance, projectedNet);

      const baseConfidence = line.confidence_score ? Number(line.confidence_score) : 0.75;
      const confidenceReduction = (Math.abs(params.inflow_change_pct) + Math.abs(params.outflow_change_pct)) / 500;
      const scenarioConfidence = clampConfidence(baseConfidence - confidenceReduction);
      const baseBand =
        line.balance_high && line.balance_low ? subtractAmounts(line.balance_high, line.balance_low) : '0.000000';
      const widenedBand = multiplyDecimalStrings(baseBand, (1 + confidenceReduction).toFixed(6));
      const halfBand = compareDecimalStrings(widenedBand, '0.000000') > 0
        ? divideDecimalStringByTwo(widenedBand)
        : '0.000000';

      return {
        forecast_date: line.forecast_date,
        projected_inflow: projectedInflow,
        projected_outflow: projectedOutflow,
        projected_net: projectedNet,
        cumulative_balance: runningBalance,
        confidence_score: scenarioConfidence,
        key_drivers: [
          ...line.key_drivers,
          `Scenario adjustment: inflows ${params.inflow_change_pct >= 0 ? '+' : ''}${params.inflow_change_pct}%`,
          `Scenario adjustment: outflows ${params.outflow_change_pct >= 0 ? '+' : ''}${params.outflow_change_pct}%`
        ],
        balance_low: subtractAmounts(runningBalance, halfBand),
        balance_high: addAmounts(runningBalance, halfBand),
        scenario: params.scenario_name
      };
    });
  }

  private async generateScenarioNarrative(
    baseForecast: ForecastDetail,
    adjustedLines: ForecastLineInsert[],
    params: GenerateForecastScenarioInput
  ) {
    const response = await this.callClaude({
      system:
        'You are a treasury analyst producing deterministic scenario narratives. Return valid JSON only and do not include markdown fences.',
      prompt: [
        'Summarize the stressed cash flow scenario as valid JSON only.',
        'Return this shape:',
        JSON.stringify(
          {
            scenario_summary: 'text',
            key_risks: ['risk 1'],
            recommended_actions: ['action 1']
          },
          null,
          2
        ),
        'Scenario parameters:',
        JSON.stringify(params, null, 2),
        'Base forecast summary:',
        JSON.stringify(
          {
            scenarioName: baseForecast.scenario_name,
            currencyCode: baseForecast.currency_code,
            aiSummary: baseForecast.ai_summary,
            keyRisks: baseForecast.key_risks,
            recommendedActions: baseForecast.recommended_actions
          },
          null,
          2
        ),
        'Adjusted forecast lines:',
        JSON.stringify(adjustedLines, null, 2)
      ].join('\n'),
      maxTokens: 1_024,
      temperature: 0,
      usageContext: {
        organizationId: this.context.organizationId,
        actorId: this.context.userId,
        entityType: 'cash_flow_forecasts',
        entityId: baseForecast.id,
        requestId: this.context.requestId,
        metadata: {
          operation: 'forecast.scenario.generate',
          baseForecastId: baseForecast.id,
          scenarioName: params.scenario_name
        }
      }
    });

    return ScenarioNarrativeSchema.parse(JSON.parse(extractJsonPayload(response.text)) as unknown);
  }
}

function divideDecimalStringByTwo(value: string): string {
  const scaled = decimalToScaledInteger(value);
  return scaledIntegerToAmount(scaled / 2n);
}
