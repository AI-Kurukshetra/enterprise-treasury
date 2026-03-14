import { addParserError, normalizeCurrencyCode, normalizeLineEndings, normalizeWhitespace, parseMt940Balance, parseMt940Date, parseMt940EntryDate } from '@/lib/parsers/shared';
import type { ParsedDocument, ParsedStatement, ParsedTransaction } from '@/lib/parsers/types';

interface Mt940Field {
  tag: string;
  value: string;
  lineNumber: number;
}

function parseMt940Entry(raw: string): ParsedTransaction {
  const line = raw.trim();
  const amountStart = line.indexOf('N');
  if (amountStart === -1) {
    throw new Error('Missing transaction type delimiter');
  }

  const prefix = line.slice(0, amountStart);
  const suffix = line.slice(amountStart + 1);
  const prefixMatch = prefix.match(/^(\d{6})(\d{4})?(RC|RD|C|D)([0-9,]+)$/);
  if (!prefixMatch) {
    throw new Error('Invalid :61: prefix');
  }

  const [, valueDateRaw = '', entryDateRaw, mark = 'D', amountRaw = '0'] = prefixMatch;
  const valueDate = parseMt940Date(valueDateRaw);
  const entryDate = entryDateRaw ? parseMt940EntryDate(valueDate, entryDateRaw) : undefined;
  const direction = mark === 'D' || mark === 'RC' ? 'outflow' : 'inflow';
  const [referenceSection = '', bankReferenceRaw = ''] = suffix.split('//');
  const typeCode = referenceSection.slice(0, 3) ? `N${referenceSection.slice(0, 3)}` : undefined;
  const reference = referenceSection.slice(3).trim();

  return {
    bookingDate: valueDate,
    valueDate,
    entryDate,
    amount: amountRaw.replace(',', '.'),
    direction,
    swiftTransactionTypeCode: typeCode,
    reference: reference || undefined,
    bankReference: bankReferenceRaw.trim() || undefined,
    raw: {
      line
    }
  };
}

function parseStatement(fields: Mt940Field[], errors: ParsedDocument['errors']): ParsedStatement | null {
  const statement: ParsedStatement = {
    accountId: '',
    transactions: [],
    currency: '',
    raw: {}
  };
  let currentTransaction: ParsedTransaction | null = null;

  for (const field of fields) {
    try {
      switch (field.tag) {
        case '20':
          statement.raw.transactionReference = field.value.trim();
          break;
        case '25':
          statement.accountId = field.value.trim();
          break;
        case '28C': {
          const [statementNumber = '', sequenceNumber = ''] = field.value.trim().split('/');
          statement.statementNumber = statementNumber || undefined;
          statement.sequenceNumber = sequenceNumber || undefined;
          break;
        }
        case '60F':
        case '60M': {
          const balance = parseMt940Balance(field.value);
          balance.isIntermediate = field.tag === '60M';
          statement.openingBalance = balance;
          statement.currency = normalizeCurrencyCode(field.value.slice(7, 10));
          break;
        }
        case '61':
          currentTransaction = parseMt940Entry(field.value);
          statement.transactions.push(currentTransaction);
          break;
        case '86':
          if (!currentTransaction) {
            throw new Error('Found :86: without a preceding :61: entry');
          }
          currentTransaction.remittanceInfo = normalizeWhitespace(field.value);
          currentTransaction.description = normalizeWhitespace(field.value);
          break;
        case '62F':
        case '62M': {
          const balance = parseMt940Balance(field.value);
          balance.isIntermediate = field.tag === '62M';
          statement.closingBalance = balance;
          statement.statementDate = balance.date;
          statement.currency = normalizeCurrencyCode(field.value.slice(7, 10));
          break;
        }
        case '64':
          statement.availableBalance = parseMt940Balance(field.value);
          break;
        default:
          statement.raw[field.tag] = field.value;
      }
    } catch (error) {
      addParserError(
        errors,
        field.lineNumber,
        `:${field.tag}:`,
        error instanceof Error ? error.message : 'Unknown MT940 parse error',
        field.value
      );
    }
  }

  if (!statement.accountId && statement.transactions.length === 0) {
    return null;
  }

  if (!statement.statementDate) {
    statement.statementDate = statement.closingBalance?.date ?? statement.transactions.at(-1)?.bookingDate;
  }

  if (!statement.currency) {
    statement.currency =
      statement.openingBalance?.amount ? normalizeCurrencyCode((statement.raw.currency as string | undefined) ?? '') : '';
  }

  return statement;
}

export function parseMt940(content: string): ParsedDocument {
  const normalized = normalizeLineEndings(content);
  const lines = normalized.split('\n');
  const errors: ParsedDocument['errors'] = [];
  const statements: ParsedStatement[] = [];
  let fields: Mt940Field[] = [];
  let currentField: Mt940Field | null = null;

  const finalizeStatement = () => {
    if (currentField) {
      fields.push(currentField);
      currentField = null;
    }

    const statement = parseStatement(fields, errors);
    if (statement) {
      statements.push(statement);
    }
    fields = [];
  };

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const trimmed = line.trimEnd();

    if (trimmed.trim() === '-') {
      finalizeStatement();
      return;
    }

    const tagMatch = trimmed.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (tagMatch) {
      if (currentField) {
        fields.push(currentField);
      }

      currentField = {
        tag: tagMatch[1] ?? '',
        value: tagMatch[2] ?? '',
        lineNumber
      };
      return;
    }

    if (currentField) {
      currentField.value = `${currentField.value}\n${trimmed}`;
      return;
    }

    if (trimmed.trim().length > 0) {
      addParserError(errors, lineNumber, 'line', 'Unexpected content outside MT940 field', trimmed);
    }
  });

  if (currentField || fields.length > 0) {
    finalizeStatement();
  }

  return {
    format: 'mt940',
    statements,
    errors,
    warnings: []
  };
}
