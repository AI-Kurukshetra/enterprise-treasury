import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '@/errors/NotFoundError';
import { NotificationsService } from '@/services/notifications/service';

describe('NotificationsService', () => {
  it('fans out org notifications to active users and enqueues follow-up jobs', async () => {
    const createBulk = vi.fn().mockResolvedValue([
      {
        id: 'notification-1'
      },
      {
        id: 'notification-2'
      }
    ]);
    const listOrganizationUserIds = vi.fn().mockResolvedValue(['user-2', 'user-3']);
    const enqueue = vi.fn().mockResolvedValue('job-1');
    const listJobs = vi.fn().mockResolvedValue([]);

    const service = new NotificationsService(
      {
        organizationId: 'org-1',
        userId: '3e2ad7fe-1be8-4f2c-a2c6-2e921dd0d147',
        requestId: 'req-1'
      },
      {
        createBulk,
        listOrganizationUserIds
      } as never,
      {
        enqueue,
        listJobs
      } as never
    );

    await service.notifyOrg('org-1', {
      type: 'system.forecast_published',
      title: 'Forecast published',
      body: 'Cash outlook is ready.',
      emailEnabled: true
    });

    expect(listOrganizationUserIds).toHaveBeenCalledWith('org-1');
    expect(createBulk).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ organizationId: 'org-1', userId: 'user-2' }),
        expect.objectContaining({ organizationId: 'org-1', userId: 'user-3' })
      ])
    );
    expect(enqueue).toHaveBeenCalledWith(
      'notifications.email',
      expect.objectContaining({
        organizationId: 'org-1',
        notificationIds: ['notification-1', 'notification-2']
      }),
      expect.objectContaining({ organizationId: 'org-1' })
    );
    expect(enqueue).toHaveBeenCalledWith(
      'notifications.cleanup',
      expect.objectContaining({ organizationId: 'org-1', retentionDays: 90 }),
      expect.objectContaining({ organizationId: 'org-1' })
    );
  });

  it('throws when marking a missing notification as read', async () => {
    const service = new NotificationsService(
      {
        organizationId: 'org-1',
        userId: 'user-1',
        requestId: 'req-1'
      },
      {
        markRead: vi.fn().mockResolvedValue(false)
      } as never,
      {
        listJobs: vi.fn().mockResolvedValue([]),
        enqueue: vi.fn()
      } as never
    );

    await expect(service.markRead('notification-1')).rejects.toBeInstanceOf(NotFoundError);
  });
});
