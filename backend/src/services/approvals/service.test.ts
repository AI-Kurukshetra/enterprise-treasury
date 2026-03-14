import { describe, expect, it } from 'vitest';
import { ApprovalsService } from '@/services/approvals/service';
import { ConflictError } from '@/errors/ConflictError';

describe('ApprovalsService', () => {
  it('rejects stale approval requests when row version mismatches', async () => {
    const service = new ApprovalsService(
      {
        organizationId: 'org-1',
        userId: 'user-1',
        requestId: 'req-1'
      },
      {
        listPendingForUser: async () => [],
        saveDecision: async () => undefined
      } as never,
      {
        findById: async () => ({ id: 'pay-1', status: 'pending_approval', updated_at: '2026-03-14T11:00:00.000Z' }),
        updateStatus: async () => null,
        list: async () => ({ items: [], nextCursor: null }),
        findByIdempotencyKey: async () => null,
        create: async () => ({})
      } as never
    );

    await expect(
      service.approve(
        {
          paymentId: 'pay-1',
          rowVersionToken: '2026-03-14T11:00:01.000Z'
        },
        'approver-1'
      )
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
