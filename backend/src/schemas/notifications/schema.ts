import { z } from 'zod';

export const NotificationSeveritySchema = z.enum(['info', 'success', 'warning', 'error']);

export const NotificationSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  user_id: z.string().uuid().nullable(),
  type: z.string(),
  severity: NotificationSeveritySchema,
  title: z.string(),
  body: z.string(),
  action_url: z.string().nullable(),
  action_label: z.string().nullable(),
  related_entity_type: z.string().nullable(),
  related_entity_id: z.string().uuid().nullable(),
  is_read: z.boolean(),
  read_at: z.string().nullable(),
  created_at: z.string()
});

export const NotificationReadSchema = z.object({
  notificationId: z.string().uuid(),
  read: z.boolean()
});

export const NotificationCountSchema = z.object({
  unread: z.number().int().nonnegative()
});

export const NotificationMarkAllReadSchema = z.object({
  updated: z.number().int().nonnegative()
});

export const ListNotificationsQuerySchema = z.object({
  isRead: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export const NotificationListResponseSchema = z.object({
  items: z.array(NotificationSchema),
  nextCursor: z.string().nullable()
});
