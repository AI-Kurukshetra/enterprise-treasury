import type { SupabaseClient } from '@supabase/supabase-js';
import { BaseRepository, type RepositoryContext } from '@/repositories/base/repository';
import { assertNoQueryError } from '@/repositories/base/execute';

export interface IdempotencyRecord {
  id: string;
  organization_id: string;
  operation: string;
  idempotency_key: string;
  request_hash: string;
  response_snapshot: Record<string, unknown> | null;
  status: 'in_progress' | 'completed' | 'failed';
}

export class IdempotencyRepository extends BaseRepository {
  constructor(context: RepositoryContext, dbClient?: SupabaseClient) {
    super(context, dbClient);
  }

  async find(operation: string, idempotencyKey: string): Promise<IdempotencyRecord | null> {
    const { data, error } = await this.db
      .from('idempotency_keys')
      .select('*')
      .eq('organization_id', this.context.organizationId)
      .eq('operation', operation)
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle();

    assertNoQueryError(error);
    return (data as IdempotencyRecord | null) ?? null;
  }

  async createInProgress(operation: string, idempotencyKey: string, requestHash: string): Promise<IdempotencyRecord> {
    const { data, error } = await this.db
      .from('idempotency_keys')
      .insert({
        organization_id: this.context.organizationId,
        operation,
        idempotency_key: idempotencyKey,
        request_hash: requestHash,
        status: 'in_progress'
      })
      .select('*')
      .single();

    assertNoQueryError(error);
    return data as IdempotencyRecord;
  }

  async markCompleted(
    operation: string,
    idempotencyKey: string,
    responseSnapshot: Record<string, unknown>
  ): Promise<void> {
    const { error } = await this.db
      .from('idempotency_keys')
      .update({ status: 'completed', response_snapshot: responseSnapshot })
      .eq('organization_id', this.context.organizationId)
      .eq('operation', operation)
      .eq('idempotency_key', idempotencyKey);

    assertNoQueryError(error);
  }

  async markFailed(operation: string, idempotencyKey: string, errorMessage: string): Promise<void> {
    const { error } = await this.db
      .from('idempotency_keys')
      .update({
        status: 'failed',
        response_snapshot: {
          error: errorMessage
        }
      })
      .eq('organization_id', this.context.organizationId)
      .eq('operation', operation)
      .eq('idempotency_key', idempotencyKey);

    assertNoQueryError(error);
  }
}
