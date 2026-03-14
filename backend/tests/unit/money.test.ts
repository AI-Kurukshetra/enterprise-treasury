import { describe, expect, it } from 'vitest';
import {
  CurrencyCodeSchema,
  compareDecimalStrings,
  isPositiveDecimalString,
  minDecimalString,
  subtractAmounts,
  sumDecimalStrings
} from '@/utils/money';

describe('money utilities', () => {
  it('compares numeric strings by value instead of lexicographic order', () => {
    expect(compareDecimalStrings('10.000000', '2.000000')).toBe(1);
    expect(compareDecimalStrings('2.000000', '10.000000')).toBe(-1);
    expect(compareDecimalStrings('-5.500000', '-5.600000')).toBe(1);
    expect(compareDecimalStrings('1.230000', '1.23')).toBe(0);
  });

  it('sums decimal strings without losing numeric(20,6) precision', () => {
    expect(sumDecimalStrings(['100.100001', '0.000009', '-50.000000'])).toBe('50.100010');
  });

  it('supports subtraction, minimum comparison, and positive checks', () => {
    expect(subtractAmounts('126.000000', '1.250000')).toBe('124.750000');
    expect(minDecimalString('124.750000', '125.000000')).toBe('124.750000');
    expect(isPositiveDecimalString('0.000001')).toBe(true);
    expect(isPositiveDecimalString('0.000000')).toBe(false);
  });

  it('accepts only ISO-style alpha-3 currency codes', () => {
    expect(CurrencyCodeSchema.parse('usd')).toBe('USD');
    expect(() => CurrencyCodeSchema.parse('US1')).toThrow(/alpha-3/);
  });
});
