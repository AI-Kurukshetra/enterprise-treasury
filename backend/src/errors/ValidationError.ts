import { AppError } from '@/errors/AppError';

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      statusCode: 400,
      code: 'VALIDATION_ERROR',
      details
    });
  }
}
