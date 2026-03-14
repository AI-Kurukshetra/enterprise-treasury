import { getEnv } from '@/config/env';
import { logger } from '@/lib/logger';
import type { FxProviderInterface } from '@/lib/fx-providers/fx-provider.interface';
import { EuropeanCentralBankProvider } from '@/lib/fx-providers/ecb-provider';
import { OpenExchangeRatesProvider } from '@/lib/fx-providers/open-exchange-rates-provider';

class FallbackFxProvider implements FxProviderInterface {
  constructor(private readonly providers: FxProviderInterface[]) {}

  async getRate(base: string, quote: string) {
    return this.runWithFallback((provider) => provider.getRate(base, quote), 'getRate');
  }

  async getRates(base: string) {
    return this.runWithFallback((provider) => provider.getRates(base), 'getRates');
  }

  async getSupportedCurrencies() {
    return this.runWithFallback((provider) => provider.getSupportedCurrencies(), 'getSupportedCurrencies');
  }

  private async runWithFallback<T>(
    operation: (provider: FxProviderInterface) => Promise<T>,
    operationName: string
  ): Promise<T> {
    let lastError: unknown = null;

    for (const provider of this.providers) {
      try {
        return await operation(provider);
      } catch (error) {
        lastError = error;
        logger.warn('fx_provider_fallback_triggered', {
          operation: operationName,
          provider: provider.constructor.name,
          reason: error instanceof Error ? error.message : 'Unknown provider error'
        });
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`All FX providers failed for ${operationName}`);
  }
}

export function createFxProvider(fetchImpl: typeof fetch = fetch): FxProviderInterface {
  const env = getEnv();
  const providers: FxProviderInterface[] = [];

  if (env.OPEN_EXCHANGE_RATES_APP_ID) {
    providers.push(new OpenExchangeRatesProvider(fetchImpl, env.OPEN_EXCHANGE_RATES_APP_ID));
  }

  providers.push(new EuropeanCentralBankProvider(fetchImpl));

  return new FallbackFxProvider(providers);
}
