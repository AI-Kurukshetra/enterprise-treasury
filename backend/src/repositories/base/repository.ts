import type { SupabaseClient } from '@supabase/supabase-js';
import { createServiceSupabaseClient } from '@/lib/supabase';

export interface RepositoryContext {
  organizationId: string;
}

export abstract class BaseRepository {
  protected readonly db: SupabaseClient;
  protected readonly context: RepositoryContext;

  constructor(context: RepositoryContext, dbClient?: SupabaseClient) {
    this.context = context;
    this.db = dbClient ?? createServiceSupabaseClient();
  }
}
