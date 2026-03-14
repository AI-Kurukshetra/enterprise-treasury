import { describe, expect, it } from 'vitest';
import { parseOfxStatement } from '@/lib/parsers/ofx-parser';

describe('parseOfxStatement', () => {
  it('parses SGML-based OFX 1.x statements', () => {
    const input = `
OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<CURDEF>USD
<BANKACCTFROM>
<BANKID>111000111
<ACCTID>123456789
</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260301000000
<DTEND>20260315000000
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260314
<TRNAMT>-75.25
<FITID>FIT-001
<NAME>Supplier A
<MEMO>Invoice 1001
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`.trim();

    const result = parseOfxStatement(input);

    expect(result.errors).toHaveLength(0);
    expect(result.statements[0]).toMatchObject({
      accountId: '123456789',
      currency: 'USD'
    });
    expect(result.statements[0]?.transactions[0]).toMatchObject({
      bookingDate: '2026-03-14',
      amount: '75.25',
      direction: 'outflow',
      transactionType: 'DEBIT',
      bankReference: 'FIT-001',
      description: 'Supplier A | Invoice 1001'
    });
  });

  it('parses XML-based OFX 2.x statements', () => {
    const input = `
<?xml version="1.0" encoding="UTF-8"?>
<OFX>
  <BANKMSGSRSV1>
    <STMTTRNRS>
      <STMTRS>
        <CURDEF>EUR</CURDEF>
        <BANKACCTFROM>
          <ACCTID>DE89370400440532013000</ACCTID>
        </BANKACCTFROM>
        <BANKTRANLIST>
          <DTASOF>20260315120000</DTASOF>
          <STMTTRN>
            <TRNTYPE>CREDIT</TRNTYPE>
            <DTPOSTED>20260315</DTPOSTED>
            <TRNAMT>1500.00</TRNAMT>
            <FITID>FIT-002</FITID>
            <NAME>Customer B</NAME>
            <MEMO>Receipt RCPT-1002</MEMO>
          </STMTTRN>
        </BANKTRANLIST>
      </STMTRS>
    </STMTTRNRS>
  </BANKMSGSRSV1>
</OFX>
`.trim();

    const result = parseOfxStatement(input);

    expect(result.errors).toHaveLength(0);
    expect(result.statements[0]).toMatchObject({
      accountId: 'DE89370400440532013000',
      currency: 'EUR',
      statementDate: '2026-03-15'
    });
    expect(result.statements[0]?.transactions[0]).toMatchObject({
      bookingDate: '2026-03-15',
      amount: '1500',
      direction: 'inflow',
      transactionType: 'CREDIT'
    });
  });
});
