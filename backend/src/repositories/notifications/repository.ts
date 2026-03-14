import type { SupabaseClient } from '@supabase/supabase-js';
import { assertNoQueryError } from '@/repositories/base/execute';
import { applyCursorPagination } from '@/repositories/base/query';
import { createServiceSupabaseClient } from '@/lib/supabase';
import { isMissingColumnError } from '@/utils/database';
import { resolveLimit, toNextCursor } from '@/utils/pagination';
import type {
  CreateNotificationInput,
  Notification,
  NotificationListFilters,
  NotificationListResult
} from '@/types/notifications/types';

interface NotificationRow {
  id: string;
  organization_id: string;
  user_id: string | null;
  type: string;
  severity: Notification['severity'];
  title: string;
  body: string;
  action_url: string | null;
  action_label: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export class NotificationsRepository {
  private readonly db: SupabaseClient;

  constructor(dbClient?: SupabaseClient) {
    this.db = dbClient ?? createServiceSupabaseClient();
  }

  async list(userId: string, orgId: string, filters: NotificationListFilters = {}): Promise<NotificationListResult> {
    let query = this.db
      .from('notifications')
      .select(
        'id,organization_id,user_id,type,severity,title,body,action_url,action_label,related_entity_type,related_entity_id,is_read,read_at,created_at'
      )
      .eq('organization_id', orgId)
      .or(`user_id.eq.${userId},user_id.is.null`);

    if (filters.isRead !== undefined) {
      query = query.eq('is_read', filters.isRead);
    }

    let paged = applyCursorPagination(query.is('deleted_at', null), filters, { cursorColumn: 'created_at' });
    let { data, error } = await paged;

    if (error && isMissingColumnError(error, 'deleted_at')) {
      paged = applyCursorPagination(query, filters, { cursorColumn: 'created_at' });
      ({ data, error } = await paged);
    }

    assertNoQueryError(error);

    const limit = resolveLimit(filters);
    const rows = (data ?? []) as NotificationRow[];
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && items.length > 0 ? toNextCursor(items[items.length - 1]?.created_at) : null;

    return {
      items: items.map((row) => this.toNotification(row)),
      nextCursor
    };
  }

  async markRead(userId: string, notificationId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
        updated_by: userId
      })
      .eq('id', notificationId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();

    assertNoQueryError(error);
    return Boolean(data);
  }

  async markUnread(userId: string, notificationId: string): Promise<boolean> {
    const { data, error } = await this.db
      .from('notifications')
      .update({
        is_read: false,
        read_at: null,
        updated_by: userId
      })
      .eq('id', notificationId)
      .eq('user_id', userId)
      .is('deleted_at', null)
      .select('id')
      .maybeSingle();

    assertNoQueryError(error);
    return Boolean(data);
  }

  async markAllRead(userId: string, orgId: string): Promise<number> {
    const { data, error } = await this.db
      .from('notifications')
      .update({
        is_read: true,
        read_at: new Date().toISOString(),
        updated_by: userId
      })
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .eq('is_read', false)
      .is('deleted_at', null)
      .select('id');

    assertNoQueryError(error);
    return (data ?? []).length;
  }

  async create(input: CreateNotificationInput): Promise<Notification> {
    const { data, error } = await this.db
      .from('notifications')
      .insert(this.toInsertPayload(input))
      .select(
        'id,organization_id,user_id,type,severity,title,body,action_url,action_label,related_entity_type,related_entity_id,is_read,read_at,created_at'
      )
      .single();

    assertNoQueryError(error);
    return this.toNotification(data as NotificationRow);
  }

  async createBulk(inputs: CreateNotificationInput[]): Promise<Notification[]> {
    if (inputs.length === 0) {
      return [];
    }

    const { data, error } = await this.db
      .from('notifications')
      .insert(inputs.map((input) => this.toInsertPayload(input)))
      .select(
        'id,organization_id,user_id,type,severity,title,body,action_url,action_label,related_entity_type,related_entity_id,is_read,read_at,created_at'
      );

    assertNoQueryError(error);
    return ((data ?? []) as NotificationRow[]).map((row) => this.toNotification(row));
  }

  async getUnreadCount(userId: string, orgId: string): Promise<number> {
    const { count, error } = await this.db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .eq('is_read', false)
      .is('deleted_at', null);

    assertNoQueryError(error);
    return count ?? 0;
  }

  async listOrganizationUserIds(orgId: string): Promise<string[]> {
    const { data, error } = await this.db
      .from('organization_memberships')
      .select('user_id')
      .eq('organization_id', orgId)
      .eq('status', 'active');

    assertNoQueryError(error);
    return Array.from(
      new Set(
        ((data ?? []) as Array<{ user_id: string }>).map((row) => row.user_id).filter((value): value is string => Boolean(value))
      )
    );
  }

  async softDeleteOlderThan(orgId: string, cutoffIso: string): Promise<number> {
    const { data, error } = await this.db
      .from('notifications')
      .update({
        deleted_at: new Date().toISOString()
      })
      .eq('organization_id', orgId)
      .is('deleted_at', null)
      .lt('created_at', cutoffIso)
      .select('id');

    assertNoQueryError(error);
    return (data ?? []).length;
  }

  private toInsertPayload(input: CreateNotificationInput) {
    return {
      organization_id: input.organizationId,
      user_id: input.userId ?? null,
      type: input.type,
      severity: input.severity ?? 'info',
      title: input.title,
      body: input.body,
      action_url: input.actionUrl ?? null,
      action_label: input.actionLabel ?? null,
      related_entity_type: input.relatedEntityType ?? null,
      related_entity_id: input.relatedEntityId ?? null,
      created_by: input.createdBy ?? null,
      updated_by: input.createdBy ?? null
    };
  }

  private toNotification(row: NotificationRow): Notification {
    return {
      id: row.id,
      organization_id: row.organization_id,
      user_id: row.user_id,
      type: row.type,
      severity: row.severity,
      title: row.title,
      body: row.body,
      action_url: row.action_url,
      action_label: row.action_label,
      related_entity_type: row.related_entity_type,
      related_entity_id: row.related_entity_id,
      is_read: row.is_read,
      read_at: row.read_at,
      created_at: row.created_at
    };
  }
}
