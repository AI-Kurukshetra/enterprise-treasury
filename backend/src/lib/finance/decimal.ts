const DecimalPattern = /^-?\d+(?:\.\d+)?$/;

interface ParsedDecimal {
  integer: bigint;
  scale: number;
}

function parseDecimal(value: string): ParsedDecimal {
  if (!DecimalPattern.test(value)) {
    throw new Error(`Invalid decimal value: ${value}`);
  }

  const negative = value.startsWith('-');
  const normalized = negative ? value.slice(1) : value;
  const [wholePart = '0', fractionalPart = ''] = normalized.split('.');
  const digits = BigInt(`${wholePart}${fractionalPart}` || '0');

  return {
    integer: negative ? -digits : digits,
    scale: fractionalPart.length
  };
}

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function scaleInteger(value: ParsedDecimal, targetScale: number): bigint {
  if (value.scale === targetScale) {
    return value.integer;
  }

  if (value.scale > targetScale) {
    return roundScaledInteger(value.integer, value.scale, targetScale);
  }

  return value.integer * pow10(targetScale - value.scale);
}

function roundScaledInteger(value: bigint, fromScale: number, toScale: number): bigint {
  if (fromScale <= toScale) {
    return value * pow10(toScale - fromScale);
  }

  const diff = fromScale - toScale;
  const divisor = pow10(diff);
  const isNegative = value < 0n;
  const absoluteValue = isNegative ? -value : value;
  const quotient = absoluteValue / divisor;
  const remainder = absoluteValue % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;

  return isNegative ? -rounded : rounded;
}

function formatScaledInteger(value: bigint, scale: number): string {
  const isNegative = value < 0n;
  const absoluteValue = isNegative ? -value : value;
  const divisor = pow10(scale);
  const wholePart = absoluteValue / divisor;
  const fractionalPart = (absoluteValue % divisor).toString().padStart(scale, '0');

  return `${isNegative ? '-' : ''}${wholePart.toString()}.${fractionalPart}`;
}

export function normalizeDecimal(value: string, scale = 6): string {
  return formatScaledInteger(scaleInteger(parseDecimal(value), scale), scale);
}

export function sumDecimalStrings(values: string[], scale = 6): string {
  const total = values.reduce((sum, current) => sum + scaleInteger(parseDecimal(current), scale), 0n);
  return formatScaledInteger(total, scale);
}

export function multiplyDecimalStrings(left: string, right: string, scale = 6): string {
  const leftDecimal = parseDecimal(left);
  const rightDecimal = parseDecimal(right);
  const product = leftDecimal.integer * rightDecimal.integer;
  const normalized = roundScaledInteger(product, leftDecimal.scale + rightDecimal.scale, scale);
  return formatScaledInteger(normalized, scale);
}
