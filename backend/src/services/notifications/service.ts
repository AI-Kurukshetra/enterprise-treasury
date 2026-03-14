import { NotFoundError } from '@/errors/NotFoundError';
import { getEnv } from '@/config/env';
import { JobQueue } from '@/lib/job-queue/job-queue';
import { NotificationsRepository } from '@/repositories/notifications/repository';
import type { ServiceContext } from '@/services/context';
import type { Forecast } from '@/types/forecasts/types';
import type {
  CreateNotificationInput,
  ImportCompletedNotificationInput,
  Notification,
  NotificationCountResponse,
  NotificationListFilters,
  NotificationListResult,
  NotificationMarkAllReadResponse,
  NotificationReadResponse,
  NotificationTemplateService,
  NotifyInput,
  RiskNotificationExposure
} from '@/types/notifications/types';
import type { Payment } from '@/types/payments/types';

interface NotificationDeliveryConfig {
  emailEnabled: boolean;
  webhookUrl: string | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface DeliveryPayload {
  organizationId: string;
  notificationIds: string[];
  webhookUrl?: string | null;
}

function baseNotificationPath(paymentId: string) {
  return `/payments?notification=${paymentId}`;
}

function resolvePaymentTitle(payment: Payment) {
  return payment.payment_reference || payment.id;
}

export class NotificationsService implements NotificationTemplateService {
  private readonly context: ServiceContext;
  private readonly repository: NotificationsRepository;
  private readonly queue: JobQueue;

  constructor(context: ServiceContext, repository?: NotificationsRepository, queue?: JobQueue) {
    this.context = context;
    this.repository = repository ?? new NotificationsRepository();
    this.queue = queue ?? new JobQueue();
  }

  list(filters: NotificationListFilters = {}): Promise<NotificationListResult> {
    return this.repository.list(this.context.userId, this.context.organizationId, filters);
  }

  async markRead(notificationId: string): Promise<NotificationReadResponse> {
    const updated = await this.repository.markRead(this.context.userId, notificationId);
    if (!updated) {
      throw new NotFoundError('Notification not found');
    }

    return {
      notificationId,
      read: true
    };
  }

  async markUnread(notificationId: string): Promise<NotificationReadResponse> {
    const updated = await this.repository.markUnread(this.context.userId, notificationId);
    if (!updated) {
      throw new NotFoundError('Notification not found');
    }

    return {
      notificationId,
      read: false
    };
  }

  async markAllRead(): Promise<NotificationMarkAllReadResponse> {
    return {
      updated: await this.repository.markAllRead(this.context.userId, this.context.organizationId)
    };
  }

  async getUnreadCount(): Promise<NotificationCountResponse> {
    return {
      unread: await this.repository.getUnreadCount(this.context.userId, this.context.organizationId)
    };
  }

  async notify(orgId: string, input: NotifyInput): Promise<Notification> {
    const notification = await this.repository.create({
      organizationId: orgId,
      userId: this.context.userId,
      type: input.type,
      severity: input.severity,
      title: input.title,
      body: input.body,
      actionUrl: input.actionUrl,
      actionLabel: input.actionLabel,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      createdBy: this.resolveCreatedBy()
    });

    await this.enqueueDeliveries(orgId, [notification.id], input);
    await this.scheduleCleanup(orgId);

    return notification;
  }

  async notifyUser(orgId: string, userId: string, input: NotifyInput): Promise<Notification> {
    const notification = await this.repository.create({
      organizationId: orgId,
      userId,
      type: input.type,
      severity: input.severity,
      title: input.title,
      body: input.body,
      actionUrl: input.actionUrl,
      actionLabel: input.actionLabel,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      createdBy: this.resolveCreatedBy()
    });

    await this.enqueueDeliveries(orgId, [notification.id], input);
    await this.scheduleCleanup(orgId);

    return notification;
  }

  async notifyOrg(orgId: string, input: NotifyInput): Promise<Notification[]> {
    const userIds = await this.repository.listOrganizationUserIds(orgId);
    const notifications = await this.repository.createBulk(
      userIds.map(
        (userId): CreateNotificationInput => ({
          organizationId: orgId,
          userId,
          type: input.type,
          severity: input.severity,
          title: input.title,
          body: input.body,
          actionUrl: input.actionUrl,
          actionLabel: input.actionLabel,
          relatedEntityType: input.relatedEntityType,
          relatedEntityId: input.relatedEntityId,
          createdBy: this.resolveCreatedBy()
        })
      )
    );

    await this.enqueueDeliveries(
      orgId,
      notifications.map((notification) => notification.id),
      input
    );
    await this.scheduleCleanup(orgId);

    return notifications;
  }

  paymentApprovalRequired(payment: Payment, approverUserId: string): Promise<Notification> {
    return this.notifyUser(payment.organization_id, approverUserId, {
      type: 'payment.approval_required',
      severity: 'warning',
      title: 'Payment approval required',
      body: `${resolvePaymentTitle(payment)} for ${payment.amount} ${payment.currency_code} is awaiting your approval.`,
      actionUrl: baseNotificationPath(payment.id),
      actionLabel: 'Review payment',
      relatedEntityType: 'payments',
      relatedEntityId: payment.id
    });
  }

  paymentApproved(payment: Payment, initiatorUserId: string): Promise<Notification> {
    return this.notifyUser(payment.organization_id, initiatorUserId, {
      type: 'payment.approved',
      severity: 'success',
      title: 'Payment approved',
      body: `${resolvePaymentTitle(payment)} was fully approved and is ready for bank execution.`,
      actionUrl: baseNotificationPath(payment.id),
      actionLabel: 'Open payment',
      relatedEntityType: 'payments',
      relatedEntityId: payment.id
    });
  }

  paymentRejected(payment: Payment, initiatorUserId: string, reason: string): Promise<Notification> {
    return this.notifyUser(payment.organization_id, initiatorUserId, {
      type: 'payment.rejected',
      severity: 'error',
      title: 'Payment rejected',
      body: `${resolvePaymentTitle(payment)} was rejected.${reason ? ` Reason: ${reason}` : ''}`,
      actionUrl: baseNotificationPath(payment.id),
      actionLabel: 'Review rejection',
      relatedEntityType: 'payments',
      relatedEntityId: payment.id
    });
  }

  paymentExecuted(payment: Payment): Promise<Notification[]> {
    return this.notifyOrg(payment.organization_id, {
      type: 'payment.executed',
      severity: 'success',
      title: 'Payment executed',
      body: `${resolvePaymentTitle(payment)} has been sent for settlement.`,
      actionUrl: baseNotificationPath(payment.id),
      actionLabel: 'Track payment',
      relatedEntityType: 'payments',
      relatedEntityId: payment.id
    });
  }

  async riskBreachDetected(exposure: RiskNotificationExposure, affectedUsers: string[]): Promise<Notification[]> {
    const users = Array.from(new Set(affectedUsers));

    const notifications = await this.repository.createBulk(
      users.map(
        (userId): CreateNotificationInput => ({
          organizationId: this.context.organizationId,
          userId,
          type: `risk.${exposure.riskType}.breach_detected`,
          severity: exposure.severity,
          title: exposure.title,
          body: exposure.message,
          actionUrl: '/risk-exposure',
          actionLabel: 'Review exposure',
          relatedEntityType: exposure.relatedEntityType ?? 'risk_exposures',
          relatedEntityId: exposure.relatedEntityId ?? exposure.id ?? null,
          createdBy: this.resolveCreatedBy()
        })
      )
    );

    await this.enqueueDeliveries(
      this.context.organizationId,
      notifications.map((notification) => notification.id),
      {
        type: `risk.${exposure.riskType}.breach_detected`,
        severity: exposure.severity,
        title: exposure.title,
        body: exposure.message,
        actionUrl: '/risk-exposure',
        actionLabel: 'Review exposure',
        relatedEntityType: exposure.relatedEntityType ?? 'risk_exposures',
        relatedEntityId: exposure.relatedEntityId ?? exposure.id ?? null
      }
    );
    await this.scheduleCleanup(this.context.organizationId);

    return notifications;
  }

  importCompleted(importJob: ImportCompletedNotificationInput, userId: string): Promise<Notification> {
    return this.notifyUser(importJob.organizationId, userId, {
      type: 'system.import_completed',
      severity: importJob.failedRows > 0 ? 'warning' : 'success',
      title: 'Statement import completed',
      body: `${importJob.sourceFilename ?? 'Import job'} finished with ${importJob.processedRows}/${importJob.totalRows} rows processed and ${importJob.failedRows} failed.`,
      actionUrl: '/transactions',
      actionLabel: 'Review import',
      relatedEntityType: 'bank_statement_import_jobs',
      relatedEntityId: importJob.id
    });
  }

  forecastPublished(forecast: Forecast, orgId: string): Promise<Notification[]> {
    return this.notifyOrg(orgId, {
      type: 'system.forecast_published',
      severity: 'info',
      title: 'Forecast published',
      body: `${forecast.name} was published for ${forecast.start_date} through ${forecast.end_date}.`,
      actionUrl: '/forecasts',
      actionLabel: 'View forecast',
      relatedEntityType: 'cash_flow_forecasts',
      relatedEntityId: forecast.id
    });
  }

  private async enqueueDeliveries(orgId: string, notificationIds: string[], input: NotifyInput): Promise<void> {
    if (notificationIds.length === 0) {
      return;
    }

    const config = this.resolveDeliveryConfig(input);
    const jobs: Promise<string>[] = [];

    if (config.emailEnabled) {
      jobs.push(
        this.queue.enqueue<DeliveryPayload>(
          'notifications.email',
          {
            organizationId: orgId,
            notificationIds
          },
          {
            organizationId: orgId,
            maxAttempts: 3
          }
        )
      );
    }

    if (config.webhookUrl) {
      jobs.push(
        this.queue.enqueue<DeliveryPayload>(
          'notifications.webhook',
          {
            organizationId: orgId,
            notificationIds,
            webhookUrl: config.webhookUrl
          },
          {
            organizationId: orgId,
            maxAttempts: 3
          }
        )
      );
    }

    if (jobs.length > 0) {
      await Promise.all(jobs);
    }
  }

  private resolveDeliveryConfig(input: NotifyInput): NotificationDeliveryConfig {
    const env = getEnv();
    return {
      emailEnabled: input.emailEnabled ?? env.NOTIFICATIONS_EMAIL_ENABLED,
      webhookUrl: input.webhookUrl ?? env.NOTIFICATIONS_WEBHOOK_URL ?? null
    };
  }

  private async scheduleCleanup(orgId: string): Promise<void> {
    const existingJobs = await this.queue.listJobs(orgId, {
      type: 'notifications.cleanup',
      limit: 10
    });

    const pendingCleanup = existingJobs.some((job) => ['queued', 'running', 'retrying'].includes(job.status));
    if (pendingCleanup) {
      return;
    }

    const scheduledFor = new Date(Date.now() + 60_000).toISOString();
    await this.queue.enqueue(
      'notifications.cleanup',
      {
        organizationId: orgId,
        retentionDays: 90
      },
      {
        organizationId: orgId,
        scheduledFor,
        maxAttempts: 2
      }
    );
  }

  private resolveCreatedBy(): string | null {
    return UUID_PATTERN.test(this.context.userId) ? this.context.userId : null;
  }
}
