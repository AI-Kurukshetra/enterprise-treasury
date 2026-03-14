const DecimalPattern = /^-?\d{1,18}(\.\d{1,6})?$/;

export function compareDecimalStrings(left: string, right: string): number {
  const normalizedLeft = normalizeDecimalToMicros(left);
  const normalizedRight = normalizeDecimalToMicros(right);

  if (normalizedLeft === normalizedRight) {
    return 0;
  }

  return normalizedLeft > normalizedRight ? 1 : -1;
}

export function addDecimalStrings(left: string, right: string): string {
  return microsToDecimal(normalizeDecimalToMicros(left) + normalizeDecimalToMicros(right));
}

export function subtractDecimalStrings(left: string, right: string): string {
  return microsToDecimal(normalizeDecimalToMicros(left) - normalizeDecimalToMicros(right));
}

export function isPositiveDecimal(value: string): boolean {
  return compareDecimalStrings(value, '0') > 0;
}

export function toFixedAmount(value: string): string {
  if (!value) {
    return '';
  }

  const normalized = value.replace(/,/g, '').trim();
  if (!normalized) {
    return '';
  }

  const [integerPart = '0', fractionalPart = ''] = normalized.split('.');
  const safeInteger = integerPart.replace(/^0+(?=\d)/, '') || '0';
  const safeFraction = fractionalPart.slice(0, 2).padEnd(fractionalPart ? 2 : 0, '0');

  return safeFraction ? `${safeInteger}.${safeFraction}` : safeInteger;
}

function normalizeDecimalToMicros(value: string): bigint {
  if (!DecimalPattern.test(value)) {
    throw new Error('Invalid decimal string format');
  }

  const isNegative = value.startsWith('-');
  const normalized = isNegative ? value.slice(1) : value;
  const [integerPartRaw = '0', fractionalPartRaw = ''] = normalized.split('.');
  const integerPart = BigInt(integerPartRaw);
  const fractionalPart = BigInt(fractionalPartRaw.padEnd(6, '0').slice(0, 6) || '0');
  const scaled = (integerPart * 1_000_000n) + fractionalPart;
  return isNegative ? -scaled : scaled;
}

function microsToDecimal(value: bigint): string {
  const isNegative = value < 0n;
  const normalized = isNegative ? -value : value;
  const integerPart = normalized / 1_000_000n;
  const fractionalPart = (normalized % 1_000_000n).toString().padStart(6, '0');
  return `${isNegative ? '-' : ''}${integerPart.toString()}.${fractionalPart}`;
}
