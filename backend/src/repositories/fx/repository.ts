import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, type RepositoryContext } from '@/repositories/base/repository';
import { assertNoQueryError } from '@/repositories/base/execute';
import type { CurrencyRateRow, HedgingInstrument } from '@/types/fx/types';
import type { RiskExposure } from '@/types/risk/types';
import { isMissingRelationError } from '@/utils/database';

interface OrganizationRow {
  base_currency: string;
}

function toAsOfUpperBound(asOf: string): string {
  return asOf.includes('T') ? asOf : `${asOf}T23:59:59.999Z`;
}

export class FxRepository extends BaseRepository {
  constructor(context: RepositoryContext, dbClient?: SupabaseClient) {
    super(context, dbClient);
  }

  async getOrganizationBaseCurrency(organizationId = this.context.organizationId): Promise<string | null> {
    const { data, error } = await this.db
      .from('organizations')
      .select('base_currency')
      .eq('id', organizationId)
      .maybeSingle();

    assertNoQueryError(error);
    return ((data as OrganizationRow | null) ?? null)?.base_currency ?? null;
  }

  async getLatestRate(baseCurrency: string, quoteCurrency: string, asOf?: string): Promise<CurrencyRateRow | null> {
    let query = this.db
      .from('currency_rates')
      .select('*')
      .eq('base_currency', baseCurrency)
      .eq('quote_currency', quoteCurrency);

    if (asOf) {
      query = query.lte('as_of_at', toAsOfUpperBound(asOf));
    }

    const { data, error } = await query.order('as_of_at', { ascending: false }).limit(1).maybeSingle();
    if (error) {
      if (isMissingRelationError(error, 'currency_rates')) {
        return null;
      }
      assertNoQueryError(error);
    }

    if (data) {
      return data as CurrencyRateRow;
    }

    if (!asOf) {
      return null;
    }

    const fallback = await this.db
      .from('currency_rates')
      .select('*')
      .eq('base_currency', baseCurrency)
      .eq('quote_currency', quoteCurrency)
      .order('as_of_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (fallback.error) {
      if (isMissingRelationError(fallback.error, 'currency_rates')) {
        return null;
      }
      assertNoQueryError(fallback.error);
    }

    return (fallback.data as CurrencyRateRow | null) ?? null;
  }

  async listLatestRates(baseCurrency: string, asOf?: string): Promise<CurrencyRateRow[]> {
    let query = this.db
      .from('currency_rates')
      .select('*')
      .eq('base_currency', baseCurrency);

    if (asOf) {
      query = query.lte('as_of_at', toAsOfUpperBound(asOf));
    }

    const { data, error } = await query
      .order('quote_currency', { ascending: true })
      .order('as_of_at', { ascending: false })
      .limit(500);

    if (error) {
      if (isMissingRelationError(error, 'currency_rates')) {
        return [];
      }
      assertNoQueryError(error);
    }
    return (data ?? []) as CurrencyRateRow[];
  }

  async upsertRates(rates: CurrencyRateRow[]): Promise<void> {
    if (rates.length === 0) {
      return;
    }

    const { error } = await this.db
      .from('currency_rates')
      .upsert(rates, { onConflict: 'base_currency,quote_currency,provider,as_of_at' });

    if (error) {
      if (isMissingRelationError(error, 'currency_rates')) {
        return;
      }
      assertNoQueryError(error);
    }
  }

  async listFxExposures(organizationId = this.context.organizationId): Promise<RiskExposure[]> {
    const { data, error } = await this.db
      .from('risk_exposures')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('risk_type', 'fx')
      .order('reference_date', { ascending: false })
      .limit(500);

    assertNoQueryError(error);
    return (data ?? []) as RiskExposure[];
  }

  async getExposureById(exposureId: string, organizationId = this.context.organizationId): Promise<RiskExposure | null> {
    const { data, error } = await this.db
      .from('risk_exposures')
      .select('*')
      .eq('organization_id', organizationId)
      .eq('id', exposureId)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as RiskExposure | null) ?? null;
  }

  async listActiveHedges(organizationId = this.context.organizationId): Promise<HedgingInstrument[]> {
    const { data, error } = await this.db
      .from('hedging_instruments')
      .select('*')
      .eq('organization_id', organizationId)
      .in('status', ['active'])
      .order('maturity_date', { ascending: true })
      .limit(500);

    assertNoQueryError(error);
    return (data ?? []) as HedgingInstrument[];
  }
}
