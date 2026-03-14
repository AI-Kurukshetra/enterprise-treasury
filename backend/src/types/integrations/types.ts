import type { UUID } from '@/types/common';

export interface BankIntegration {
  id: UUID;
  organization_id: UUID;
  provider: string;
  connection_type: 'open_banking' | 'sftp' | 'manual_file';
  status: 'active' | 'degraded' | 'disconnected';
  last_sync_at: string | null;
}

export interface CreateBankIntegrationInput {
  provider: string;
  connectionType: BankIntegration['connection_type'];
  configEncrypted: Record<string, unknown>;
}

export interface SyncJob {
  id: UUID;
  organization_id: UUID;
  integration_type: string;
  direction: 'import' | 'export';
  status: 'queued' | 'running' | 'completed' | 'failed' | 'partial';
  created_at: string;
}
