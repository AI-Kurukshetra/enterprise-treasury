import { z } from 'zod';
import { CurrencyCodeSchema, DecimalStringSchema } from '@/utils/money';

export const CreateDebtFacilityRequestSchema = z.object({
  facilityName: z.string().min(1).max(120),
  facilityType: z.enum(['revolver', 'term_loan', 'overdraft']),
  lenderCounterpartyId: z.string().uuid(),
  limitAmount: DecimalStringSchema,
  currencyCode: CurrencyCodeSchema
});

export const ListDebtFacilitiesQuerySchema = z.object({
  status: z.enum(['active', 'suspended', 'closed']).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});
