import type { PaginatedResult, UUID } from '@/types/common';
import type { Payment } from '@/types/payments/types';
import type { Forecast } from '@/types/forecasts/types';

export const NOTIFICATION_SEVERITIES = ['info', 'success', 'warning', 'error'] as const;

export type NotificationSeverity = (typeof NOTIFICATION_SEVERITIES)[number];

export interface Notification {
  id: UUID;
  organization_id: UUID;
  user_id: UUID | null;
  type: string;
  severity: NotificationSeverity;
  title: string;
  body: string;
  action_url: string | null;
  action_label: string | null;
  related_entity_type: string | null;
  related_entity_id: UUID | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface NotificationListFilters {
  isRead?: boolean;
  limit?: number;
  cursor?: string;
}

export interface CreateNotificationInput {
  organizationId: UUID;
  userId?: UUID | null;
  type: string;
  severity?: NotificationSeverity;
  title: string;
  body: string;
  actionUrl?: string | null;
  actionLabel?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: UUID | null;
  createdBy?: UUID | null;
}

export type NotificationListResult = PaginatedResult<Notification>;

export interface NotifyInput {
  type: string;
  severity?: NotificationSeverity;
  title: string;
  body: string;
  actionUrl?: string | null;
  actionLabel?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: UUID | null;
  emailEnabled?: boolean;
  webhookUrl?: string | null;
}

export interface ImportCompletedNotificationInput {
  id: UUID;
  organizationId: UUID;
  status: string;
  sourceFilename: string | null;
  totalRows: number;
  processedRows: number;
  failedRows: number;
}

export interface RiskNotificationExposure {
  id?: UUID | null;
  riskType: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  relatedEntityType?: string | null;
  relatedEntityId?: UUID | null;
}

export interface NotificationReadResponse {
  notificationId: UUID;
  read: boolean;
}

export interface NotificationCountResponse {
  unread: number;
}

export interface NotificationMarkAllReadResponse {
  updated: number;
}

export interface NotificationTemplateService {
  paymentApprovalRequired(payment: Payment, approverUserId: UUID): Promise<Notification>;
  paymentApproved(payment: Payment, initiatorUserId: UUID): Promise<Notification>;
  paymentRejected(payment: Payment, initiatorUserId: UUID, reason: string): Promise<Notification>;
  paymentExecuted(payment: Payment): Promise<Notification[]>;
  riskBreachDetected(exposure: RiskNotificationExposure, affectedUsers: UUID[]): Promise<Notification[]>;
  importCompleted(importJob: ImportCompletedNotificationInput, userId: UUID): Promise<Notification>;
  forecastPublished(forecast: Forecast, orgId: UUID): Promise<Notification[]>;
}
