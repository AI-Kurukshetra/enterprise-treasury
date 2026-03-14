import { AppError } from '@/errors/AppError';

export class PaymentExecutionError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, {
      statusCode: 422,
      code: 'PAYMENT_EXECUTION_ERROR',
      details
    });
  }
}
