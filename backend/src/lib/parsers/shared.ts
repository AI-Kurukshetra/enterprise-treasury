import type { CsvColumnMapping, ParserError, ParsedBalance } from '@/lib/parsers/types';

export function normalizeLineEndings(input: string): string {
  return input.replace(/\r\n?/g, '\n');
}

export function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, ' ').trim();
}

export function normalizeCurrencyCode(input: string | undefined | null): string {
  return (input ?? '').trim().toUpperCase();
}

export function isIsoCurrencyCode(input: string): boolean {
  return /^[A-Z]{3}$/.test(normalizeCurrencyCode(input));
}

export function normalizeSignedDecimal(input: string): string {
  let value = input.trim();
  if (value.length === 0) {
    throw new Error('Amount is blank');
  }

  let sign = '';
  if (value.startsWith('+') || value.startsWith('-')) {
    sign = value[0] === '-' ? '-' : '';
    value = value.slice(1);
  }

  value = value.replace(/\s/g, '');
  const lastComma = value.lastIndexOf(',');
  const lastDot = value.lastIndexOf('.');
  let decimalSeparator = '';

  if (lastComma !== -1 && lastDot !== -1) {
    decimalSeparator = lastComma > lastDot ? ',' : '.';
  } else if (lastComma !== -1) {
    const digitsAfter = value.length - lastComma - 1;
    decimalSeparator = digitsAfter > 0 && digitsAfter <= 6 ? ',' : '';
  } else if (lastDot !== -1) {
    const digitsAfter = value.length - lastDot - 1;
    decimalSeparator = digitsAfter > 0 && digitsAfter <= 6 ? '.' : '';
  }

  if (decimalSeparator) {
    const thousandsSeparator = decimalSeparator === ',' ? '.' : ',';
    value = value.split(thousandsSeparator).join('');
    value = value.replace(decimalSeparator, '.');
  } else {
    value = value.replace(/[.,]/g, '');
  }

  if (!/^\d+(\.\d+)?$/.test(value)) {
    throw new Error('Amount contains unsupported characters');
  }

  const [integerPartRaw = '0', fractionRaw = ''] = value.split('.');
  const integerPart = integerPartRaw.replace(/^0+(?=\d)/, '') || '0';
  const fraction = fractionRaw.replace(/0+$/, '');
  return `${sign}${integerPart}${fraction.length > 0 ? `.${fraction}` : ''}`;
}

export function normalizeUnsignedDecimal(input: string): string {
  const normalized = normalizeSignedDecimal(input);
  return normalized.startsWith('-') ? normalized.slice(1) : normalized;
}

export function getDecimalScale(input: string): number {
  const [, fraction = ''] = input.split('.');
  return fraction.length;
}

export function addParserError(
  errors: ParserError[],
  lineNumber: number,
  field: string,
  reason: string,
  rawValue?: string
): void {
  errors.push({
    lineNumber,
    field,
    reason,
    rawValue
  });
}

export function parseIsoDateParts(year: number, month: number, day: number): string {
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    throw new Error('Invalid calendar date');
  }

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function parseFlexibleDate(raw: string): string {
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [yearRaw = '0', monthRaw = '0', dayRaw = '0'] = value.split('-');
    return parseIsoDateParts(Number(yearRaw), Number(monthRaw), Number(dayRaw));
  }

  if (/^\d{8}$/.test(value)) {
    const year = Number(value.slice(0, 4));
    const month = Number(value.slice(4, 6));
    const day = Number(value.slice(6, 8));
    return parseIsoDateParts(year, month, day);
  }

  const separatorMatch = value.match(/[./-]/);
  if (!separatorMatch) {
    throw new Error('Unsupported date format');
  }

  const separator = separatorMatch[0] ?? '-';
  const parts = value.split(separator).map((part) => part.trim());
  if (parts.length !== 3) {
    throw new Error('Unsupported date format');
  }

  if (parts[0]?.length === 4) {
    return parseIsoDateParts(Number(parts[0]), Number(parts[1]), Number(parts[2]));
  }

  const first = Number(parts[0]);
  const second = Number(parts[1]);
  const year = Number(parts[2]?.length === 2 ? `20${parts[2]}` : parts[2]);

  if (Number.isNaN(first) || Number.isNaN(second) || Number.isNaN(year)) {
    throw new Error('Date is not numeric');
  }

  if (first > 12) {
    return parseIsoDateParts(year, second, first);
  }

  if (second > 12) {
    return parseIsoDateParts(year, first, second);
  }

  return parseIsoDateParts(year, first, second);
}

export function parseMt940Date(yyMMdd: string): string {
  if (!/^\d{6}$/.test(yyMMdd)) {
    throw new Error('Invalid MT940 date');
  }

  const year = Number(`20${yyMMdd.slice(0, 2)}`);
  const month = Number(yyMMdd.slice(2, 4));
  const day = Number(yyMMdd.slice(4, 6));
  return parseIsoDateParts(year, month, day);
}

export function parseMt940EntryDate(bookingDate: string, mmdd: string): string {
  if (!/^\d{4}$/.test(mmdd)) {
    throw new Error('Invalid MT940 entry date');
  }

  const bookingYear = Number(bookingDate.slice(0, 4));
  const bookingMonth = Number(bookingDate.slice(5, 7));
  const entryMonth = Number(mmdd.slice(0, 2));
  const entryDay = Number(mmdd.slice(2, 4));
  const year = entryMonth > bookingMonth + 10 ? bookingYear - 1 : bookingYear;
  return parseIsoDateParts(year, entryMonth, entryDay);
}

export function parseMt940Balance(raw: string): ParsedBalance {
  const match = raw.trim().match(/^([DC])(\d{6})([A-Z]{3})([0-9,]+)$/);
  if (!match) {
    throw new Error('Invalid balance payload');
  }

  const [, mark = 'D', date = '000000', _currency = '', amountRaw = '0'] = match;
  return {
    direction: mark === 'C' ? 'credit' : 'debit',
    date: parseMt940Date(date),
    amount: normalizeUnsignedDecimal(amountRaw.replace(',', '.')),
    isIntermediate: false
  };
}

export function inferCsvDelimiter(lines: string[]): string {
  const candidates = [',', ';', '|', '\t'];
  let bestDelimiter = ',';
  let bestScore = -1;

  for (const candidate of candidates) {
    const counts = lines
      .slice(0, 5)
      .filter((line) => line.trim().length > 0)
      .map((line) => splitCsvLine(line, candidate).length);

    const minCount = counts.length === 0 ? 0 : Math.min(...counts);
    const score = counts.length === 0 ? -1 : counts.filter((count) => count > 1).length * 100 + minCount;
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = candidate;
    }
  }

  return bestDelimiter;
}

export function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];

    if (character === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
        continue;
      }

      inQuotes = !inQuotes;
      continue;
    }

    if (character === delimiter && !inQuotes) {
      result.push(current);
      current = '';
      continue;
    }

    current += character;
  }

  result.push(current);
  return result.map((value) => value.trim());
}

function sanitizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

const CSV_HEADER_ALIASES: Record<keyof CsvColumnMapping, string[]> = {
  bookingDate: ['booking date', 'date', 'transaction date', 'posted date', 'book date', 'effective date'],
  valueDate: ['value date', 'settlement date'],
  amount: ['amount', 'transaction amount', 'signed amount', 'net amount'],
  debit: ['debit', 'withdrawal', 'money out', 'paid out'],
  credit: ['credit', 'deposit', 'money in', 'paid in'],
  direction: ['direction', 'type', 'dr cr', 'debit credit'],
  description: ['description', 'details', 'narration', 'memo', 'remittance information'],
  bankReference: ['bank reference', 'reference', 'transaction reference', 'bank ref', 'fitid'],
  reference: ['customer reference', 'beneficiary reference', 'remittance reference', 'payment reference', 'ref'],
  currency: ['currency', 'currency code', 'ccy'],
  accountId: ['account', 'account id', 'account number', 'iban']
};

export function detectCsvColumnMapping(headers: string[]): CsvColumnMapping {
  const mapping: CsvColumnMapping = {};
  const normalizedHeaders = headers.map((header) => sanitizeHeader(header));

  for (const [field, aliases] of Object.entries(CSV_HEADER_ALIASES) as Array<[keyof CsvColumnMapping, string[]]>) {
    const matchIndex = normalizedHeaders.findIndex((header) => aliases.includes(header));
    if (matchIndex >= 0) {
      mapping[field] = headers[matchIndex];
    }
  }

  return mapping;
}

export function getCsvCell(row: Record<string, string>, columnName?: string): string {
  if (!columnName) {
    return '';
  }

  return row[columnName] ?? '';
}

export function detectDirection(
  amountValue: string,
  creditValue: string,
  debitValue: string,
  directionValue: string
): { direction: 'inflow' | 'outflow'; amount: string } {
  if (creditValue.trim().length > 0) {
    return {
      direction: 'inflow',
      amount: normalizeUnsignedDecimal(creditValue)
    };
  }

  if (debitValue.trim().length > 0) {
    return {
      direction: 'outflow',
      amount: normalizeUnsignedDecimal(debitValue)
    };
  }

  const normalizedAmount = normalizeSignedDecimal(amountValue);
  if (normalizedAmount.startsWith('-')) {
    return {
      direction: 'outflow',
      amount: normalizedAmount.slice(1)
    };
  }

  const direction = normalizeWhitespace(directionValue).toLowerCase();
  if (['d', 'debit', 'outflow', 'dr'].includes(direction)) {
    return {
      direction: 'outflow',
      amount: normalizeUnsignedDecimal(normalizedAmount)
    };
  }

  return {
    direction: 'inflow',
    amount: normalizeUnsignedDecimal(normalizedAmount)
  };
}

export function chunkArray<T>(values: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}
