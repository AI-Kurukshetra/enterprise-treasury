import { AppError } from '@/errors/AppError';

export class NotFoundError extends AppError {
  constructor(message = 'Resource not found', details?: Record<string, unknown>) {
    super(message, {
      statusCode: 404,
      code: 'NOT_FOUND',
      details
    });
  }
}
