import { describe, expect, it } from 'vitest';
import { AppError } from '@/errors/AppError';
import { ConflictError } from '@/errors/ConflictError';
import { ValidationError } from '@/errors/ValidationError';
import { assertNoQueryError } from '@/repositories/base/execute';

describe('assertNoQueryError', () => {
  it('allows successful queries to pass through', () => {
    expect(() => assertNoQueryError(null)).not.toThrow();
  });

  it('maps unique constraint violations to conflict errors', () => {
    expect(() => assertNoQueryError({ code: '23505', message: 'duplicate key value' })).toThrow(ConflictError);
  });

  it.each(['23503', '23514', '22000'])('maps validation database errors for code %s', (code) => {
    expect(() => assertNoQueryError({ code, message: 'invalid row' })).toThrow(ValidationError);
  });

  it('maps unknown database errors to system app errors', () => {
    try {
      assertNoQueryError({ code: 'XX001', message: 'disk failure' });
      throw new Error('expected error');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('SYSTEM_DATABASE_ERROR');
    }
  });
});
