import { describe, expect, it } from 'vitest';
import { CashPositionsRepository } from '@/repositories/cash_positions/repository';
import { cashPositionFixture } from '../fixtures/treasury';
import { createSupabaseClientMock } from '../utils/supabaseMock';

describe('CashPositionsRepository', () => {
  it('queries latest cash position snapshots from the latest view within the tenant scope', async () => {
    const { client, getLastBuilder } = createSupabaseClientMock({
      cash_positions_latest: {
        data: [cashPositionFixture()]
      }
    });
    const repository = new CashPositionsRepository({ organizationId: 'org-1' }, client as never);

    await repository.getLatest({ scopeType: 'organization', currencyCode: 'USD' });

    const builder = getLastBuilder('cash_positions_latest');
    expect(builder.state.operations).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['organization_id', 'org-1'] },
        { method: 'eq', args: ['scope_type', 'organization'] },
        { method: 'eq', args: ['currency_code', 'USD'] }
      ])
    );
  });

  it('uses explicit ISO bounds for cash position history', async () => {
    const { client, getLastBuilder } = createSupabaseClientMock({
      cash_positions: {
        data: [cashPositionFixture()]
      }
    });
    const repository = new CashPositionsRepository({ organizationId: 'org-1' }, client as never);

    await repository.getHistory('organization', 'org-1', '2026-03-01T00:00:00Z', '2026-03-31T23:59:59Z');

    const builder = getLastBuilder('cash_positions');
    expect(builder.state.operations).toEqual(
      expect.arrayContaining([
        { method: 'gte', args: ['as_of_at', '2026-03-01T00:00:00Z'] },
        { method: 'lte', args: ['as_of_at', '2026-03-31T23:59:59Z'] },
        { method: 'eq', args: ['scope_id', 'org-1'] },
        { method: 'order', args: ['as_of_at', { ascending: true }] }
      ])
    );
  });
});
