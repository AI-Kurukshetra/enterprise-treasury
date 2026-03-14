import { describe, expect, it } from 'vitest';
import { parseMt940 } from '@/lib/parsers/mt940-parser';

describe('parseMt940', () => {
  it('parses multiple MT940 statements from a single file', () => {
    const input = `
:20:STATREF001
:25:DE89370400440532013000
:28C:00001/001
:60F:C260301EUR1234,56
:61:2603010301D125,50NTRFREF-001//BANK-001
:86:Supplier settlement INV-2026-001
:61:2603020302C300,00NMSCREF-002//BANK-002
:86:Customer receipt RCPT-2026-001
:62F:C260302EUR1409,06
:64:C260302EUR1409,06
-
:20:STATREF002
:25:DE89370400440532013000
:28C:00002/001
:60F:C260303EUR1409,06
:61:2603030303D50,00NCHGREF-003//BANK-003
:86:Bank fee
:62F:C260303EUR1359,06
-
`.trim();

    const result = parseMt940(input);

    expect(result.errors).toHaveLength(0);
    expect(result.statements).toHaveLength(2);
    expect(result.statements[0]).toMatchObject({
      accountId: 'DE89370400440532013000',
      statementNumber: '00001',
      sequenceNumber: '001',
      currency: 'EUR',
      statementDate: '2026-03-02'
    });
    expect(result.statements[0]?.transactions[0]).toMatchObject({
      bookingDate: '2026-03-01',
      valueDate: '2026-03-01',
      direction: 'outflow',
      amount: '125.50',
      swiftTransactionTypeCode: 'NTRF',
      reference: 'REF-001',
      bankReference: 'BANK-001',
      description: 'Supplier settlement INV-2026-001'
    });
    expect(result.statements[0]?.transactions[1]).toMatchObject({
      direction: 'inflow',
      amount: '300.00'
    });
    expect(result.statements[1]?.transactions[0]).toMatchObject({
      bookingDate: '2026-03-03',
      direction: 'outflow',
      description: 'Bank fee'
    });
  });

  it('collects parse errors without aborting the file', () => {
    const input = `
:20:STATREF001
:25:DE89370400440532013000
:60F:C260301EUR1234,56
:61:INVALID
:86:Broken transaction
:62F:C260301EUR1234,56
-
`.trim();

    const result = parseMt940(input);

    expect(result.statements).toHaveLength(1);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatchObject({
      field: ':61:'
    });
  });
});
