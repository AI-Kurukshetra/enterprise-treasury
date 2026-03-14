import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, type RepositoryContext } from '@/repositories/base/repository';
import { assertNoQueryError } from '@/repositories/base/execute';
import type { BankIntegration, CreateBankIntegrationInput, SyncJob } from '@/types/integrations/types';

export class IntegrationsRepository extends BaseRepository {
  constructor(context: RepositoryContext, dbClient?: SupabaseClient) {
    super(context, dbClient);
  }

  async listBanks(): Promise<BankIntegration[]> {
    const { data, error } = await this.db
      .from('bank_connections')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .order('created_at', { ascending: false });

    assertNoQueryError(error);
    return (data ?? []) as BankIntegration[];
  }

  async createBank(input: CreateBankIntegrationInput): Promise<BankIntegration> {
    const { data, error } = await this.db
      .from('bank_connections')
      .insert({
        organization_id: this.context.organizationId,
        provider: input.provider,
        connection_type: input.connectionType,
        status: 'active',
        config_encrypted: input.configEncrypted
      })
      .select('*')
      .single();

    assertNoQueryError(error);
    return data as BankIntegration;
  }

  async triggerSync(connectionId: string): Promise<{ syncJobId: string }> {
    const { data, error } = await this.db
      .from('integration_sync_jobs')
      .insert({
        organization_id: this.context.organizationId,
        integration_type: 'bank',
        direction: 'import',
        status: 'queued',
        error_details: { connectionId }
      })
      .select('id')
      .single();

    assertNoQueryError(error);
    return { syncJobId: (data as { id: string }).id };
  }

  async listSyncJobs(): Promise<SyncJob[]> {
    const { data, error } = await this.db
      .from('integration_sync_jobs')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .order('created_at', { ascending: false })
      .limit(100);

    assertNoQueryError(error);
    return (data ?? []) as SyncJob[];
  }
}
