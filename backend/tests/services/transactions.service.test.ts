import { describe, expect, it, vi } from 'vitest';
import { ConflictError } from '@/errors/ConflictError';
import { NotFoundError } from '@/errors/NotFoundError';
import { ValidationError } from '@/errors/ValidationError';
import { TransactionsService } from '@/services/transactions/service';
import { transactionFixture } from '../fixtures/treasury';
import { createServiceContext } from '../utils/context';

function createTransactionsService(overrides: {
  account?: { currency_code: string } | null;
  existingTransaction?: ReturnType<typeof transactionFixture> | null;
  reconciledTransaction?: ReturnType<typeof transactionFixture> | null;
} = {}) {
  const transactionsRepository = {
    list: vi.fn(),
    findByDedupeHash: vi.fn(async () => overrides.existingTransaction ?? null),
    create: vi.fn(async () => transactionFixture()),
    reconcile: vi.fn(async () =>
      overrides.reconciledTransaction === undefined
        ? transactionFixture({ reconciliation_status: 'reconciled' })
        : overrides.reconciledTransaction
    ),
    queueImport: vi.fn(async () => ({ importJobId: 'job-1', status: 'queued' }))
  };
  const accountsRepository = {
    getById: vi.fn(async () => (overrides.account === undefined ? { currency_code: 'USD' } : overrides.account))
  };

  return {
    service: new TransactionsService(createServiceContext(), transactionsRepository as never, accountsRepository as never),
    transactionsRepository
  };
}

describe('TransactionsService', () => {
  it('delegates list operations to the repository', async () => {
    const { service, transactionsRepository } = createTransactionsService();
    await service.list({ direction: 'outflow' }, { limit: 10 });
    expect(transactionsRepository.list).toHaveBeenCalledWith({ direction: 'outflow' }, { limit: 10 });
  });

  it('rejects non-positive transaction amounts', async () => {
    const { service } = createTransactionsService();

    await expect(
      service.create({
        bankAccountId: 'acc-1',
        bookingDate: '2026-03-14',
        amount: '-1.000000',
        currencyCode: 'USD',
        direction: 'outflow',
        dedupeHash: 'dedupe-hash-1'
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects duplicate transactions by dedupe hash', async () => {
    const { service } = createTransactionsService({ existingTransaction: transactionFixture({ id: 'tx-existing' }) });

    await expect(
      service.create({
        bankAccountId: 'acc-1',
        bookingDate: '2026-03-14',
        amount: '1.000000',
        currencyCode: 'USD',
        direction: 'outflow',
        dedupeHash: 'dedupe-hash-1'
      })
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('rejects missing bank accounts', async () => {
    const { service } = createTransactionsService({ account: null });

    await expect(
      service.create({
        bankAccountId: 'acc-1',
        bookingDate: '2026-03-14',
        amount: '1.000000',
        currencyCode: 'USD',
        direction: 'outflow',
        dedupeHash: 'dedupe-hash-1'
      })
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects currency mismatches between the transaction and source account', async () => {
    const { service } = createTransactionsService({ account: { currency_code: 'EUR' } });

    await expect(
      service.create({
        bankAccountId: 'acc-1',
        bookingDate: '2026-03-14',
        amount: '1.000000',
        currencyCode: 'USD',
        direction: 'outflow',
        dedupeHash: 'dedupe-hash-1'
      })
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('throws when reconciliation targets a missing transaction', async () => {
    const { service } = createTransactionsService({ reconciledTransaction: null });
    await expect(service.reconcile('missing-transaction')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('queues imports through the repository boundary', async () => {
    const { service, transactionsRepository } = createTransactionsService();
    await service.queueImport('bank-connection-1', 'statement.csv');
    expect(transactionsRepository.queueImport).toHaveBeenCalledWith({
      bankConnectionId: 'bank-connection-1',
      sourceFilename: 'statement.csv'
    });
  });
});
