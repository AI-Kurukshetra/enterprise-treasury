import { AppError } from '@/errors/AppError';

export class AuthorizationError extends AppError {
  constructor(message = 'Not authorized', details?: Record<string, unknown>) {
    super(message, {
      statusCode: 403,
      code: 'ACCESS_DENIED',
      details
    });
  }
}
