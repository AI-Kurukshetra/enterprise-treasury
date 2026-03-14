import { ZodError } from 'zod';
import { AppError } from '@/errors/AppError';
import type { ApiErrorResponse, ApiMeta } from '@/types/api';

export function toApiError(error: unknown, meta: ApiMeta): ApiErrorResponse {
  if (error instanceof AppError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      },
      meta
    };
  }

  if (error instanceof ZodError) {
    return {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: {
          issues: error.issues
        }
      },
      meta
    };
  }

  return {
    error: {
      code: 'SYSTEM_UNEXPECTED_ERROR',
      message: 'An unexpected error occurred'
    },
    meta
  };
}

export function getStatusCode(error: unknown): number {
  if (error instanceof AppError) {
    return error.statusCode;
  }
  if (error instanceof ZodError) {
    return 400;
  }
  return 500;
}
