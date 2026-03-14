import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, type RepositoryContext } from '@/repositories/base/repository';
import { assertNoQueryError } from '@/repositories/base/execute';
import type { CreateRiskAlertInput, RiskAlert, RiskAlertSeverity, RiskAlertStatus } from '@/types/risk/types';

export interface RiskAlertFilters {
  status?: RiskAlertStatus;
  severity?: RiskAlertSeverity;
  riskType?: string;
}

export class RiskAlertsRepository extends BaseRepository {
  constructor(context: RepositoryContext, dbClient?: SupabaseClient) {
    super(context, dbClient);
  }

  async listAlerts(filters: RiskAlertFilters = {}): Promise<RiskAlert[]> {
    let query = this.db
      .from('risk_alerts')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .order('created_at', { ascending: false });

    if (filters.status) {
      query = query.eq('status', filters.status);
    }

    if (filters.severity) {
      query = query.eq('severity', filters.severity);
    }

    if (filters.riskType) {
      query = query.eq('risk_type', filters.riskType);
    }

    const { data, error } = await query.limit(100);
    assertNoQueryError(error);
    return (data ?? []) as RiskAlert[];
  }

  async getAlert(alertId: string): Promise<RiskAlert | null> {
    const { data, error } = await this.db
      .from('risk_alerts')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .eq('id', alertId)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as RiskAlert | null) ?? null;
  }

  async findActiveAlert(input: {
    riskType: string;
    title: string;
    relatedEntityId?: string | null;
  }): Promise<RiskAlert | null> {
    let query = this.db
      .from('risk_alerts')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .eq('risk_type', input.riskType)
      .eq('title', input.title)
      .in('status', ['open', 'acknowledged'])
      .order('created_at', { ascending: false })
      .limit(1);

    query = input.relatedEntityId ? query.eq('related_entity_id', input.relatedEntityId) : query.is('related_entity_id', null);

    const { data, error } = await query.maybeSingle();
    assertNoQueryError(error);
    return (data as RiskAlert | null) ?? null;
  }

  async createAlert(input: CreateRiskAlertInput): Promise<RiskAlert> {
    const { data, error } = await this.db
      .from('risk_alerts')
      .insert({
        organization_id: this.context.organizationId,
        risk_type: input.riskType,
        severity: input.severity,
        title: input.title,
        message: input.message,
        related_entity_type: input.relatedEntityType ?? null,
        related_entity_id: input.relatedEntityId ?? null,
        resolution_note: input.resolutionNote ?? null
      })
      .select('*')
      .single();

    assertNoQueryError(error);
    return data as RiskAlert;
  }

  async refreshAlert(
    alertId: string,
    input: Pick<CreateRiskAlertInput, 'severity' | 'title' | 'message' | 'resolutionNote'>
  ): Promise<RiskAlert | null> {
    const { data, error } = await this.db
      .from('risk_alerts')
      .update({
        severity: input.severity,
        title: input.title,
        message: input.message,
        resolution_note: input.resolutionNote ?? null
      })
      .eq('organization_id', this.context.organizationId)
      .eq('id', alertId)
      .select('*')
      .maybeSingle();

    assertNoQueryError(error);
    return (data as RiskAlert | null) ?? null;
  }

  async updateAlertStatus(
    alertId: string,
    status: RiskAlertStatus,
    resolvedBy?: string,
    note?: string
  ): Promise<RiskAlert | null> {
    const updatePayload: Record<string, string | null> = {
      status,
      resolution_note: note ?? null
    };

    if (status === 'resolved') {
      updatePayload.resolved_by = resolvedBy ?? null;
      updatePayload.resolved_at = new Date().toISOString();
    }

    const { data, error } = await this.db
      .from('risk_alerts')
      .update(updatePayload)
      .eq('organization_id', this.context.organizationId)
      .eq('id', alertId)
      .select('*')
      .maybeSingle();

    assertNoQueryError(error);
    return (data as RiskAlert | null) ?? null;
  }

  async getOpenAlertCount(): Promise<number> {
    const { count, error } = await this.db
      .from('risk_alerts')
      .select('id', { count: 'exact', head: true })
      .eq('organization_id', this.context.organizationId)
      .eq('status', 'open');

    assertNoQueryError(error);
    return count ?? 0;
  }
}
