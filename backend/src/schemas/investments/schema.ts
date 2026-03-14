import { z } from 'zod';
import { CurrencyCodeSchema, DecimalStringSchema } from '@/utils/money';

export const ListInvestmentsQuerySchema = z.object({
  status: z.enum(['active', 'matured', 'redeemed']).optional(),
  maturityFrom: z.string().date().optional(),
  maturityTo: z.string().date().optional(),
  instrumentType: z.string().min(1).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export const CreateInvestmentRequestSchema = z.object({
  instrumentName: z.string().min(1).max(140),
  instrumentType: z.string().min(1).max(40),
  principalAmount: DecimalStringSchema,
  currencyCode: CurrencyCodeSchema,
  startDate: z.string().date(),
  maturityDate: z.string().date(),
  rate: DecimalStringSchema.optional()
});
