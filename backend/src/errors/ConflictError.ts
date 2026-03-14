import { AppError } from '@/errors/AppError';

export class ConflictError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      statusCode: 409,
      code: 'CONFLICT',
      details
    });
  }
}
