import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { compareDecimalStrings, sumDecimalStrings } from '@/utils/money';
import { addDecimalStrings, convertAtRate } from '../utils/finance';

const decimalArbitrary = fc
  .tuple(
    fc.boolean(),
    fc.integer({ min: 0, max: 999_999_999 }),
    fc.integer({ min: 0, max: 999_999 })
  )
  .map(([negative, integerPart, fractionPart]) => {
    const value = `${integerPart}.${fractionPart.toString().padStart(6, '0')}`;
    return negative && value !== '0.000000' ? `-${value}` : value;
  });

describe('financial invariants', () => {
  it('keeps decimal comparison antisymmetric', () => {
    fc.assert(
      fc.property(decimalArbitrary, decimalArbitrary, (left, right) => {
        const comparison = compareDecimalStrings(left, right);
        const inverse = compareDecimalStrings(right, left);
        expect(comparison).toBe(-inverse);
      })
    );
  });

  it('keeps decimal summation order-independent', () => {
    fc.assert(
      fc.property(fc.array(decimalArbitrary, { minLength: 1, maxLength: 25 }), (values) => {
        expect(sumDecimalStrings(values)).toBe(sumDecimalStrings([...values].reverse()));
      })
    );
  });

  it('keeps deterministic currency conversion for the same input and rate', () => {
    fc.assert(
      fc.property(decimalArbitrary.filter((value) => !value.startsWith('-')), decimalArbitrary.filter((value) => !value.startsWith('-')), (amount, rate) => {
        const sanitizedRate = compareDecimalStrings(rate, '0') === 0 ? '1.000000' : rate;
        expect(convertAtRate(amount, sanitizedRate)).toBe(convertAtRate(amount, sanitizedRate));
        expect(addDecimalStrings([amount, '0.000000'])).toBe(amount);
      })
    );
  });
});
