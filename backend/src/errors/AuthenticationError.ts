import { AppError } from '@/errors/AppError';

export class AuthenticationError extends AppError {
  constructor(message = 'Authentication failed', details?: Record<string, unknown>) {
    super(message, {
      statusCode: 401,
      code: 'AUTHENTICATION_FAILED',
      details
    });
  }
}
