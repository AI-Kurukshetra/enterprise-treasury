import { z } from 'zod';
import { CURRENCY_MINOR_UNITS, ISO_4217_CURRENCY_CODES } from '@/constants/currencies';

const DecimalPattern = /^-?\d{1,14}(\.\d{1,6})?$/;
const GenericDecimalPattern = /^-?\d+(\.\d+)?$/;
const DefaultScale = 6;
type DecimalLike = string | number | bigint;

export const DecimalStringSchema = z
  .string()
  .regex(DecimalPattern, 'Amount must be numeric(20,6) compatible');

export const CurrencyCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .refine((value) => ISO_4217_CURRENCY_CODES.has(value), 'Currency code must be a valid ISO 4217 alpha-3');

export function compareDecimalStrings(a: string, b: string): number {
  const normalizedA = normalizeDecimalToScale(a, DefaultScale);
  const normalizedB = normalizeDecimalToScale(b, DefaultScale);

  if (normalizedA === normalizedB) {
    return 0;
  }

  return normalizedA > normalizedB ? 1 : -1;
}

export function sumDecimalStrings(values: string[]): string {
  const total = values.reduce((sum, value) => sum + normalizeDecimalToScale(value, DefaultScale), 0n);
  return scaledIntegerToDecimal(total, DefaultScale);
}

export function maxDecimalString(a: string, b: string): string {
  return compareDecimalStrings(a, b) >= 0 ? a : b;
}

export function minDecimalString(a: string, b: string): string {
  return compareDecimalStrings(a, b) <= 0 ? a : b;
}

export function addAmounts(a: string, b: string): string {
  return sumDecimalStrings([a, b]);
}

export function multiplyAmount(amount: string, factor: number): string {
  DecimalStringSchema.parse(amount);
  if (!Number.isFinite(factor)) {
    throw new Error('Factor must be a finite number');
  }

  const scaledAmount = normalizeDecimalToScale(amount, DefaultScale);
  const scaledFactor = normalizeDecimalToScale(factor.toFixed(12), 12);
  const product = scaledAmount * scaledFactor;
  const rounded = divideAndRound(product, 10n ** 12n);
  return scaledIntegerToDecimal(rounded, DefaultScale);
}

export function convertWithRate(amount: string, rate: number): string {
  if (rate <= 0) {
    throw new Error('FX rate must be greater than zero');
  }

  return multiplyAmount(amount, rate);
}

export function formatForCurrency(amount: string, currencyCode: string): string {
  const normalizedCurrency = CurrencyCodeSchema.parse(currencyCode);
  const minorUnitScale = CURRENCY_MINOR_UNITS[normalizedCurrency] ?? 2;
  const scaledAmount = normalizeDecimalToScale(amount, DefaultScale);
  const roundingFactor = 10n ** BigInt(DefaultScale - minorUnitScale);
  const rounded = divideAndRound(scaledAmount, roundingFactor);
  return scaledIntegerToDecimal(rounded, minorUnitScale);
}

export function subtractAmounts(a: string, b: string): string {
  return addAmounts(a, negateAmount(b));
}

export function isPositiveDecimalString(amount: string): boolean {
  return compareDecimalStrings(amount, '0') > 0;
}

export function absoluteAmount(amount: string): string {
  const scaledAmount = normalizeDecimalToScale(amount, DefaultScale);
  return scaledIntegerToDecimal(scaledAmount < 0n ? -scaledAmount : scaledAmount, DefaultScale);
}

export function multiplyDecimalStrings(a: string, b: string): string {
  DecimalStringSchema.parse(a);
  DecimalStringSchema.parse(b);

  const scaledLeft = normalizeDecimalToScale(a, DefaultScale);
  const scaledRight = normalizeDecimalToScale(b, DefaultScale);
  const product = scaledLeft * scaledRight;
  const rounded = divideAndRound(product, 10n ** BigInt(DefaultScale));
  return scaledIntegerToDecimal(rounded, DefaultScale);
}

export function divideDecimalStrings(dividend: string, divisor: string, scale = DefaultScale): string {
  DecimalStringSchema.parse(dividend);
  DecimalStringSchema.parse(divisor);

  if (!Number.isInteger(scale) || scale < 0 || scale > DefaultScale) {
    throw new Error(`Scale must be an integer between 0 and ${DefaultScale}`);
  }

  const scaledDividend = normalizeDecimalToScale(dividend, DefaultScale);
  const scaledDivisor = normalizeDecimalToScale(divisor, DefaultScale);
  if (scaledDivisor === 0n) {
    throw new Error('Cannot divide by zero');
  }

  const precision = 10n ** BigInt(DefaultScale);
  const quotient = (scaledDividend * precision) / scaledDivisor;
  const normalized = scaledIntegerToDecimal(quotient, DefaultScale);
  if (scale === DefaultScale) {
    return normalized;
  }

  const [integerPart = '0', fractionalPart = ''] = normalized.split('.');
  const trimmedFraction = fractionalPart.slice(0, scale).padEnd(scale, '0');
  return scale === 0 ? integerPart : `${integerPart}.${trimmedFraction}`;
}

export function isPositiveDecimal(value: string): boolean {
  return compareDecimalStrings(value, '0') > 0;
}

export function formatDecimalString(value: string): string {
  DecimalStringSchema.parse(value);
  return scaledIntegerToDecimal(normalizeDecimalToScale(value, DefaultScale), DefaultScale);
}

export function decimalToScaledInteger(value: DecimalLike, scale = DefaultScale): bigint {
  return normalizeDecimalToScale(value, scale);
}

export function scaledIntegerToAmount(value: bigint, scale = DefaultScale): string {
  return scaledIntegerToDecimal(value, scale);
}

function normalizeDecimalToScale(value: DecimalLike, scale: number): bigint {
  const normalizedInput = normalizeDecimalInput(value);

  if (!GenericDecimalPattern.test(normalizedInput)) {
    throw new Error('Invalid decimal string format');
  }

  const isNegative = normalizedInput.startsWith('-');
  const normalized = isNegative ? normalizedInput.slice(1) : normalizedInput;
  const [integerPartRaw = '0', fractionalPartRaw = ''] = normalized.split('.');
  const integerPart = BigInt(integerPartRaw);
  const fractionalPart = BigInt(fractionalPartRaw.padEnd(scale, '0').slice(0, scale) || '0');
  const scaled = (integerPart * (10n ** BigInt(scale))) + fractionalPart;
  return isNegative ? -scaled : scaled;
}

function normalizeDecimalInput(value: DecimalLike): string {
  if (typeof value === 'string') {
    return value.trim();
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('Invalid decimal value');
    }

    return value.toString();
  }

  return value.toString();
}

function scaledIntegerToDecimal(value: bigint, scale: number): string {
  const isNegative = value < 0n;
  const normalized = isNegative ? -value : value;
  const divisor = 10n ** BigInt(scale);
  const integerPart = normalized / divisor;
  if (scale === 0) {
    return `${isNegative ? '-' : ''}${integerPart.toString()}`;
  }

  const fractionalPart = (normalized % divisor).toString().padStart(scale, '0');
  return `${isNegative ? '-' : ''}${integerPart.toString()}.${fractionalPart}`;
}

function divideAndRound(value: bigint, divisor: bigint): bigint {
  const isNegative = value < 0n;
  const normalized = isNegative ? -value : value;
  const quotient = normalized / divisor;
  const remainder = normalized % divisor;
  const rounded = remainder * 2n >= divisor ? quotient + 1n : quotient;
  return isNegative ? -rounded : rounded;
}

function negateAmount(amount: string): string {
  const scaledAmount = normalizeDecimalToScale(amount, DefaultScale);
  return scaledIntegerToDecimal(-scaledAmount, DefaultScale);
}
