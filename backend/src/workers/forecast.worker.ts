import { JobWorker } from '@/lib/job-queue/job-worker';
import type { Job } from '@/lib/job-queue/job-queue';
import { ForecastEngine } from '@/services/forecasts/forecast-engine';
import type { CreateForecastInput } from '@/types/forecasts/types';

export interface ForecastWorkerPayload {
  organizationId: string;
  forecastId: string;
  input: CreateForecastInput;
  requestedByUserId: string;
}

export class ForecastWorker extends JobWorker<ForecastWorkerPayload> {
  readonly type = 'forecast.generate';
  readonly maxAttempts = 3;

  override async handle(payload: ForecastWorkerPayload, _job: Job<ForecastWorkerPayload>): Promise<void> {
    const engine = new ForecastEngine({
      organizationId: payload.organizationId,
      userId: payload.requestedByUserId,
      requestId: `job:${payload.forecastId}`
    });

    await engine.generateForecast(payload.organizationId, payload.input, {
      forecastId: payload.forecastId,
      requestedByUserId: payload.requestedByUserId
    });
  }
}
