import { ValidationError } from '@/errors/ValidationError';
import { ForecastsRepository } from '@/repositories/forecasts/repository';
import type { Forecast } from '@/types/forecasts/types';
import type { ServiceContext } from '@/services/context';
import { FxService } from '@/services/fx/service';
import {
  absoluteAmount,
  addAmounts,
  divideDecimalStrings,
  maxDecimalString,
  minDecimalString,
  multiplyDecimalStrings,
  subtractAmounts
} from '@/utils/money';

function toDateOnly(value: Date | string): string {
  return (value instanceof Date ? value : new Date(value)).toISOString().slice(0, 10);
}

function decimalCount(count: number): string {
  return `${count}.000000`;
}

export interface ForecastAccuracyResult {
  forecastId: string;
  accuracyScore: string;
  overallMapePct: string;
  evaluatedDays: number;
}

export interface ForecastFewShotExample {
  scenarioName: string;
  forecastType: Forecast['forecast_type'];
  horizonDays: number | null;
  accuracyScore: string | null;
  overallMapePct: string | null;
  summary: string | null;
}

interface ActualDayTotals {
  inflow: string;
  outflow: string;
}

export class ForecastAccuracyTracker {
  private readonly repository: ForecastsRepository;
  private readonly fxService: FxService;
  private readonly now: () => Date;

  constructor(
    context: ServiceContext,
    repository?: ForecastsRepository,
    fxService?: FxService,
    now: () => Date = () => new Date()
  ) {
    this.repository = repository ?? new ForecastsRepository({ organizationId: context.organizationId });
    this.fxService = fxService ?? new FxService(context);
    this.now = now;
  }

  async calculateForecastAccuracy(forecastId: string): Promise<ForecastAccuracyResult> {
    const forecast = await this.repository.getDetail(forecastId);
    if (!forecast) {
      throw new ValidationError('Forecast not found for accuracy tracking');
    }

    if (toDateOnly(this.now()) <= forecast.end_date) {
      throw new ValidationError('Forecast period has not ended yet');
    }

    const forecastLines = forecast.lines.filter((line) => line.scenario === forecast.scenario_name);
    if (forecastLines.length === 0) {
      throw new ValidationError('Forecast does not contain persisted forecast lines');
    }

    const actualTransactions = await this.repository.listHistoricalTransactions(forecast.start_date, forecast.end_date);
    const actualsByDate = await this.buildActualsByDate(actualTransactions, forecast.currency_code);

    let ratioSum = '0.000000';
    const dayMetrics = [];

    for (const line of forecastLines) {
      const actualDay = actualsByDate.get(line.forecast_date) ?? {
        inflow: '0.000000',
        outflow: '0.000000'
      };
      const actualNet = subtractAmounts(actualDay.inflow, actualDay.outflow);
      const predictedNet = line.projected_net;
      const absoluteError = absoluteAmount(subtractAmounts(predictedNet, actualNet));
      const denominator = maxDecimalString(absoluteAmount(actualNet), '1.000000');
      const mapeRatio = divideDecimalStrings(absoluteError, denominator, 6);
      const mapePct = multiplyDecimalStrings(mapeRatio, '100.000000');

      ratioSum = addAmounts(ratioSum, mapeRatio);
      dayMetrics.push({
        date: line.forecast_date,
        predictedInflow: line.projected_inflow,
        predictedOutflow: line.projected_outflow,
        predictedNet,
        actualInflow: actualDay.inflow,
        actualOutflow: actualDay.outflow,
        actualNet,
        mapePct
      });
    }

    const evaluatedDays = dayMetrics.length;
    const overallMapeRatio = divideDecimalStrings(ratioSum, decimalCount(evaluatedDays), 6);
    const overallMapePct = multiplyDecimalStrings(overallMapeRatio, '100.000000');
    const accuracyScore = subtractAmounts('1.000000', minDecimalString(overallMapeRatio, '1.000000'));

    await this.repository.updateForecast(forecastId, {
      accuracy_score: accuracyScore,
      accuracy_details: {
        overallMapePct,
        evaluatedDays,
        dayMetrics,
        lastCalculatedAt: this.now().toISOString()
      }
    });

    return {
      forecastId,
      accuracyScore,
      overallMapePct,
      evaluatedDays
    };
  }

  async buildFewShotExamples(input: {
    forecastType: Forecast['forecast_type'];
    currencyCode: string;
    limit?: number;
  }): Promise<ForecastFewShotExample[]> {
    const examples = await this.repository.listPromptExamples({
      forecastType: input.forecastType,
      currencyCode: input.currencyCode,
      limit: input.limit ?? 3
    });

    return examples.map((forecast) => ({
      scenarioName: forecast.scenario_name,
      forecastType: forecast.forecast_type,
      horizonDays: forecast.horizon_days,
      accuracyScore: forecast.accuracy_score,
      overallMapePct:
        typeof forecast.accuracy_details.overallMapePct === 'string'
          ? String(forecast.accuracy_details.overallMapePct)
          : null,
      summary: forecast.ai_summary
    }));
  }

  private async buildActualsByDate(
    transactions: Array<{ booking_date: string; amount: string; currency_code: string; direction: 'inflow' | 'outflow' }>,
    forecastCurrency: string
  ): Promise<Map<string, ActualDayTotals>> {
    const results = new Map<string, ActualDayTotals>();

    for (const transaction of transactions) {
      const convertedAmount =
        transaction.currency_code === forecastCurrency
          ? transaction.amount
          : ((await this.fxService.convertAmount({
              amount: transaction.amount,
              fromCurrency: transaction.currency_code,
              toCurrency: forecastCurrency,
              asOf: transaction.booking_date
            })) as { amount: string }).amount;

      const current = results.get(transaction.booking_date) ?? {
        inflow: '0.000000',
        outflow: '0.000000'
      };

      if (transaction.direction === 'inflow') {
        current.inflow = addAmounts(current.inflow, convertedAmount);
      } else {
        current.outflow = addAmounts(current.outflow, convertedAmount);
      }

      results.set(transaction.booking_date, current);
    }

    return results;
  }
}
