import { describe, expect, it } from 'vitest';
import { TransactionsRepository } from '@/repositories/transactions/repository';
import { transactionFixture } from '../fixtures/treasury';
import { createSupabaseClientMock } from '../utils/supabaseMock';

describe('TransactionsRepository', () => {
  it('applies booking-date, direction, reconciliation, and amount filters', async () => {
    const { client, getLastBuilder } = createSupabaseClientMock({
      transactions: {
        data: [transactionFixture()]
      }
    });
    const repository = new TransactionsRepository({ organizationId: 'org-1' }, client as never);

    await repository.list(
      {
        accountId: 'acc-1',
        direction: 'outflow',
        reconciliationStatus: 'unreconciled',
        fromDate: '2026-03-01',
        toDate: '2026-03-31',
        minAmount: '10.000000',
        maxAmount: '1000.000000'
      },
      { limit: 10 }
    );

    const builder = getLastBuilder('transactions');
    expect(builder.state.operations).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['organization_id', 'org-1'] },
        { method: 'eq', args: ['bank_account_id', 'acc-1'] },
        { method: 'eq', args: ['direction', 'outflow'] },
        { method: 'eq', args: ['reconciliation_status', 'unreconciled'] },
        { method: 'gte', args: ['booking_date', '2026-03-01'] },
        { method: 'lte', args: ['booking_date', '2026-03-31'] },
        { method: 'gte', args: ['amount', '10.000000'] },
        { method: 'lte', args: ['amount', '1000.000000'] }
      ])
    );
  });

  it('inserts unreconciled normalized transaction payloads', async () => {
    const { client, getLastBuilder } = createSupabaseClientMock({
      transactions: {
        data: transactionFixture()
      }
    });
    const repository = new TransactionsRepository({ organizationId: 'org-1' }, client as never);

    await repository.create({
      bankAccountId: 'acc-1',
      bookingDate: '2026-03-14',
      amount: '55.120000',
      currencyCode: 'USD',
      direction: 'inflow',
      dedupeHash: 'dedupe-1234567890'
    });

    const builder = getLastBuilder('transactions');
    expect(builder.state.insertPayload).toEqual({
      organization_id: 'org-1',
      bank_account_id: 'acc-1',
      booking_date: '2026-03-14',
      value_date: null,
      amount: '55.120000',
      currency_code: 'USD',
      direction: 'inflow',
      description: null,
      dedupe_hash: 'dedupe-1234567890',
      reconciliation_status: 'unreconciled'
    });
  });

  it('retrieves transactions by dedupe hash within the tenant boundary', async () => {
    const transaction = transactionFixture();
    const { client, getLastBuilder } = createSupabaseClientMock({
      transactions: {
        data: transaction
      }
    });
    const repository = new TransactionsRepository({ organizationId: 'org-1' }, client as never);

    await expect(repository.findByDedupeHash(transaction.dedupe_hash)).resolves.toEqual(transaction);

    const builder = getLastBuilder('transactions');
    expect(builder.state.operations).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['organization_id', 'org-1'] },
        { method: 'eq', args: ['dedupe_hash', transaction.dedupe_hash] },
        { method: 'maybeSingle', args: [] }
      ])
    );
  });

  it('queues import jobs within the tenant boundary', async () => {
    const { client, getLastBuilder } = createSupabaseClientMock({
      bank_statement_import_jobs: {
        data: { id: 'job-1' }
      }
    });
    const repository = new TransactionsRepository({ organizationId: 'org-1' }, client as never);

    await expect(
      repository.queueImport({
        bankConnectionId: 'conn-1',
        sourceFilename: 'stmt.csv'
      })
    ).resolves.toEqual({
      importJobId: 'job-1',
      status: 'queued'
    });

    const builder = getLastBuilder('bank_statement_import_jobs');
    expect(builder.state.insertPayload).toEqual({
      organization_id: 'org-1',
      bank_connection_id: 'conn-1',
      bank_account_id: null,
      status: 'queued',
      source_filename: 'stmt.csv',
      format: null
    });
  });

  it('marks transactions as reconciled', async () => {
    const reconciled = transactionFixture({ reconciliation_status: 'reconciled' });
    const { client, getLastBuilder } = createSupabaseClientMock({
      transactions: {
        data: reconciled
      }
    });
    const repository = new TransactionsRepository({ organizationId: 'org-1' }, client as never);

    await expect(repository.reconcile(reconciled.id)).resolves.toEqual(reconciled);

    const builder = getLastBuilder('transactions');
    expect(builder.state.updatePayload).toEqual({
      reconciliation_status: 'reconciled'
    });
  });
});
