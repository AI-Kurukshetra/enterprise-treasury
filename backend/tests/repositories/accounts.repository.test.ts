import { describe, expect, it } from 'vitest';
import { AccountsRepository } from '@/repositories/accounts/repository';
import { bankAccountFixture } from '../fixtures/treasury';
import { toNextCursor } from '@/utils/pagination';
import { createSupabaseClientMock } from '../utils/supabaseMock';

describe('AccountsRepository', () => {
  it('applies tenant and account filters for account listing queries', async () => {
    const { client, getLastBuilder } = createSupabaseClientMock({
      bank_accounts: {
        data: [bankAccountFixture()]
      }
    });
    const repository = new AccountsRepository({ organizationId: 'org-1' }, client as never);

    await repository.list(
      { status: 'active', currencyCode: 'USD', bankConnectionId: 'conn-1' },
      { limit: 25, cursor: toNextCursor('2026-03-14T09:00:00.000Z') ?? undefined }
    );

    const builder = getLastBuilder('bank_accounts');
    expect(builder.state.operations).toEqual(
      expect.arrayContaining([
        { method: 'select', args: ['*'] },
        { method: 'eq', args: ['organization_id', 'org-1'] },
        { method: 'eq', args: ['status', 'active'] },
        { method: 'eq', args: ['currency_code', 'USD'] },
        { method: 'eq', args: ['bank_connection_id', 'conn-1'] },
        { method: 'order', args: ['created_at', { ascending: false }] },
        { method: 'lt', args: ['created_at', '2026-03-14T09:00:00.000Z'] },
        { method: 'limit', args: [26] }
      ])
    );
  });

  it('builds insert payloads with the tenant id and active status', async () => {
    const { client, getLastBuilder } = createSupabaseClientMock({
      bank_accounts: {
        data: bankAccountFixture()
      }
    });
    const repository = new AccountsRepository({ organizationId: 'org-1' }, client as never);

    await repository.create({
      bankConnectionId: 'conn-1',
      accountName: 'Liquidity Account',
      accountNumberMasked: '****1111',
      currencyCode: 'USD'
    });

    const builder = getLastBuilder('bank_accounts');
    expect(builder.state.insertPayload).toEqual({
      organization_id: 'org-1',
      bank_connection_id: 'conn-1',
      account_name: 'Liquidity Account',
      account_number_masked: '****1111',
      currency_code: 'USD',
      status: 'active'
    });
  });

  it('retrieves a single account by id within the tenant boundary', async () => {
    const account = bankAccountFixture();
    const { client, getLastBuilder } = createSupabaseClientMock({
      bank_accounts: {
        data: account
      }
    });
    const repository = new AccountsRepository({ organizationId: 'org-1' }, client as never);

    await expect(repository.getById(account.id)).resolves.toEqual(account);

    const builder = getLastBuilder('bank_accounts');
    expect(builder.state.operations).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['organization_id', 'org-1'] },
        { method: 'eq', args: ['id', account.id] },
        { method: 'maybeSingle', args: [] }
      ])
    );
  });

  it('updates only the supplied mutable account fields', async () => {
    const account = bankAccountFixture({ status: 'dormant' });
    const { client, getLastBuilder } = createSupabaseClientMock({
      bank_accounts: {
        data: account
      }
    });
    const repository = new AccountsRepository({ organizationId: 'org-1' }, client as never);

    await repository.update(account.id, { status: 'dormant' });

    const builder = getLastBuilder('bank_accounts');
    expect(builder.state.updatePayload).toEqual({
      status: 'dormant'
    });
  });
});
