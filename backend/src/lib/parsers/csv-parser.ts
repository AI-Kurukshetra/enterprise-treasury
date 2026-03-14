import {
  addParserError,
  detectCsvColumnMapping,
  detectDirection,
  getCsvCell,
  inferCsvDelimiter,
  normalizeCurrencyCode,
  normalizeLineEndings,
  parseFlexibleDate,
  splitCsvLine
} from '@/lib/parsers/shared';
import type { CsvParserOptions, ParsedDocument, ParsedStatement } from '@/lib/parsers/types';

export function parseCsvStatement(content: string, options: CsvParserOptions = {}): ParsedDocument {
  const normalized = normalizeLineEndings(content);
  const lines = normalized.split('\n').filter((line) => line.trim().length > 0);
  const errors: ParsedDocument['errors'] = [];

  if (lines.length === 0) {
    return {
      format: 'csv',
      statements: [],
      errors: [
        {
          lineNumber: 1,
          field: 'file',
          reason: 'CSV file is empty'
        }
      ],
      warnings: []
    };
  }

  const delimiter = inferCsvDelimiter(lines);
  const headers = splitCsvLine(lines[0] ?? '', delimiter);
  const detectedMapping = detectCsvColumnMapping(headers);
  const mapping = {
    ...detectedMapping,
    ...options.columnMapping
  };

  const rows = lines.slice(1).map((line) => {
    const values = splitCsvLine(line, delimiter);
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = values[index] ?? '';
      return row;
    }, {});
  });

  const transactions: ParsedStatement['transactions'] = [];

  rows.forEach((row, index) => {
    const lineNumber = index + 2;
    try {
      const bookingDate = parseFlexibleDate(getCsvCell(row, mapping.bookingDate));
      const valueDateRaw = getCsvCell(row, mapping.valueDate);
      const { direction, amount } = detectDirection(
        getCsvCell(row, mapping.amount),
        getCsvCell(row, mapping.credit),
        getCsvCell(row, mapping.debit),
        getCsvCell(row, mapping.direction)
      );

      transactions.push({
        bookingDate,
        valueDate: valueDateRaw ? parseFlexibleDate(valueDateRaw) : bookingDate,
        amount,
        direction,
        description: getCsvCell(row, mapping.description) || undefined,
        bankReference: getCsvCell(row, mapping.bankReference) || undefined,
        reference: getCsvCell(row, mapping.reference) || undefined,
        currency: normalizeCurrencyCode(getCsvCell(row, mapping.currency)) || undefined,
        raw: row
      });
    } catch (error) {
      addParserError(
        errors,
        lineNumber,
        'row',
        error instanceof Error ? error.message : 'CSV parse error',
        JSON.stringify(row)
      );
    }
  });

  const firstAccountId = rows
    .map((row) => getCsvCell(row, mapping.accountId))
    .find((value) => value.trim().length > 0);
  const firstCurrency = transactions
    .map((transaction) => transaction.currency)
    .find((currency): currency is string => Boolean(currency));

  return {
    format: 'csv',
    statements: [
      {
        accountId: firstAccountId?.trim() ?? '',
        currency: firstCurrency ?? '',
        transactions,
        statementDate: transactions.at(-1)?.bookingDate,
        raw: {
          delimiter,
          headers,
          columnMapping: mapping
        }
      }
    ],
    errors,
    warnings: []
  };
}
