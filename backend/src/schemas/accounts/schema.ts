import { z } from 'zod';
import { CurrencyCodeSchema } from '@/utils/money';

export const AccountStatusSchema = z.enum(['active', 'dormant', 'closed']);

export const ListAccountsQuerySchema = z.object({
  status: AccountStatusSchema.optional(),
  currencyCode: CurrencyCodeSchema.optional(),
  bankConnectionId: z.string().uuid().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).optional()
});

export const CreateAccountRequestSchema = z.object({
  bankConnectionId: z.string().uuid(),
  accountName: z.string().min(1).max(120),
  accountNumberMasked: z.string().min(4).max(34),
  currencyCode: CurrencyCodeSchema
});

export const UpdateAccountRequestSchema = z
  .object({
    accountName: z.string().min(1).max(120).optional(),
    status: AccountStatusSchema.optional()
  })
  .refine((value) => value.accountName !== undefined || value.status !== undefined, {
    message: 'At least one field must be provided'
  });
