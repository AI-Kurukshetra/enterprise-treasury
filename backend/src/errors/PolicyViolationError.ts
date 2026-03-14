import { AppError } from '@/errors/AppError';
import type { PolicyViolation } from '@/lib/policy-engine/policy-types';

export class PolicyViolationError extends AppError {
  constructor(message: string, violations: PolicyViolation[]) {
    super(message, {
      statusCode: 422,
      code: 'POLICY_VIOLATION',
      details: {
        violations
      }
    });
  }
}
