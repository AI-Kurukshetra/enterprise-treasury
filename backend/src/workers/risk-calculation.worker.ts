import { JobWorker } from '@/lib/job-queue/job-worker';
import { BreachDetectionService } from '@/services/risk/breach-detection-service';
import { RiskCalculationEngine } from '@/services/risk/calculation-engine';
import type { Job } from '@/types/jobs/types';

interface RiskRecalculationPayload {
  referenceDate?: string;
}

const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

export class RiskCalculationWorker extends JobWorker<RiskRecalculationPayload> {
  readonly type = 'risk.recalculate';
  readonly maxAttempts = 3;

  private readonly calculationEngine: RiskCalculationEngine;
  private readonly breachDetectionService: BreachDetectionService;

  constructor(options: { calculationEngine?: RiskCalculationEngine; breachDetectionService?: BreachDetectionService } = {}) {
    super();
    this.calculationEngine = options.calculationEngine ?? new RiskCalculationEngine();
    this.breachDetectionService = options.breachDetectionService ?? new BreachDetectionService();
  }

  override async handle(_payload: RiskRecalculationPayload, job: Job<RiskRecalculationPayload>): Promise<void> {
    if (!job.organizationId) {
      return;
    }

    await Promise.all([
      this.calculationEngine.calculateFxExposure(job.organizationId),
      this.calculationEngine.calculateInterestRateExposure(job.organizationId),
      this.calculationEngine.calculateCounterpartyConcentration(job.organizationId),
      this.calculationEngine.calculateLiquidityStress(job.organizationId)
    ]);

    await this.breachDetectionService.checkAllBreaches(job.organizationId);
    await this.scheduleNextRun(job.organizationId);
  }

  private async scheduleNextRun(organizationId: string): Promise<void> {
    const queuedJobs = await this.queue.listJobs<RiskRecalculationPayload>(organizationId, {
      type: this.type,
      status: 'queued',
      limit: 20
    });

    const now = Date.now();
    const hasFutureRun = queuedJobs.some((queuedJob) => new Date(queuedJob.scheduledFor).getTime() > now);
    if (hasFutureRun) {
      return;
    }

    await this.queue.enqueue(
      this.type,
      {},
      {
        organizationId,
        scheduledFor: new Date(now + SIX_HOURS_MS).toISOString(),
        maxAttempts: this.maxAttempts
      }
    );
  }
}
