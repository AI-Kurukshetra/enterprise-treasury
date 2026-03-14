import { describe, expect, it } from 'vitest';
import { csvFormatter, type ColumnDef } from '@/lib/report-formatters/csv-formatter';

describe('csvFormatter', () => {
  it('emits a UTF-8 BOM and escapes nested values safely', () => {
    const columns: ColumnDef[] = [
      { key: 'name', header: 'Name' },
      { key: 'amount', header: 'Amount', type: 'money', currencyKey: 'currency' },
      { key: 'meta.owner.email', header: 'Owner Email' },
      { key: 'tags', header: 'Tags' },
      { key: 'capturedAt', header: 'Captured At', type: 'datetime' },
      { key: 'details', header: 'Details', type: 'json' }
    ];

    const csv = csvFormatter.format(
      [
        {
          name: 'Treasury, North America',
          amount: '1250.5',
          currency: 'USD',
          meta: {
            owner: {
              email: 'owner@example.com'
            }
          },
          tags: ['cash', 'close'],
          capturedAt: '2026-03-14T05:00:00.000Z',
          details: {
            region: 'NA'
          }
        }
      ],
      columns
    );

    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('"Treasury, North America"');
    expect(csv).toContain('USD 1250.50');
    expect(csv).toContain('cash; close');
    expect(csv).toContain('"{""region"":""NA""}"');
  });
});
