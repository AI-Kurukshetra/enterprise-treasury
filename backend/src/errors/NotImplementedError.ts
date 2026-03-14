import { AppError } from '@/errors/AppError';

export class NotImplementedError extends AppError {
  constructor(message: string) {
    super(message, {
      statusCode: 501,
      code: 'SYSTEM_NOT_IMPLEMENTED'
    });
  }
}
