import type { FxRate } from '@/types/fx/types';

export interface FxProviderInterface {
  getRate(base: string, quote: string): Promise<FxRate>;
  getRates(base: string): Promise<Record<string, FxRate>>;
  getSupportedCurrencies(): Promise<string[]>;
}
