import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, type RepositoryContext } from '@/repositories/base/repository';
import { applyCursorPagination } from '@/repositories/base/query';
import { assertNoQueryError } from '@/repositories/base/execute';
import type { PaginatedResult, PaginationInput } from '@/types/common';
import type {
  CreateForecastInput,
  Forecast,
  ForecastAccuracyMetric,
  ForecastDetail,
  ForecastGenerationStatus,
  ForecastLine
} from '@/types/forecasts/types';
import { resolveLimit, toNextCursor } from '@/utils/pagination';

type ForecastStatus = Forecast['status'];

interface ForecastRecordOptions {
  startDate: string;
  endDate: string;
  name: string;
  generationStatus: ForecastGenerationStatus;
  estimatedTimeSeconds: number;
  scenarioName: string;
  notes?: string;
  baseForecastId?: string | null;
  scenarioParameters?: Record<string, unknown>;
  generationJobId?: string | null;
}

export interface ForecastFilters {
  type?: Forecast['forecast_type'];
  status?: ForecastStatus;
  generationStatus?: ForecastGenerationStatus;
  fromDate?: string;
  toDate?: string;
}

export interface ForecastContextTransactionRow {
  booking_date: string;
  amount: string;
  currency_code: string;
  direction: 'inflow' | 'outflow';
  description: string | null;
}

export interface ForecastContextPaymentRow {
  id: string;
  payment_reference: string;
  amount: string;
  currency_code: string;
  value_date: string;
  status: string;
  purpose: string | null;
}

export interface ForecastContextDebtRow {
  id: string;
  debt_facility_id: string;
  due_date: string;
  principal_due: string;
  interest_due: string;
  status: string;
  debt_facilities: {
    facility_name: string;
    currency_code: string;
  } | null;
}

export interface ForecastContextInvestmentRow {
  id: string;
  instrument_name: string;
  instrument_type: string;
  principal_amount: string;
  currency_code: string;
  maturity_date: string;
  status: string;
}

export interface ForecastContextSweepRuleRow {
  id: string;
  source_account_id: string;
  target_account_id: string;
  min_balance: string;
  target_balance: string;
  frequency: string;
  is_active: boolean;
}

export interface ForecastCashPositionRow {
  currency_code: string;
  available_balance: string;
  current_balance: string;
  as_of_at: string;
}

export interface ForecastPolicyRow {
  rules: Record<string, unknown> | null;
}

export interface ForecastLineInsert {
  forecast_date: string;
  projected_inflow: string;
  projected_outflow: string;
  projected_net: string;
  cumulative_balance: string;
  confidence_score: string;
  key_drivers: string[];
  balance_low: string;
  balance_high: string;
  scenario?: string;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeJsonObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, unknown>;
}

function toForecast(row: Record<string, unknown>): Forecast {
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    name: String(row.name),
    forecast_type: row.forecast_type as Forecast['forecast_type'],
    start_date: String(row.start_date),
    end_date: String(row.end_date),
    horizon_days: typeof row.horizon_days === 'number' ? row.horizon_days : row.horizon_days == null ? null : Number(row.horizon_days),
    currency_code: String(row.currency_code),
    model_type: row.model_type as Forecast['model_type'],
    model_version: String(row.model_version),
    confidence_score: row.confidence_score == null ? null : String(row.confidence_score),
    status: row.status as Forecast['status'],
    scenario_name: String(row.scenario_name ?? 'base'),
    notes: row.notes == null ? null : String(row.notes),
    base_forecast_id: row.base_forecast_id == null ? null : String(row.base_forecast_id),
    scenario_parameters: normalizeJsonObject(row.scenario_parameters),
    generation_status: row.generation_status as ForecastGenerationStatus,
    generation_job_id: row.generation_job_id == null ? null : String(row.generation_job_id),
    generation_error: row.generation_error == null ? null : String(row.generation_error),
    estimated_time_seconds:
      typeof row.estimated_time_seconds === 'number'
        ? row.estimated_time_seconds
        : row.estimated_time_seconds == null
          ? null
          : Number(row.estimated_time_seconds),
    generated_at: row.generated_at == null ? null : String(row.generated_at),
    ai_summary: row.ai_summary == null ? null : String(row.ai_summary),
    key_risks: normalizeStringArray(row.key_risks),
    recommended_actions: normalizeStringArray(row.recommended_actions),
    prompt_context: normalizeJsonObject(row.prompt_context),
    few_shot_examples: Array.isArray(row.few_shot_examples) ? row.few_shot_examples : [],
    accuracy_score: row.accuracy_score == null ? null : String(row.accuracy_score),
    accuracy_details: normalizeJsonObject(row.accuracy_details),
    published_at: row.published_at == null ? null : String(row.published_at),
    published_by: row.published_by == null ? null : String(row.published_by),
    created_by: String(row.created_by),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

function toForecastLine(row: Record<string, unknown>): ForecastLine {
  return {
    id: String(row.id),
    organization_id: String(row.organization_id),
    forecast_id: String(row.forecast_id),
    forecast_date: String(row.forecast_date),
    projected_inflow: String(row.projected_inflow),
    projected_outflow: String(row.projected_outflow),
    projected_net: String(row.projected_net),
    cumulative_balance: row.cumulative_balance == null ? null : String(row.cumulative_balance),
    confidence_score: row.confidence_score == null ? null : String(row.confidence_score),
    key_drivers: normalizeStringArray(row.key_drivers),
    balance_low: row.balance_low == null ? null : String(row.balance_low),
    balance_high: row.balance_high == null ? null : String(row.balance_high),
    scenario: String(row.scenario),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at)
  };
}

export class ForecastsRepository extends BaseRepository {
  constructor(context: RepositoryContext, dbClient?: SupabaseClient) {
    super(context, dbClient);
  }

  async list(filters: ForecastFilters, pagination: PaginationInput): Promise<PaginatedResult<Forecast>> {
    let query = this.db.from('cash_flow_forecasts').select('*').eq('organization_id', this.context.organizationId);

    if (filters.type) {
      query = query.eq('forecast_type', filters.type);
    }
    if (filters.status) {
      query = query.eq('status', filters.status);
    }
    if (filters.generationStatus) {
      query = query.eq('generation_status', filters.generationStatus);
    }
    if (filters.fromDate) {
      query = query.gte('start_date', filters.fromDate);
    }
    if (filters.toDate) {
      query = query.lte('end_date', filters.toDate);
    }

    const paged = applyCursorPagination(query.order('created_at', { ascending: false }), pagination, { cursorColumn: 'created_at' });
    const { data, error } = await paged;
    assertNoQueryError(error);

    const limit = resolveLimit(pagination);
    const rows = ((data ?? []) as Record<string, unknown>[]).map((row) => toForecast(row));
    const hasMore = rows.length > limit;
    const items = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore && items.length > 0 ? toNextCursor(items[items.length - 1]?.created_at) : null;

    return { items, nextCursor };
  }

  async createGenerationRecord(input: CreateForecastInput, userId: string, options: ForecastRecordOptions): Promise<Forecast> {
    const { data, error } = await this.db
      .from('cash_flow_forecasts')
      .insert({
        organization_id: this.context.organizationId,
        name: options.name,
        forecast_type: input.forecastType,
        start_date: options.startDate,
        end_date: options.endDate,
        horizon_days: input.horizon,
        currency_code: input.currencyCode,
        model_type: 'ai_hybrid',
        model_version: 'claude-sonnet-4-5',
        status: 'draft',
        scenario_name: options.scenarioName,
        notes: options.notes ?? null,
        base_forecast_id: options.baseForecastId ?? null,
        scenario_parameters: options.scenarioParameters ?? {},
        generation_status: options.generationStatus,
        generation_job_id: options.generationJobId ?? null,
        estimated_time_seconds: options.estimatedTimeSeconds,
        created_by: userId
      })
      .select('*')
      .single();

    assertNoQueryError(error);
    return toForecast(data as Record<string, unknown>);
  }

  async findById(forecastId: string): Promise<Forecast | null> {
    const { data, error } = await this.db
      .from('cash_flow_forecasts')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .eq('id', forecastId)
      .maybeSingle();

    assertNoQueryError(error);
    return data ? toForecast(data as Record<string, unknown>) : null;
  }

  async getDetail(forecastId: string): Promise<ForecastDetail | null> {
    const forecast = await this.findById(forecastId);
    if (!forecast) {
      return null;
    }

    const { data, error } = await this.db
      .from('cash_flow_forecast_lines')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .eq('forecast_id', forecastId)
      .order('forecast_date', { ascending: true });

    assertNoQueryError(error);

    return {
      ...forecast,
      lines: ((data ?? []) as Record<string, unknown>[]).map((row) => toForecastLine(row))
    };
  }

  async updateForecast(
    forecastId: string,
    payload: Record<string, unknown>,
    select = true
  ): Promise<Forecast | null> {
    let query = this.db
      .from('cash_flow_forecasts')
      .update(payload)
      .eq('organization_id', this.context.organizationId)
      .eq('id', forecastId);

    if (select) {
      const { data, error } = await query.select('*').maybeSingle();
      assertNoQueryError(error);
      return data ? toForecast(data as Record<string, unknown>) : null;
    }

    const { error } = await query;
    assertNoQueryError(error);
    return null;
  }

  async replaceForecastLines(forecastId: string, lines: ForecastLineInsert[]): Promise<void> {
    const { error: deleteError } = await this.db
      .from('cash_flow_forecast_lines')
      .delete()
      .eq('organization_id', this.context.organizationId)
      .eq('forecast_id', forecastId);

    assertNoQueryError(deleteError);

    if (lines.length === 0) {
      return;
    }

    const { error } = await this.db.from('cash_flow_forecast_lines').insert(
      lines.map((line) => ({
        organization_id: this.context.organizationId,
        forecast_id: forecastId,
        forecast_date: line.forecast_date,
        projected_inflow: line.projected_inflow,
        projected_outflow: line.projected_outflow,
        projected_net: line.projected_net,
        cumulative_balance: line.cumulative_balance,
        confidence_score: line.confidence_score,
        key_drivers: line.key_drivers,
        balance_low: line.balance_low,
        balance_high: line.balance_high,
        scenario: line.scenario ?? 'base'
      }))
    );

    assertNoQueryError(error);
  }

  async listPromptExamples(input: { forecastType: Forecast['forecast_type']; currencyCode: string; limit: number }): Promise<Forecast[]> {
    const { data, error } = await this.db
      .from('cash_flow_forecasts')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .eq('forecast_type', input.forecastType)
      .eq('currency_code', input.currencyCode)
      .eq('generation_status', 'completed')
      .not('accuracy_score', 'is', null)
      .order('accuracy_score', { ascending: false })
      .limit(input.limit);

    assertNoQueryError(error);
    return ((data ?? []) as Record<string, unknown>[]).map((row) => toForecast(row));
  }

  async listAccuracyMetrics(limit = 20): Promise<ForecastAccuracyMetric[]> {
    const { data, error } = await this.db
      .from('cash_flow_forecasts')
      .select('id,start_date,horizon_days,scenario_name,forecast_type,accuracy_score,accuracy_details,generation_status')
      .eq('organization_id', this.context.organizationId)
      .not('accuracy_score', 'is', null)
      .order('start_date', { ascending: false })
      .limit(limit);

    assertNoQueryError(error);

    return ((data ?? []) as Array<Record<string, unknown>>).map((row) => ({
      forecastId: String(row.id),
      forecastDate: String(row.start_date),
      horizonDays: Number(row.horizon_days ?? 0),
      scenarioName: String(row.scenario_name ?? 'base'),
      forecastType: row.forecast_type as Forecast['forecast_type'],
      accuracyScore: row.accuracy_score == null ? null : String(row.accuracy_score),
      mapePct:
        typeof (row.accuracy_details as Record<string, unknown> | null)?.overallMapePct === 'string'
          ? String((row.accuracy_details as Record<string, unknown>).overallMapePct)
          : null,
      generationStatus: row.generation_status as ForecastGenerationStatus
    }));
  }

  async listHistoricalTransactions(fromDate: string, toDate: string): Promise<ForecastContextTransactionRow[]> {
    const { data, error } = await this.db
      .from('transactions')
      .select('booking_date,amount,currency_code,direction,description')
      .eq('organization_id', this.context.organizationId)
      .gte('booking_date', fromDate)
      .lte('booking_date', toDate)
      .order('booking_date', { ascending: true });

    assertNoQueryError(error);
    return (data ?? []) as ForecastContextTransactionRow[];
  }

  async listOpenPayments(fromDate: string, toDate: string): Promise<ForecastContextPaymentRow[]> {
    const { data, error } = await this.db
      .from('payments')
      .select('id,payment_reference,amount,currency_code,value_date,status,purpose')
      .eq('organization_id', this.context.organizationId)
      .in('status', ['pending_approval', 'approved'])
      .gte('value_date', fromDate)
      .lte('value_date', toDate)
      .order('value_date', { ascending: true });

    assertNoQueryError(error);
    return (data ?? []) as ForecastContextPaymentRow[];
  }

  async listUpcomingDebtSchedules(fromDate: string, toDate: string): Promise<ForecastContextDebtRow[]> {
    const { data, error } = await this.db
      .from('debt_schedules')
      .select('id,debt_facility_id,due_date,principal_due,interest_due,status,debt_facilities!inner(facility_name,currency_code)')
      .eq('organization_id', this.context.organizationId)
      .in('status', ['scheduled', 'overdue'])
      .gte('due_date', fromDate)
      .lte('due_date', toDate)
      .order('due_date', { ascending: true });

    assertNoQueryError(error);
    return (((data ?? []) as Array<{
      id: string;
      debt_facility_id: string;
      due_date: string;
      principal_due: string;
      interest_due: string;
      status: string;
      debt_facilities: Array<{ facility_name: string; currency_code: string }> | { facility_name: string; currency_code: string } | null;
    }>).map((row) => ({
      ...row,
      debt_facilities: Array.isArray(row.debt_facilities) ? (row.debt_facilities[0] ?? null) : row.debt_facilities
    })) as unknown) as ForecastContextDebtRow[];
  }

  async listInvestmentMaturities(fromDate: string, toDate: string): Promise<ForecastContextInvestmentRow[]> {
    const { data, error } = await this.db
      .from('investments')
      .select('id,instrument_name,instrument_type,principal_amount,currency_code,maturity_date,status')
      .eq('organization_id', this.context.organizationId)
      .eq('status', 'active')
      .gte('maturity_date', fromDate)
      .lte('maturity_date', toDate)
      .order('maturity_date', { ascending: true });

    assertNoQueryError(error);
    return (data ?? []) as ForecastContextInvestmentRow[];
  }

  async listSweepingRules(): Promise<ForecastContextSweepRuleRow[]> {
    const { data, error } = await this.db
      .from('sweeping_rules')
      .select('id,source_account_id,target_account_id,min_balance,target_balance,frequency,is_active')
      .eq('organization_id', this.context.organizationId)
      .eq('is_active', true)
      .order('created_at', { ascending: true });

    assertNoQueryError(error);
    return (data ?? []) as ForecastContextSweepRuleRow[];
  }

  async getCurrentCashPositions(): Promise<ForecastCashPositionRow[]> {
    const { data, error } = await this.db
      .from('cash_positions_latest')
      .select('currency_code,available_balance,current_balance,as_of_at')
      .eq('organization_id', this.context.organizationId)
      .eq('scope_type', 'organization')
      .order('currency_code', { ascending: true });

    assertNoQueryError(error);
    return (data ?? []) as ForecastCashPositionRow[];
  }

  async listTreasuryPolicies(asOf: string): Promise<ForecastPolicyRow[]> {
    const { data, error } = await this.db
      .from('treasury_policies')
      .select('rules')
      .eq('organization_id', this.context.organizationId)
      .eq('is_active', true)
      .lte('effective_from', asOf)
      .or(`effective_to.is.null,effective_to.gte.${asOf}`)
      .order('effective_from', { ascending: false });

    assertNoQueryError(error);
    return (data ?? []) as ForecastPolicyRow[];
  }
}
