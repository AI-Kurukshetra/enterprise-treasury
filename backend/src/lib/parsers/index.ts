import { parseCsvStatement } from '@/lib/parsers/csv-parser';
import { parseMt940 } from '@/lib/parsers/mt940-parser';
import { parseOfxStatement } from '@/lib/parsers/ofx-parser';
import type { CsvParserOptions, ParsedDocument } from '@/lib/parsers/types';

export type StatementFormat = 'mt940' | 'csv' | 'ofx';

export function detectStatementFormat(content: string, sourceFilename?: string): StatementFormat {
  const filename = sourceFilename?.toLowerCase() ?? '';
  if (filename.endsWith('.mt940') || filename.endsWith('.sta')) {
    return 'mt940';
  }

  if (filename.endsWith('.ofx') || filename.endsWith('.qfx')) {
    return 'ofx';
  }

  if (filename.endsWith('.csv')) {
    return 'csv';
  }

  const trimmed = content.trimStart();
  if (trimmed.startsWith('{1:') || trimmed.includes(':20:') || trimmed.includes(':61:')) {
    return 'mt940';
  }

  if (trimmed.startsWith('<OFX') || trimmed.startsWith('OFXHEADER:')) {
    return 'ofx';
  }

  return 'csv';
}

export function parseStatementDocument(
  content: string,
  format: StatementFormat,
  options: { csv?: CsvParserOptions } = {}
): ParsedDocument {
  switch (format) {
    case 'mt940':
      return parseMt940(content);
    case 'ofx':
      return parseOfxStatement(content);
    case 'csv':
    default:
      return parseCsvStatement(content, options.csv);
  }
}
