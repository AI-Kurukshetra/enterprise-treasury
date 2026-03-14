import { ValidationError } from '@/errors/ValidationError';
import { RiskAlertsRepository, type RiskAlertFilters } from '@/repositories/risk/alerts-repository';
import { RiskRepository, type RiskExposureFilters } from '@/repositories/risk/repository';
import { FxRepository } from '@/repositories/fx/repository';
import { BreachDetectionService } from '@/services/risk/breach-detection-service';
import type { ServiceContext } from '@/services/context';
import type {
  ConcentrationRisk,
  FxExposureSummary,
  IrExposureSummary,
  LiquidityStressResult,
  RiskAlert,
  RiskExposureMatrixRow,
  RiskExposureSnapshot
} from '@/types/risk/types';
import { coerceDecimalString, coerceString } from '@/utils/database';
import { sumDecimalStrings } from '@/utils/money';

function toMatrixRow(details: Record<string, unknown>, riskType: RiskExposureMatrixRow['riskType'], exposureAmount: string, status: RiskExposureMatrixRow['status']): RiskExposureMatrixRow {
  return {
    riskType,
    title: typeof details.title === 'string' ? details.title : riskType,
    exposureAmount,
    limitAmount: coerceString(details.limitAmount),
    coverageRatio: coerceString(details.coverageRatio),
    status,
    details
  };
}

export class RiskService {
  private readonly context: ServiceContext;
  private readonly repository: RiskRepository;
  private readonly alertsRepository: RiskAlertsRepository;
  private readonly fxRepository: FxRepository;
  private readonly breachDetectionService: BreachDetectionService;

  constructor(
    context: ServiceContext,
    repository?: RiskRepository,
    alertsRepository?: RiskAlertsRepository,
    breachDetectionService?: BreachDetectionService,
    fxRepository?: FxRepository
  ) {
    this.context = context;
    this.repository = repository ?? new RiskRepository({ organizationId: context.organizationId });
    this.alertsRepository = alertsRepository ?? new RiskAlertsRepository({ organizationId: context.organizationId });
    this.fxRepository = fxRepository ?? new FxRepository({ organizationId: context.organizationId });
    this.breachDetectionService = breachDetectionService ?? new BreachDetectionService();
  }

  async listExposures(filters: RiskExposureFilters = {}): Promise<RiskExposureSnapshot> {
    const [baseCurrency, valuationDate, lastCalculatedAt, exposures] = await Promise.all([
      this.fxRepository.getOrganizationBaseCurrency(this.context.organizationId),
      this.repository.getLatestReferenceDate(),
      this.repository.getLastCalculatedAt(),
      this.repository.listLatestExposures(filters)
    ]);

    const matrix: RiskExposureMatrixRow[] = [];
    const fx: FxExposureSummary[] = [];
    const concentration: ConcentrationRisk[] = [];
    let interestRate: IrExposureSummary | null = null;
    let liquidity: LiquidityStressResult | null = null;

    for (const exposure of exposures) {
      const details = (exposure.details ?? {}) as Record<string, unknown>;
      const exposureAmount = coerceDecimalString(exposure.exposure_amount);
      matrix.push(toMatrixRow(details, exposure.risk_type, exposureAmount, exposure.status));

      if (exposure.risk_type === 'fx') {
        fx.push({
          riskType: 'fx',
          currencyPair: String(details.currencyPair ?? details.title ?? exposure.currency_code ?? 'UNK'),
          foreignCurrency: String(details.currencyCode ?? exposure.currency_code ?? 'UNK'),
          baseCurrency: String(baseCurrency ?? 'USD'),
          valuationDate: String(details.valuationDate ?? exposure.reference_date),
          grossExposureAmount: coerceDecimalString(details.grossExposureAmount, exposureAmount),
          netExposureAmount: coerceDecimalString(details.netExposureAmount, exposureAmount),
          hedgedAmount: String(details.hedgedAmount ?? '0.000000'),
          unhedgedAmount: coerceDecimalString(details.unhedgedAmount, exposureAmount),
          hedgeCoverageRatio: String(details.coverageRatio ?? '0.000000'),
          limitAmount: coerceString(details.limitAmount),
          minimumCoverageRatio: coerceString(details.minimumCoverageRatio),
          warningThresholdRatio: String(details.warningThresholdRatio ?? '0.800000'),
          status: exposure.status,
          fxRate: String(details.fxRate ?? '1.000000')
        });
        continue;
      }

      if (exposure.risk_type === 'interest_rate') {
        interestRate = {
          riskType: 'interest_rate',
          valuationDate: String(details.valuationDate ?? exposure.reference_date),
          baseCurrency: String(baseCurrency ?? 'USD'),
          floatingDebtAmount: String(details.floatingDebtAmount ?? '0.000000'),
          floatingInvestmentAmount: String(details.floatingInvestmentAmount ?? '0.000000'),
          netFloatingRateExposure: exposureAmount,
          limitAmount: coerceString(details.limitAmount),
          warningThresholdRatio: String(details.warningThresholdRatio ?? '0.800000'),
          shockScenarios: Array.isArray(details.shockScenarios) ? (details.shockScenarios as IrExposureSummary['shockScenarios']) : [],
          status: exposure.status
        };
        continue;
      }

      if (exposure.risk_type === 'credit') {
        concentration.push({
          riskType: 'credit',
          counterpartyId: typeof details.relatedEntityId === 'string' ? details.relatedEntityId : null,
          counterpartyName: String(details.counterpartyName ?? details.title ?? 'Counterparty'),
          valuationDate: String(details.valuationDate ?? exposure.reference_date),
          baseCurrency: String(baseCurrency ?? 'USD'),
          exposureAmount,
          totalExposureAmount: coerceDecimalString(details.totalExposureAmount, exposureAmount),
          concentrationRatio: String(details.coverageRatio ?? '0.000000'),
          limitRatio: String(details.limitAmount ?? '0.250000'),
          warningThresholdRatio: String(details.warningThresholdRatio ?? '0.800000'),
          status: exposure.status
        });
        continue;
      }

      liquidity = {
        riskType: 'liquidity',
        valuationDate: String(details.valuationDate ?? exposure.reference_date),
        baseCurrency: String(baseCurrency ?? 'USD'),
        currentCashBuffer: String(details.currentCashBuffer ?? '0.000000'),
        baselineMinimumCashBuffer: String(details.baselineMinimumCashBuffer ?? '0.000000'),
        stressedMinimumCashBuffer: exposureAmount,
        minimumPolicyBuffer: coerceString(details.limitAmount),
        inflowStressRatio: String(details.inflowStressRatio ?? '0.200000'),
        outflowStressRatio: String(details.outflowStressRatio ?? '0.200000'),
        forecastWindowDays: Number(details.forecastWindowDays ?? 30),
        status: exposure.status
      };
    }

    const summary = {
      breached: exposures.filter((item) => item.status === 'breached').length,
      warning: exposures.filter((item) => item.status === 'warning').length,
      normal: exposures.filter((item) => item.status === 'normal').length
    };

    return {
      baseCurrency: baseCurrency ?? 'USD',
      valuationDate,
      lastCalculatedAt,
      summary,
      matrix,
      fx,
      interestRate,
      concentration,
      liquidity
    };
  }

  listAlerts(filters: RiskAlertFilters = {}): Promise<RiskAlert[]> {
    return this.alertsRepository.listAlerts(filters);
  }

  async acknowledgeAlert(alertId: string, note: string): Promise<RiskAlert> {
    if (!note.trim()) {
      throw new ValidationError('Acknowledging a risk alert requires a reason');
    }

    const updated = await this.alertsRepository.updateAlertStatus(alertId, 'acknowledged', undefined, note.trim());
    if (!updated) {
      throw new ValidationError('Risk alert not found', { alertId });
    }

    return updated;
  }

  resolveAlert(alertId: string, note: string): Promise<RiskAlert> {
    if (!note.trim()) {
      throw new ValidationError('Resolving a risk alert requires a note');
    }

    return this.breachDetectionService.resolveAlert(this.context.organizationId, alertId, this.context.userId, note.trim());
  }

  recalculate(referenceDate = new Date().toISOString().slice(0, 10)) {
    return this.repository.queueRecalculation(referenceDate);
  }

  async getFxExposureSummary() {
    const snapshot = await this.listExposures({ riskType: 'fx' });
    const total = sumDecimalStrings(snapshot.fx.map((item) => item.unhedgedAmount));

    return {
      totalExposure: total,
      currencyBreakdown: snapshot.fx.map((item) => ({
        currencyCode: item.foreignCurrency,
        exposureAmount: item.unhedgedAmount,
        status: item.status
      }))
    };
  }
}
