import { z } from 'zod';

const EnvSchema = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  ALLOWED_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3002'),
  BACKEND_PORT: z.string().default('3001'),
  JWT_SECRET: z.string().min(32).optional(),
  OPEN_EXCHANGE_RATES_APP_ID: z.string().optional(),
  FX_CACHE_TTL_HOURS: z.coerce.number().default(4),
  ORG_BASE_CURRENCY: z.string().length(3).default('USD'),
  NOTIFICATIONS_EMAIL_ENABLED: z.coerce.boolean().default(false),
  NOTIFICATIONS_WEBHOOK_URL: z.string().url().optional(),
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-3-7-sonnet-latest'),
  ANTHROPIC_MAX_TOKENS: z.coerce.number().int().positive().default(1_024),
  COPILOT_ENCRYPTION_KEY: z.string().min(32).optional(),
  ANTHROPIC_INPUT_COST_PER_MILLION_TOKENS: z.coerce.number().nonnegative().default(0),
  ANTHROPIC_OUTPUT_COST_PER_MILLION_TOKENS: z.coerce.number().nonnegative().default(0)
});

export type AppEnv = z.infer<typeof EnvSchema>;

let cachedEnv: AppEnv | null = null;

export function getEnv(): AppEnv {
  if (cachedEnv) {
    return cachedEnv;
  }

  cachedEnv = EnvSchema.parse({
    SUPABASE_URL: process.env.SUPABASE_URL,
    SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    NODE_ENV: process.env.NODE_ENV,
    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS,
    BACKEND_PORT: process.env.BACKEND_PORT,
    JWT_SECRET: process.env.JWT_SECRET,
    OPEN_EXCHANGE_RATES_APP_ID: process.env.OPEN_EXCHANGE_RATES_APP_ID,
    FX_CACHE_TTL_HOURS: process.env.FX_CACHE_TTL_HOURS,
    ORG_BASE_CURRENCY: process.env.ORG_BASE_CURRENCY,
    NOTIFICATIONS_EMAIL_ENABLED: process.env.NOTIFICATIONS_EMAIL_ENABLED,
    NOTIFICATIONS_WEBHOOK_URL: process.env.NOTIFICATIONS_WEBHOOK_URL,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL,
    ANTHROPIC_MAX_TOKENS: process.env.ANTHROPIC_MAX_TOKENS,
    COPILOT_ENCRYPTION_KEY: process.env.COPILOT_ENCRYPTION_KEY,
    ANTHROPIC_INPUT_COST_PER_MILLION_TOKENS: process.env.ANTHROPIC_INPUT_COST_PER_MILLION_TOKENS,
    ANTHROPIC_OUTPUT_COST_PER_MILLION_TOKENS: process.env.ANTHROPIC_OUTPUT_COST_PER_MILLION_TOKENS
  });

  return cachedEnv;
}

const AllowedOriginSchema = z.string().url().transform((value) => new URL(value).origin);

export function getAllowedOrigins(): string[] {
  const { ALLOWED_ORIGINS } = getEnv();
  return Array.from(
    new Set(
      ALLOWED_ORIGINS.split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0)
        .map((origin) => AllowedOriginSchema.parse(origin))
    )
  );
}

export function resetEnvCache(): void {
  cachedEnv = null;
}
