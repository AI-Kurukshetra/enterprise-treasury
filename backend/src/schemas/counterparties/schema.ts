import { z } from 'zod';

export const CounterpartyTypeSchema = z.enum(['customer', 'vendor', 'bank', 'affiliate', 'other']);

export const ListCounterpartiesQuerySchema = z.object({
  type: CounterpartyTypeSchema.optional(),
  search: z.string().trim().min(1).max(120).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});
