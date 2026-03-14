import { z } from 'zod';
import { PAYMENT_STATUSES } from '@/constants/financial';
import { CurrencyCodeSchema, DecimalStringSchema } from '@/utils/money';

export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);

export const CreatePaymentRequestSchema = z.object({
  paymentReference: z.string().min(1).max(80),
  sourceAccountId: z.string().uuid(),
  beneficiaryCounterpartyId: z.string().uuid(),
  amount: DecimalStringSchema,
  currencyCode: CurrencyCodeSchema,
  valueDate: z.string().date(),
  purpose: z.string().max(280).optional()
});

export const ListPaymentsQuerySchema = z.object({
  status: PaymentStatusSchema.optional(),
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional(),
  accountId: z.string().uuid().optional(),
  minAmount: DecimalStringSchema.optional(),
  maxAmount: DecimalStringSchema.optional(),
  beneficiaryId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export const UpdatePaymentStatusRequestSchema = z.object({
  status: PaymentStatusSchema,
  reason: z.string().max(280).optional()
});
