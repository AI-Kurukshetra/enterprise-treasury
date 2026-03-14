import { z } from 'zod';
import { CurrencyCodeSchema, DecimalStringSchema } from '@/utils/money';

const PoolTypeSchema = z.enum(['physical', 'notional']);
const SweepFrequencySchema = z.enum(['daily', 'weekly', 'monthly']);

const PoolAccountInputSchema = z.object({
  bankAccountId: z.string().uuid(),
  priority: z.coerce.number().int().positive().max(10_000).optional()
});

export const CreatePoolInputSchema = z.object({
  name: z.string().trim().min(1).max(140),
  poolType: PoolTypeSchema,
  baseCurrency: CurrencyCodeSchema,
  accounts: z.array(PoolAccountInputSchema).min(1)
});

export const UpdatePoolInputSchema = z
  .object({
    name: z.string().trim().min(1).max(140).optional(),
    poolType: PoolTypeSchema.optional(),
    baseCurrency: CurrencyCodeSchema.optional(),
    accounts: z.array(PoolAccountInputSchema).min(1).optional()
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'At least one pool attribute must be provided'
  });

export const CreateSweepingRuleInputSchema = z.object({
  poolId: z.string().uuid(),
  ruleName: z.string().trim().min(1).max(140),
  sourceAccountId: z.string().uuid(),
  targetAccountId: z.string().uuid(),
  minBalance: DecimalStringSchema,
  targetBalance: DecimalStringSchema,
  maxTransfer: DecimalStringSchema,
  frequency: SweepFrequencySchema,
  isActive: z.boolean().optional()
});

export const CreateIntercompanyLoanInputSchema = z.object({
  lenderEntityId: z.string().uuid(),
  borrowerEntityId: z.string().uuid(),
  amount: DecimalStringSchema,
  currencyCode: CurrencyCodeSchema,
  interestRate: DecimalStringSchema.optional(),
  maturityDate: z.string().date().optional()
});

export const ListPoolsQuerySchema = z.object({
  poolType: PoolTypeSchema.optional(),
  baseCurrency: CurrencyCodeSchema.optional()
});

export const LiquidityPositionQuerySchema = z.object({
  poolId: z.string().uuid().optional(),
  region: z.string().trim().min(2).max(32).optional(),
  currencyCode: CurrencyCodeSchema.optional()
});

export type CreatePoolInput = z.infer<typeof CreatePoolInputSchema>;
export type UpdatePoolInput = z.infer<typeof UpdatePoolInputSchema>;
export type CreateSweepingRuleInput = z.infer<typeof CreateSweepingRuleInputSchema>;
export type CreateIntercompanyLoanInput = z.infer<typeof CreateIntercompanyLoanInputSchema>;
export type ListPoolsQuery = z.infer<typeof ListPoolsQuerySchema>;
export type LiquidityPositionQuery = z.infer<typeof LiquidityPositionQuerySchema>;
