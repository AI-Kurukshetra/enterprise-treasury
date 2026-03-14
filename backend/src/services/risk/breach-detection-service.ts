import type { SupabaseClient } from '@supabase/supabase-js';
import { NotFoundError } from '@/errors/NotFoundError';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { JobQueue } from '@/lib/job-queue/job-queue';
import { RiskAlertsRepository } from '@/repositories/risk/alerts-repository';
import { RiskRepository } from '@/repositories/risk/repository';
import { RiskCalculationEngine } from '@/services/risk/calculation-engine';
import type {
  BreachItem,
  BreachSummary,
  ConcentrationRisk,
  FxExposureSummary,
  IrExposureSummary,
  LiquidityStressResult,
  RiskAlert,
  RiskAlertSeverity,
  RiskStatus
} from '@/types/risk/types';
import { divideDecimalStrings } from '@/utils/money';

function toSeverity(status: RiskStatus): RiskAlertSeverity {
  if (status === 'breached') {
    return 'critical';
  }
  if (status === 'warning') {
    return 'warning';
  }
  return 'info';
}

function summarizeLimitUsage(exposureAmount: string, limitAmount: string | null): string | null {
  if (!limitAmount) {
    return null;
  }

  return divideDecimalStrings(exposureAmount, limitAmount);
}

export class BreachDetectionService {
  private readonly db: SupabaseClient;
  private readonly calculationEngine: RiskCalculationEngine;
  private readonly queue: JobQueue;
  private readonly createRiskRepository: (organizationId: string) => RiskRepository;
  private readonly createAlertsRepository: (organizationId: string) => RiskAlertsRepository;

  constructor(options: {
    dbClient?: SupabaseClient;
    calculationEngine?: RiskCalculationEngine;
    queue?: JobQueue;
    riskRepositoryFactory?: (organizationId: string) => RiskRepository;
    alertsRepositoryFactory?: (organizationId: string) => RiskAlertsRepository;
  } = {}) {
    this.db = options.dbClient ?? createServiceSupabaseClient();
    this.calculationEngine = options.calculationEngine ?? new RiskCalculationEngine({ dbClient: this.db });
    this.queue = options.queue ?? new JobQueue(this.db);
    this.createRiskRepository =
      options.riskRepositoryFactory ?? ((organizationId) => new RiskRepository({ organizationId }, this.db, this.queue));
    this.createAlertsRepository =
      options.alertsRepositoryFactory ?? ((organizationId) => new RiskAlertsRepository({ organizationId }, this.db));
  }

  async checkAllBreaches(orgId: string): Promise<BreachSummary> {
    const [fx, interestRate, concentration, liquidity] = await Promise.all([
      this.calculationEngine.calculateFxExposure(orgId),
      this.calculationEngine.calculateInterestRateExposure(orgId),
      this.calculationEngine.calculateCounterpartyConcentration(orgId),
      this.calculationEngine.calculateLiquidityStress(orgId)
    ]);

    const items = [
      ...fx.map((item) => this.fromFxExposure(item)),
      this.fromInterestRateExposure(interestRate),
      ...concentration.map((item) => this.fromConcentrationRisk(item)),
      this.fromLiquidityStress(liquidity)
    ];

    const repository = this.createRiskRepository(orgId);
    await repository.replaceExposures(
      liquidity.valuationDate,
      items.map((item) => ({
        riskType: item.riskType,
        currencyCode: item.details.currencyCode as string | null,
        exposureAmount: item.exposureAmount,
        status: item.status,
        details: item.details
      }))
    );

    const alertsRepository = this.createAlertsRepository(orgId);

    for (const item of items) {
      if (item.status === 'normal') {
        const existing = await alertsRepository.findActiveAlert({
          riskType: item.riskType,
          title: item.title,
          relatedEntityId: item.relatedEntityId
        });

        if (existing) {
          await this.resolveAlert(orgId, existing.id, null, `Auto-resolved after ${item.riskType} returned within policy.`);
        }
        continue;
      }

      const existing = await alertsRepository.findActiveAlert({
        riskType: item.riskType,
        title: item.title,
        relatedEntityId: item.relatedEntityId
      });

      if (existing) {
        await alertsRepository.refreshAlert(existing.id, {
          severity: item.severity,
          title: item.title,
          message: item.message,
          resolutionNote: existing.status === 'acknowledged' ? existing.resolution_note : null
        });
        continue;
      }

      await this.createAlert(orgId, item.riskType, item.severity, item.message, item.relatedEntityId, item.title, item.details.relatedEntityType as string | null | undefined);
    }

    return {
      breached: items.filter((item) => item.status === 'breached'),
      warning: items.filter((item) => item.status === 'warning'),
      normal: items.filter((item) => item.status === 'normal')
    };
  }

  async createAlert(
    orgId: string,
    riskType: string,
    severity: RiskAlertSeverity,
    message: string,
    relatedEntityId?: string | null,
    title?: string,
    relatedEntityType?: string | null
  ): Promise<RiskAlert> {
    const alertsRepository = this.createAlertsRepository(orgId);
    const alert = await alertsRepository.createAlert({
      riskType,
      severity,
      title: title ?? `${riskType} alert`,
      message,
      relatedEntityId: relatedEntityId ?? null,
      relatedEntityType: relatedEntityType ?? null
    });

    await this.queue.enqueue(
      'notifications.risk-alert',
      {
        id: alert.id,
        riskType,
        severity,
        title: alert.title,
        message: alert.message,
        relatedEntityType: alert.related_entity_type,
        relatedEntityId: alert.related_entity_id
      },
      {
        organizationId: orgId,
        maxAttempts: 3
      }
    );

    return alert;
  }

  async resolveAlert(orgId: string, alertId: string, resolvedBy: string | null, note: string): Promise<RiskAlert> {
    const repository = this.createAlertsRepository(orgId);
    const updated = await repository.updateAlertStatus(alertId, 'resolved', resolvedBy ?? undefined, note);
    if (!updated) {
      throw new NotFoundError('Risk alert not found');
    }

    return updated;
  }

  private fromFxExposure(item: FxExposureSummary): BreachItem {
    const title = `FX ${item.currencyPair} exposure`;
    const limitSuffix = item.limitAmount ? ` against limit ${item.limitAmount} ${item.baseCurrency}` : '';
    return {
      riskType: 'fx',
      severity: toSeverity(item.status),
      title,
      message: `Unhedged ${item.currencyPair} exposure is ${item.unhedgedAmount} ${item.baseCurrency}${limitSuffix}.`,
      relatedEntityType: 'currency_pair',
      relatedEntityId: null,
      status: item.status,
      exposureAmount: item.unhedgedAmount,
      limitAmount: item.limitAmount,
      details: {
        title,
        currencyPair: item.currencyPair,
        currencyCode: item.foreignCurrency,
        coverageRatio: item.hedgeCoverageRatio,
        limitAmount: item.limitAmount,
        relatedEntityType: 'currency_pair',
        grossExposureAmount: item.grossExposureAmount,
        netExposureAmount: item.netExposureAmount,
        hedgedAmount: item.hedgedAmount,
        unhedgedAmount: item.unhedgedAmount,
        fxRate: item.fxRate,
        minimumCoverageRatio: item.minimumCoverageRatio,
        warningThresholdRatio: item.warningThresholdRatio,
        valuationDate: item.valuationDate
      }
    };
  }

  private fromInterestRateExposure(item: IrExposureSummary): BreachItem {
    const title = 'Interest rate sensitivity';
    return {
      riskType: 'interest_rate',
      severity: toSeverity(item.status),
      title,
      message: `Net floating-rate exposure is ${item.netFloatingRateExposure} ${item.baseCurrency}.`,
      relatedEntityType: 'interest_rate',
      relatedEntityId: null,
      status: item.status,
      exposureAmount: item.netFloatingRateExposure,
      limitAmount: item.limitAmount,
      details: {
        title,
        currencyCode: item.baseCurrency,
        coverageRatio: summarizeLimitUsage(item.netFloatingRateExposure, item.limitAmount),
        limitAmount: item.limitAmount,
        relatedEntityType: 'interest_rate',
        floatingDebtAmount: item.floatingDebtAmount,
        floatingInvestmentAmount: item.floatingInvestmentAmount,
        shockScenarios: item.shockScenarios,
        warningThresholdRatio: item.warningThresholdRatio,
        valuationDate: item.valuationDate
      }
    };
  }

  private fromConcentrationRisk(item: ConcentrationRisk): BreachItem {
    const title = `Counterparty ${item.counterpartyName} concentration`;
    return {
      riskType: 'credit',
      severity: toSeverity(item.status),
      title,
      message: `${item.counterpartyName} concentration is ${item.concentrationRatio} of total exposure.`,
      relatedEntityType: 'counterparty',
      relatedEntityId: item.counterpartyId,
      status: item.status,
      exposureAmount: item.exposureAmount,
      limitAmount: item.limitRatio,
      details: {
        title,
        currencyCode: item.baseCurrency,
        coverageRatio: item.concentrationRatio,
        limitAmount: item.limitRatio,
        relatedEntityType: 'counterparty',
        relatedEntityId: item.counterpartyId,
        counterpartyName: item.counterpartyName,
        totalExposureAmount: item.totalExposureAmount,
        warningThresholdRatio: item.warningThresholdRatio,
        valuationDate: item.valuationDate
      }
    };
  }

  private fromLiquidityStress(item: LiquidityStressResult): BreachItem {
    const title = 'Liquidity stress buffer';
    return {
      riskType: 'liquidity',
      severity: toSeverity(item.status),
      title,
      message: `Stressed minimum cash buffer is ${item.stressedMinimumCashBuffer} ${item.baseCurrency}.`,
      relatedEntityType: 'forecast_window',
      relatedEntityId: null,
      status: item.status,
      exposureAmount: item.stressedMinimumCashBuffer,
      limitAmount: item.minimumPolicyBuffer,
      details: {
        title,
        currencyCode: item.baseCurrency,
        coverageRatio: item.minimumPolicyBuffer
          ? divideDecimalStrings(item.stressedMinimumCashBuffer, item.minimumPolicyBuffer)
          : null,
        limitAmount: item.minimumPolicyBuffer,
        relatedEntityType: 'forecast_window',
        currentCashBuffer: item.currentCashBuffer,
        baselineMinimumCashBuffer: item.baselineMinimumCashBuffer,
        stressedMinimumCashBuffer: item.stressedMinimumCashBuffer,
        inflowStressRatio: item.inflowStressRatio,
        outflowStressRatio: item.outflowStressRatio,
        forecastWindowDays: item.forecastWindowDays,
        valuationDate: item.valuationDate
      }
    };
  }
}
