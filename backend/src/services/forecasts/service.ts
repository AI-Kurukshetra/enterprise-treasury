import type { PaginationInput } from '@/types/common';
import { ConflictError } from '@/errors/ConflictError';
import { NotFoundError } from '@/errors/NotFoundError';
import { ValidationError } from '@/errors/ValidationError';
import { ForecastsRepository, type ForecastFilters } from '@/repositories/forecasts/repository';
import { IdempotencyRepository } from '@/repositories/payments/idempotencyRepository';
import { JobQueue } from '@/lib/job-queue/job-queue';
import { sha256 } from '@/utils/hash';
import type {
  CreateForecastInput,
  ForecastResult,
  GenerateForecastScenarioInput
} from '@/types/forecasts/types';
import type { ServiceContext } from '@/services/context';
import { ForecastAccuracyTracker } from '@/services/forecasts/forecast-accuracy-tracker';
import { ForecastEngine } from '@/services/forecasts/forecast-engine';
import { NotificationsService } from '@/services/notifications/service';

const FORECAST_CREATE_OPERATION = 'forecasts.create';
const FORECAST_SCENARIO_OPERATION = 'forecasts.scenario.generate';

function estimateGenerationTimeSeconds(horizon: number): number {
  if (horizon <= 30) {
    return 18;
  }
  if (horizon <= 90) {
    return 45;
  }
  return 70;
}

export class ForecastsService {
  private readonly repository: ForecastsRepository;
  private readonly engine: ForecastEngine;
  private readonly accuracyTracker: ForecastAccuracyTracker;
  private readonly queue: JobQueue;
  private readonly idempotencyRepository: IdempotencyRepository;
  private readonly notifications: NotificationsService;
  private readonly context: ServiceContext;

  constructor(
    context: ServiceContext,
    repository?: ForecastsRepository,
    engine?: ForecastEngine,
    accuracyTracker?: ForecastAccuracyTracker,
    queue?: JobQueue,
    idempotencyRepository?: IdempotencyRepository,
    notifications?: NotificationsService
  ) {
    this.context = context;
    this.repository = repository ?? new ForecastsRepository({ organizationId: context.organizationId });
    this.engine = engine ?? new ForecastEngine(context, { repository: this.repository });
    this.accuracyTracker =
      accuracyTracker ?? new ForecastAccuracyTracker(context, this.repository);
    this.queue = queue ?? new JobQueue();
    this.idempotencyRepository =
      idempotencyRepository ?? new IdempotencyRepository({ organizationId: context.organizationId });
    this.notifications = notifications ?? new NotificationsService(context);
  }

  list(filters: ForecastFilters, pagination: PaginationInput) {
    return this.repository.list(filters, pagination);
  }

  async create(input: CreateForecastInput, idempotencyKey: string): Promise<ForecastResult> {
    if (!idempotencyKey) {
      throw new ValidationError('Idempotency-Key header is required');
    }

    const requestHash = sha256(JSON.stringify(input));
    const existing = await this.idempotencyRepository.find(FORECAST_CREATE_OPERATION, idempotencyKey);

    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new ConflictError('Idempotency key was already used with a different request payload');
      }

      if (existing.status === 'completed' && existing.response_snapshot) {
        return existing.response_snapshot as unknown as ForecastResult;
      }

      throw new ConflictError('Forecast generation request is already being processed');
    }

    await this.idempotencyRepository.createInProgress(FORECAST_CREATE_OPERATION, idempotencyKey, requestHash);

    try {
      const result =
        input.horizon > 30 ? await this.enqueueForecastGeneration(input) : await this.engine.generateForecast(this.context.organizationId, input);

      await this.idempotencyRepository.markCompleted(FORECAST_CREATE_OPERATION, idempotencyKey, result as unknown as Record<string, unknown>);
      return result;
    } catch (error) {
      await this.idempotencyRepository.markFailed(
        FORECAST_CREATE_OPERATION,
        idempotencyKey,
        error instanceof Error ? error.message : 'Unknown forecast create failure'
      );
      throw error;
    }
  }

  async getById(forecastId: string) {
    const forecast = await this.repository.getDetail(forecastId);
    if (!forecast) {
      throw new NotFoundError('Forecast not found');
    }

    return forecast;
  }

  async generateScenario(forecastId: string, params: GenerateForecastScenarioInput, idempotencyKey: string): Promise<ForecastResult> {
    if (!idempotencyKey) {
      throw new ValidationError('Idempotency-Key header is required');
    }

    const requestHash = sha256(JSON.stringify({ forecastId, ...params }));
    const operation = `${FORECAST_SCENARIO_OPERATION}:${forecastId}`;
    const existing = await this.idempotencyRepository.find(operation, idempotencyKey);

    if (existing) {
      if (existing.request_hash !== requestHash) {
        throw new ConflictError('Idempotency key was already used with a different scenario payload');
      }

      if (existing.status === 'completed' && existing.response_snapshot) {
        return existing.response_snapshot as unknown as ForecastResult;
      }

      throw new ConflictError('Scenario generation request is already being processed');
    }

    await this.idempotencyRepository.createInProgress(operation, idempotencyKey, requestHash);

    try {
      const result = await this.engine.generateScenario(forecastId, params);
      await this.idempotencyRepository.markCompleted(operation, idempotencyKey, result as unknown as Record<string, unknown>);
      return result;
    } catch (error) {
      await this.idempotencyRepository.markFailed(
        operation,
        idempotencyKey,
        error instanceof Error ? error.message : 'Unknown scenario generation failure'
      );
      throw error;
    }
  }

  async publish(forecastId: string) {
    const forecast = await this.getById(forecastId);
    if (forecast.generation_status !== 'completed') {
      throw new ConflictError('Only completed forecasts can be published');
    }

    const published = await this.repository.updateForecast(forecastId, {
      status: 'published',
      published_at: new Date().toISOString(),
      published_by: this.context.userId
    });

    if (!published) {
      throw new NotFoundError('Forecast not found');
    }

    await this.notifications.forecastPublished(published, this.context.organizationId);

    return published;
  }

  async getAccuracyMetrics(orgId: string) {
    if (orgId !== this.context.organizationId) {
      throw new NotFoundError('Organization context mismatch for accuracy metrics');
    }

    const forecasts = await this.repository.list({ generationStatus: 'completed' }, { limit: 25 });
    const maturedWithoutAccuracy = forecasts.items.filter(
      (forecast) => forecast.accuracy_score === null && forecast.end_date < new Date().toISOString().slice(0, 10)
    );

    for (const forecast of maturedWithoutAccuracy) {
      await this.accuracyTracker.calculateForecastAccuracy(forecast.id);
    }

    return this.repository.listAccuracyMetrics();
  }

  private async enqueueForecastGeneration(input: CreateForecastInput): Promise<ForecastResult> {
    const estimatedTimeSeconds = estimateGenerationTimeSeconds(input.horizon);
    const startDate = new Date().toISOString().slice(0, 10);
    const endDate = new Date(Date.now() + (input.horizon - 1) * 86_400_000).toISOString().slice(0, 10);
    const placeholder = await this.repository.createGenerationRecord(input, this.context.userId, {
      startDate,
      endDate,
      name: input.scenarioName?.trim() || `${input.forecastType === 'short_term' ? 'Short-term' : 'Long-term'} ${input.horizon}-day forecast`,
      generationStatus: 'queued',
      estimatedTimeSeconds,
      scenarioName: input.scenarioName?.trim() || 'base',
      notes: input.notes,
      baseForecastId: null,
      scenarioParameters: {}
    });

    const jobId = await this.queue.enqueue(
      'forecast.generate',
      {
        organizationId: this.context.organizationId,
        forecastId: placeholder.id,
        input,
        requestedByUserId: this.context.userId
      },
      {
        organizationId: this.context.organizationId,
        maxAttempts: 3
      }
    );

    await this.repository.updateForecast(placeholder.id, {
      generation_job_id: jobId
    });

    return {
      forecastId: placeholder.id,
      status: 'queued',
      estimatedTimeSeconds
    };
  }
}
