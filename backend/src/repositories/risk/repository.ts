import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, type RepositoryContext } from '@/repositories/base/repository';
import { assertNoQueryError } from '@/repositories/base/execute';
import { JobQueue } from '@/lib/job-queue/job-queue';
import type { RiskExposure } from '@/types/risk/types';
import { coerceDecimalString } from '@/utils/database';

export interface RiskExposureFilters {
  riskType?: RiskExposure['risk_type'];
  date?: string;
  currency?: string;
}

export interface ReplaceRiskExposureInput {
  riskType: RiskExposure['risk_type'];
  currencyCode: string | null;
  exposureAmount: string;
  status: RiskExposure['status'];
  details: Record<string, unknown>;
}

function normalizeRiskExposure(row: RiskExposure): RiskExposure {
  return {
    ...row,
    exposure_amount: coerceDecimalString((row as unknown as Record<string, unknown>).exposure_amount)
  };
}

export class RiskRepository extends BaseRepository {
  private readonly queue: JobQueue;

  constructor(context: RepositoryContext, dbClient?: SupabaseClient, queue?: JobQueue) {
    super(context, dbClient);
    this.queue = queue ?? new JobQueue(this.db);
  }

  async listLatestExposures(filters: RiskExposureFilters = {}): Promise<RiskExposure[]> {
    const referenceDate = filters.date ?? (await this.getLatestReferenceDate());
    if (!referenceDate) {
      return [];
    }

    let query = this.db
      .from('risk_exposures')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .eq('reference_date', referenceDate)
      .order('risk_type', { ascending: true })
      .order('currency_code', { ascending: true, nullsFirst: false })
      .order('updated_at', { ascending: false });

    if (filters.riskType) {
      query = query.eq('risk_type', filters.riskType);
    }

    if (filters.currency) {
      query = query.eq('currency_code', filters.currency);
    }

    const { data, error } = await query;
    assertNoQueryError(error);
    return ((data ?? []) as RiskExposure[]).map(normalizeRiskExposure);
  }

  async getLatestReferenceDate(): Promise<string | null> {
    const { data, error } = await this.db
      .from('risk_exposures')
      .select('reference_date')
      .eq('organization_id', this.context.organizationId)
      .order('reference_date', { ascending: false })
      .limit(1)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as { reference_date: string } | null)?.reference_date ?? null;
  }

  async getLastCalculatedAt(): Promise<string | null> {
    const { data, error } = await this.db
      .from('risk_exposures')
      .select('updated_at')
      .eq('organization_id', this.context.organizationId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as { updated_at: string } | null)?.updated_at ?? null;
  }

  async replaceExposures(referenceDate: string, exposures: ReplaceRiskExposureInput[]): Promise<void> {
    const { error: deleteError } = await this.db
      .from('risk_exposures')
      .delete()
      .eq('organization_id', this.context.organizationId)
      .eq('reference_date', referenceDate);

    assertNoQueryError(deleteError);

    if (exposures.length === 0) {
      return;
    }

    const { error: insertError } = await this.db.from('risk_exposures').insert(
      exposures.map((exposure) => ({
        organization_id: this.context.organizationId,
        risk_type: exposure.riskType,
        reference_date: referenceDate,
        currency_code: exposure.currencyCode,
        exposure_amount: exposure.exposureAmount,
        status: exposure.status,
        details: exposure.details
      }))
    );

    assertNoQueryError(insertError);
  }

  async queueRecalculation(referenceDate: string): Promise<{ jobId: string }> {
    const jobId = await this.queue.enqueue(
      'risk.recalculate',
      { referenceDate },
      {
        organizationId: this.context.organizationId,
        maxAttempts: 3
      }
    );

    return { jobId };
  }
}
