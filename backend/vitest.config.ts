import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const rootDir = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(rootDir, 'src'),
      '@api': resolve(rootDir, 'api')
    }
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'api/**/*.test.ts', 'tests/**/*.test.ts'],
    setupFiles: ['tests/setup/vitest.setup.ts'],
    clearMocks: true,
    restoreMocks: true,
    testTimeout: 15_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: 'coverage',
      include: [
        'src/api/*.ts',
        'src/errors/**/*.ts',
        'src/lib/errorTracking.ts',
        'src/lib/http.ts',
        'src/lib/logger.ts',
        'src/lib/metrics.ts',
        'src/lib/requestContext.ts',
        'src/lib/tracing.ts',
        'src/lib/transaction.ts',
        'src/middleware/**/*.ts',
        'src/repositories/base/**/*.ts',
        'src/repositories/accounts/**/*.ts',
        'src/repositories/cash_positions/**/*.ts',
        'src/repositories/payments/**/*.ts',
        'src/repositories/transactions/**/*.ts',
        'src/services/approvals/service.ts',
        'src/services/cash_positions/service.ts',
        'src/services/investments/service.ts',
        'src/services/payments/service.ts',
        'src/services/risk/service.ts',
        'src/services/transactions/service.ts',
        'src/utils/**/*.ts',
        'api/v1/accounts/**/*.ts',
        'api/v1/approvals/**/*.ts',
        'api/v1/auth/login/route.ts',
        'api/v1/cash-positions/**/*.ts',
        'api/v1/forecasts/route.ts',
        'api/v1/investments/**/*.ts',
        'api/v1/payments/route.ts',
        'api/v1/transactions/**/*.ts'
      ],
      exclude: [
        'src/**/*.test.ts',
        'api/**/*.test.ts',
        'src/types/**',
        'src/schemas/**',
        'src/constants/**',
        'src/config/**',
        'src/middleware/types.ts',
        'api/v1/accounts/[accountId]/**',
        'api/v1/approvals/[paymentId]/reject/**',
        'api/v1/investments/[investmentId]/**',
        'api/v1/transactions/[transactionId]/reconcile/**'
      ]
    }
  }
});
