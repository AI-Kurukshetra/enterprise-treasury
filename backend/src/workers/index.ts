import { defaultWorkerRegistry } from '@/lib/job-queue/worker-registry';
import { BankSyncWorker } from '@/workers/bank-sync.worker';
import { CashPositionWorker } from '@/workers/cash-position.worker';
import { ForecastWorker } from '@/workers/forecast.worker';
import {
  NotificationCleanupWorker,
  NotificationEmailWorker,
  NotificationWebhookWorker
} from '@/workers/notification.worker';
import { ReportWorker } from '@/workers/report.worker';
import { RiskCalculationWorker } from '@/workers/risk-calculation.worker';

let workersRegistered = false;

export function registerDefaultWorkers() {
  if (workersRegistered) {
    return defaultWorkerRegistry;
  }

  defaultWorkerRegistry.registerWorker(new BankSyncWorker());
  defaultWorkerRegistry.registerWorker(new CashPositionWorker());
  defaultWorkerRegistry.registerWorker(new ForecastWorker());
  defaultWorkerRegistry.registerWorker(new NotificationEmailWorker());
  defaultWorkerRegistry.registerWorker(new NotificationWebhookWorker());
  defaultWorkerRegistry.registerWorker(new NotificationCleanupWorker());
  defaultWorkerRegistry.registerWorker(new ReportWorker());
  defaultWorkerRegistry.registerWorker(new RiskCalculationWorker());
  workersRegistered = true;

  return defaultWorkerRegistry;
}
