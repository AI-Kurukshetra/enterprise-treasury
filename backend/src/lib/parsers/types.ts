export interface ParserError {
  lineNumber: number;
  field: string;
  reason: string;
  rawValue?: string;
}

export interface ParserWarning {
  lineNumber: number;
  field: string;
  reason: string;
}

export interface ParsedBalance {
  amount: string;
  direction: 'credit' | 'debit';
  date?: string;
  isIntermediate?: boolean;
}

export interface ParsedTransaction {
  bookingDate: string;
  valueDate: string;
  entryDate?: string;
  amount: string;
  direction: 'inflow' | 'outflow';
  swiftTransactionTypeCode?: string;
  transactionType?: string;
  reference?: string;
  bankReference?: string;
  description?: string;
  remittanceInfo?: string;
  currency?: string;
  raw: Record<string, unknown>;
}

export interface ParsedStatement {
  accountId: string;
  openingBalance?: ParsedBalance;
  closingBalance?: ParsedBalance;
  availableBalance?: ParsedBalance;
  transactions: ParsedTransaction[];
  statementDate?: string;
  statementNumber?: string;
  sequenceNumber?: string;
  currency: string;
  raw: Record<string, unknown>;
}

export interface ParsedDocument {
  format: 'mt940' | 'csv' | 'ofx';
  statements: ParsedStatement[];
  errors: ParserError[];
  warnings: ParserWarning[];
}

export interface CsvColumnMapping {
  bookingDate?: string;
  valueDate?: string;
  amount?: string;
  debit?: string;
  credit?: string;
  direction?: string;
  description?: string;
  bankReference?: string;
  reference?: string;
  currency?: string;
  accountId?: string;
}

export interface CsvParserOptions {
  columnMapping?: CsvColumnMapping;
}
