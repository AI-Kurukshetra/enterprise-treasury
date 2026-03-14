export interface ColumnDef {
  key: string;
  header: string;
  accessor?: (row: unknown) => unknown;
  type?: 'string' | 'number' | 'date' | 'datetime' | 'money' | 'json';
  currencyKey?: string;
}

function getNestedValue(input: unknown, path: string): unknown {
  if (!path) {
    return undefined;
  }

  return path.split('.').reduce<unknown>((current, segment) => {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, input);
}

function normalizeDate(value: unknown): string {
  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return '';
}

function normalizeMoney(value: unknown, currencyCode?: string): string {
  if (value === null || value === undefined || value === '') {
    return '';
  }

  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) {
    return '';
  }

  if (!currencyCode) {
    return numericValue.toFixed(2);
  }

  return `${currencyCode.toUpperCase()} ${numericValue.toFixed(2)}`;
}

function normalizeValue(value: unknown, column: ColumnDef, row: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (item === null || item === undefined) {
          return '';
        }

        if (typeof item === 'object') {
          return JSON.stringify(item);
        }

        return String(item);
      })
      .join('; ');
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  switch (column.type) {
    case 'date':
    case 'datetime':
      return normalizeDate(value);
    case 'money':
      return normalizeMoney(value, column.currencyKey ? String(getNestedValue(row, column.currencyKey) ?? '') : undefined);
    case 'json':
      return JSON.stringify(value);
    case 'number':
      return typeof value === 'number' ? String(value) : Number.isFinite(Number(value)) ? String(value) : '';
    default:
      break;
  }

  if (typeof value === 'object') {
    return JSON.stringify(value);
  }

  return String(value);
}

function escapeCsv(value: string): string {
  const next = value.replace(/"/g, '""');
  if (/[",\n\r]/.test(next)) {
    return `"${next}"`;
  }

  return next;
}

export const csvFormatter = {
  format(data: unknown[], columns: ColumnDef[]): string {
    const rows = [
      columns.map((column) => escapeCsv(column.header)).join(','),
      ...data.map((row) =>
        columns
          .map((column) => {
            const rawValue = column.accessor ? column.accessor(row) : getNestedValue(row, column.key);
            return escapeCsv(normalizeValue(rawValue, column, row));
          })
          .join(',')
      )
    ];

    return `\uFEFF${rows.join('\r\n')}`;
  }
};
