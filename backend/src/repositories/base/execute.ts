import { AppError } from '@/errors/AppError';
import { ConflictError } from '@/errors/ConflictError';
import { ValidationError } from '@/errors/ValidationError';

interface QueryErrorShape {
  message: string;
  code?: string;
}

export function assertNoQueryError(error: QueryErrorShape | null): void {
  if (error) {
    if (error.code === '23505') {
      throw new ConflictError('Database conflict', {
        reason: error.message
      });
    }

    if (error.code === '23503' || error.code === '23514' || error.code === '22000') {
      throw new ValidationError('Database validation failed', {
        reason: error.message
      });
    }

    throw new AppError('Database query failed', {
      statusCode: 500,
      code: 'SYSTEM_DATABASE_ERROR',
      details: {
        reason: error.message
      }
    });
  }
}
