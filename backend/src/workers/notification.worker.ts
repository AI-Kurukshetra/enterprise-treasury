import { JobWorker } from '@/lib/job-queue/job-worker';
import type { Job } from '@/lib/job-queue/job-queue';
import { logger } from '@/lib/logger';
import { NotificationsRepository } from '@/repositories/notifications/repository';

interface NotificationDeliveryPayload {
  organizationId: string;
  notificationIds: string[];
  webhookUrl?: string | null;
}

interface NotificationCleanupPayload {
  organizationId: string;
  retentionDays?: number;
}

export class NotificationEmailWorker extends JobWorker<NotificationDeliveryPayload> {
  readonly type = 'notifications.email';
  readonly maxAttempts = 3;

  override async handle(payload: NotificationDeliveryPayload, job: Job<NotificationDeliveryPayload>): Promise<void> {
    logger.log({
      level: 'info',
      message: 'Queued notification email delivery',
      domain: 'notification_worker',
      eventType: 'notifications.email',
      organizationId: payload.organizationId,
      data: {
        jobId: job.id,
        notificationIds: payload.notificationIds
      }
    });
  }
}

export class NotificationWebhookWorker extends JobWorker<NotificationDeliveryPayload> {
  readonly type = 'notifications.webhook';
  readonly maxAttempts = 3;

  override async handle(payload: NotificationDeliveryPayload, job: Job<NotificationDeliveryPayload>): Promise<void> {
    logger.log({
      level: 'info',
      message: 'Queued notification webhook delivery',
      domain: 'notification_worker',
      eventType: 'notifications.webhook',
      organizationId: payload.organizationId,
      data: {
        jobId: job.id,
        notificationIds: payload.notificationIds,
        webhookUrl: payload.webhookUrl
      }
    });
  }
}

export class NotificationCleanupWorker extends JobWorker<NotificationCleanupPayload> {
  readonly type = 'notifications.cleanup';
  readonly maxAttempts = 2;

  private readonly repository: NotificationsRepository;

  constructor(repository?: NotificationsRepository) {
    super();
    this.repository = repository ?? new NotificationsRepository();
  }

  override async handle(payload: NotificationCleanupPayload, job: Job<NotificationCleanupPayload>): Promise<void> {
    const retentionDays = Math.max(1, payload.retentionDays ?? 90);
    const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
    const affected = await this.repository.softDeleteOlderThan(payload.organizationId, cutoff);

    logger.log({
      level: 'info',
      message: 'Notification retention cleanup completed',
      domain: 'notification_worker',
      eventType: 'notifications.cleanup',
      organizationId: payload.organizationId,
      data: {
        jobId: job.id,
        retentionDays,
        affected
      }
    });
  }
}
