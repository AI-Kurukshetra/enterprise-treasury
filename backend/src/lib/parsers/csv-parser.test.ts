import { describe, expect, it } from 'vitest';
import { parseCsvStatement } from '@/lib/parsers/csv-parser';

describe('parseCsvStatement', () => {
  it('detects semicolon delimiters, day-first dates, and European decimals', () => {
    const input = `
Booking Date;Description;Debit;Credit;Bank Reference;Currency
14/03/2026;Supplier Invoice;1.250,75;;BNK-001;EUR
15/03/2026;Customer Receipt;;2.500,00;BNK-002;EUR
`.trim();

    const result = parseCsvStatement(input);

    expect(result.errors).toHaveLength(0);
    expect(result.statements[0]?.transactions).toHaveLength(2);
    expect(result.statements[0]?.transactions[0]).toMatchObject({
      bookingDate: '2026-03-14',
      amount: '1250.75',
      direction: 'outflow',
      bankReference: 'BNK-001'
    });
    expect(result.statements[0]?.transactions[1]).toMatchObject({
      bookingDate: '2026-03-15',
      amount: '2500',
      direction: 'inflow'
    });
    expect(result.statements[0]?.raw).toMatchObject({
      delimiter: ';'
    });
  });

  it('supports manual column mapping overrides', () => {
    const input = `
posted_on|narrative|money_in|money_out|ref
2026-03-14|Invoice payment|100.25||R-1
`.trim();

    const result = parseCsvStatement(input, {
      columnMapping: {
        bookingDate: 'posted_on',
        description: 'narrative',
        credit: 'money_in',
        debit: 'money_out',
        bankReference: 'ref'
      }
    });

    expect(result.errors).toHaveLength(0);
    expect(result.statements[0]?.transactions[0]).toMatchObject({
      bookingDate: '2026-03-14',
      amount: '100.25',
      direction: 'inflow',
      description: 'Invoice payment',
      bankReference: 'R-1'
    });
  });
});
