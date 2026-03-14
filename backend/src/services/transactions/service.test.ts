import { describe, expect, it } from 'vitest';
import { TransactionsService } from '@/services/transactions/service';
import { ConflictError } from '@/errors/ConflictError';

describe('TransactionsService', () => {
  it('blocks duplicate transactions by dedupe hash', async () => {
    const service = new TransactionsService(
      {
        organizationId: 'org-1',
        userId: 'user-1',
        requestId: 'req-1'
      },
      {
        list: async () => ({ items: [], nextCursor: null }),
        findByDedupeHash: async () => ({ id: 'tx-1' }),
        create: async () => ({ id: 'tx-2' }),
        reconcile: async () => null
      } as never,
      {
        getById: async () => ({ currency_code: 'USD' })
      } as never
    );

    await expect(
      service.create({
        bankAccountId: 'acc-1',
        bookingDate: '2026-03-14',
        amount: '10.000000',
        currencyCode: 'USD',
        direction: 'outflow',
        dedupeHash: 'dupe-hash'
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
