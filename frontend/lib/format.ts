const currencyFormatterCache = new Map<string, Intl.NumberFormat>();
const DEFAULT_LOCALE = 'en-US';
const DEFAULT_TIME_ZONE = 'UTC';

function getCurrencyFormatter(currencyCode: string, locale?: string) {
  const resolvedLocale = locale ?? DEFAULT_LOCALE;
  const key = `${resolvedLocale}:${currencyCode.toUpperCase()}`;
  const cached = currencyFormatterCache.get(key);
  if (cached) {
    return cached;
  }

  const formatter = new Intl.NumberFormat(resolvedLocale, {
    style: 'currency',
    currency: currencyCode.toUpperCase(),
    maximumFractionDigits: 2
  });
  currencyFormatterCache.set(key, formatter);
  return formatter;
}

export function formatCurrency(value: number | string, currencyCode = 'USD', locale?: string) {
  const amount = typeof value === 'number' ? value : Number(value);
  return getCurrencyFormatter(currencyCode, locale).format(Number.isFinite(amount) ? amount : 0);
}

export function formatCompactCurrency(value: number | string, currencyCode = 'USD', locale?: string) {
  const amount = typeof value === 'number' ? value : Number(value);
  return new Intl.NumberFormat(locale ?? DEFAULT_LOCALE, {
    style: 'currency',
    currency: currencyCode.toUpperCase(),
    notation: 'compact',
    maximumFractionDigits: 1
  }).format(Number.isFinite(amount) ? amount : 0);
}

export function formatPercent(value: number) {
  return new Intl.NumberFormat(DEFAULT_LOCALE, {
    style: 'percent',
    maximumFractionDigits: 1,
    signDisplay: 'exceptZero'
  }).format(value);
}

export function formatDate(value: string) {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: DEFAULT_TIME_ZONE
  }).format(new Date(value));
}

export function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(DEFAULT_LOCALE, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: DEFAULT_TIME_ZONE
  }).format(new Date(value));
}

export function formatRelativeLabel(days: number) {
  if (days === 0) {
    return 'Due today';
  }
  if (days > 0) {
    return `${days} days out`;
  }
  return `${Math.abs(days)} days overdue`;
}

export function formatElapsedTime(timestamp: number, now = Date.now()) {
  if (!timestamp) {
    return 'unavailable';
  }

  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 60) {
    return `${seconds} seconds ago`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} mins ago`;
  }

  const hours = Math.floor(minutes / 60);
  return `${hours} hours ago`;
}
