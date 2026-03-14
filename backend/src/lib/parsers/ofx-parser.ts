import { addParserError, normalizeCurrencyCode, normalizeLineEndings, normalizeSignedDecimal, parseFlexibleDate } from '@/lib/parsers/shared';
import type { ParsedDocument, ParsedStatement, ParsedTransaction } from '@/lib/parsers/types';

function getBlockValues(content: string, tag: string): string[] {
  const values: string[] = [];
  const blockPattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'gi');
  let blockMatch = blockPattern.exec(content);

  while (blockMatch) {
    values.push(blockMatch[1] ?? '');
    blockMatch = blockPattern.exec(content);
  }

  return values;
}

function getLeafValue(content: string, tag: string): string | undefined {
  const paired = content.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i'));
  if (paired?.[1]) {
    return paired[1].trim();
  }

  const sgml = content.match(new RegExp(`<${tag}>([^<\\n\\r]+)`, 'i'));
  return sgml?.[1]?.trim();
}

function parseOfxDate(raw: string): string {
  const normalized = raw.trim().slice(0, 8);
  return parseFlexibleDate(normalized);
}

function mapTrnType(raw: string): string {
  return raw.trim().toUpperCase();
}

function parseTransaction(block: string): ParsedTransaction {
  const amountRaw = getLeafValue(block, 'TRNAMT') ?? '';
  const normalizedAmount = normalizeSignedDecimal(amountRaw);
  const direction = normalizedAmount.startsWith('-') ? 'outflow' : 'inflow';
  const postedDate = parseOfxDate(getLeafValue(block, 'DTPOSTED') ?? '');

  return {
    bookingDate: postedDate,
    valueDate: postedDate,
    amount: normalizedAmount.startsWith('-') ? normalizedAmount.slice(1) : normalizedAmount,
    direction,
    transactionType: mapTrnType(getLeafValue(block, 'TRNTYPE') ?? 'OTHER'),
    bankReference: getLeafValue(block, 'FITID'),
    reference: getLeafValue(block, 'CHECKNUM') ?? getLeafValue(block, 'REFNUM'),
    description: [getLeafValue(block, 'NAME'), getLeafValue(block, 'MEMO')].filter(Boolean).join(' | ') || undefined,
    remittanceInfo: getLeafValue(block, 'MEMO'),
    raw: {
      block
    }
  };
}

export function parseOfxStatement(content: string): ParsedDocument {
  const normalized = normalizeLineEndings(content);
  const errors: ParsedDocument['errors'] = [];
  const transactionBlocks = getBlockValues(normalized, 'STMTTRN');
  const transactions: ParsedStatement['transactions'] = [];

  transactionBlocks.forEach((block) => {
    try {
      transactions.push(parseTransaction(block));
    } catch (error) {
      const rawLine = getLeafValue(block, 'FITID') ?? block.slice(0, 120);
      const lines = normalized.split('\n');
      const blockLineIndex = lines.findIndex((line) => line.includes(rawLine));
      addParserError(
        errors,
        blockLineIndex >= 0 ? blockLineIndex + 1 : 1,
        'STMTTRN',
        error instanceof Error ? error.message : 'OFX parse error',
        rawLine
      );
    }
  });

  const currency = normalizeCurrencyCode(getLeafValue(normalized, 'CURDEF'));
  const accountId =
    getLeafValue(normalized, 'ACCTID') ??
    getLeafValue(normalized, 'BANKID') ??
    '';

  return {
    format: 'ofx',
    statements: [
      {
        accountId,
        currency,
        transactions,
        statementDate:
          getLeafValue(normalized, 'DTASOF') ? parseOfxDate(getLeafValue(normalized, 'DTASOF') ?? '') : transactions.at(-1)?.bookingDate,
        raw: {
          accountType: getLeafValue(normalized, 'ACCTTYPE') ?? undefined
        }
      }
    ],
    errors,
    warnings: []
  };
}
