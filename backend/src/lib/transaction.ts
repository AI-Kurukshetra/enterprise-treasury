import { logger } from '@/lib/logger';
import { getActiveRequestContext } from '@/lib/requestContext';

export async function withTransactionBoundary<T>(operation: string, callback: () => Promise<T>): Promise<T> {
  const activeContext = getActiveRequestContext();
  logger.log({
    level: 'info',
    message: 'transaction_boundary_started',
    requestId: activeContext?.requestId,
    organizationId: activeContext?.organizationId,
    actorId: activeContext?.actorId,
    domain: 'transaction_boundary',
    eventType: operation
  });

  try {
    const result = await callback();
    logger.log({
      level: 'info',
      message: 'transaction_boundary_completed',
      requestId: activeContext?.requestId,
      organizationId: activeContext?.organizationId,
      actorId: activeContext?.actorId,
      domain: 'transaction_boundary',
      eventType: operation
    });
    return result;
  } catch (error) {
    logger.log({
      level: 'error',
      message: 'transaction_boundary_failed',
      requestId: activeContext?.requestId,
      organizationId: activeContext?.organizationId,
      actorId: activeContext?.actorId,
      domain: 'transaction_boundary',
      eventType: operation,
      data: {
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    });
    throw error;
  }
}
