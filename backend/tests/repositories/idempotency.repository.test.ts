import { describe, expect, it } from 'vitest';
import { IdempotencyRepository } from '@/repositories/payments/idempotencyRepository';
import { createSupabaseClientMock } from '../utils/supabaseMock';

describe('IdempotencyRepository', () => {
  it('finds idempotency records within the tenant and operation scope', async () => {
    const record = {
      id: 'idem-1',
      organization_id: 'org-1',
      operation: 'payments.create',
      idempotency_key: 'idem-key-1',
      request_hash: 'hash-1',
      response_snapshot: null,
      status: 'in_progress' as const
    };
    const { client, getLastBuilder } = createSupabaseClientMock({
      idempotency_keys: {
        data: record
      }
    });
    const repository = new IdempotencyRepository({ organizationId: 'org-1' }, client as never);

    await expect(repository.find('payments.create', 'idem-key-1')).resolves.toEqual(record);

    const builder = getLastBuilder('idempotency_keys');
    expect(builder.state.operations).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['organization_id', 'org-1'] },
        { method: 'eq', args: ['operation', 'payments.create'] },
        { method: 'eq', args: ['idempotency_key', 'idem-key-1'] },
        { method: 'maybeSingle', args: [] }
      ])
    );
  });

  it('creates in-progress records with the request hash', async () => {
    const record = {
      id: 'idem-1',
      organization_id: 'org-1',
      operation: 'payments.retry',
      idempotency_key: 'idem-key-1',
      request_hash: 'hash-1',
      response_snapshot: null,
      status: 'in_progress' as const
    };
    const { client, getLastBuilder } = createSupabaseClientMock({
      idempotency_keys: {
        data: record
      }
    });
    const repository = new IdempotencyRepository({ organizationId: 'org-1' }, client as never);

    await expect(repository.createInProgress('payments.retry', 'idem-key-1', 'hash-1')).resolves.toEqual(record);

    const builder = getLastBuilder('idempotency_keys');
    expect(builder.state.insertPayload).toEqual({
      organization_id: 'org-1',
      operation: 'payments.retry',
      idempotency_key: 'idem-key-1',
      request_hash: 'hash-1',
      status: 'in_progress'
    });
  });

  it('marks completed responses and failures on existing idempotency records', async () => {
    const { client, getLastBuilder } = createSupabaseClientMock({
      idempotency_keys: {
        data: null
      }
    });
    const repository = new IdempotencyRepository({ organizationId: 'org-1' }, client as never);

    await repository.markCompleted('payments.create', 'idem-key-1', { id: 'pay-1' });
    expect(getLastBuilder('idempotency_keys').state.updatePayload).toEqual({
      status: 'completed',
      response_snapshot: { id: 'pay-1' }
    });

    await repository.markFailed('payments.create', 'idem-key-1', 'connector timeout');
    expect(getLastBuilder('idempotency_keys').state.updatePayload).toEqual({
      status: 'failed',
      response_snapshot: {
        error: 'connector timeout'
      }
    });
  });
});
