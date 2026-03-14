import { z } from 'zod';

export const LatestCashPositionQuerySchema = z.object({});

export const CashPositionHistoryQuerySchema = z.object({
  days: z.coerce.number().int().positive().max(365).default(30),
  granularity: z.enum(['daily']).default('daily')
});
