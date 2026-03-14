import { z } from 'zod';
import { CurrencyCodeSchema, DecimalStringSchema } from '@/utils/money';

export const CreateTransactionRequestSchema = z.object({
  bankAccountId: z.string().uuid(),
  bookingDate: z.string().date(),
  valueDate: z.string().date().optional(),
  amount: DecimalStringSchema,
  currencyCode: CurrencyCodeSchema,
  direction: z.enum(['inflow', 'outflow']),
  description: z.string().max(280).optional(),
  dedupeHash: z.string().min(10).max(128)
});

export const ListTransactionsQuerySchema = z.object({
  accountId: z.string().uuid().optional(),
  direction: z.enum(['inflow', 'outflow']).optional(),
  reconciliationStatus: z.enum(['unreconciled', 'partially_reconciled', 'reconciled', 'exception']).optional(),
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional(),
  minAmount: DecimalStringSchema.optional(),
  maxAmount: DecimalStringSchema.optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export const ReconcileTransactionRequestSchema = z.object({
  reconciliationReference: z.string().min(1).max(120)
});
