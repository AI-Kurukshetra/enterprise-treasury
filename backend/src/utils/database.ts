interface PostgrestErrorLike {
  code?: string | null;
  message?: string | null;
  details?: string | null;
  hint?: string | null;
}

function isPostgrestErrorLike(error: unknown): error is PostgrestErrorLike {
  return Boolean(error) && typeof error === 'object';
}

function matchesErrorText(error: PostgrestErrorLike, patterns: string[]) {
  const haystack = `${error.message ?? ''}\n${error.details ?? ''}\n${error.hint ?? ''}`.toLowerCase();
  return patterns.every((pattern) => haystack.includes(pattern.toLowerCase()));
}

export function coerceString(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value.toString();
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  return null;
}

export function coerceDecimalString(value: unknown, fallback = '0.000000'): string {
  return coerceString(value) ?? fallback;
}

export function isMissingColumnError(error: unknown, columnName: string): boolean {
  if (!isPostgrestErrorLike(error)) {
    return false;
  }

  return error.code === '42703' || matchesErrorText(error, [columnName, 'column']);
}

export function isMissingRelationError(error: unknown, relationName: string): boolean {
  if (!isPostgrestErrorLike(error)) {
    return false;
  }

  return error.code === '42P01' || matchesErrorText(error, [relationName]);
}
