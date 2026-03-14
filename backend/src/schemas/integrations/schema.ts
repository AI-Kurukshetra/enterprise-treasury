import { z } from 'zod';

export const CreateBankIntegrationRequestSchema = z.object({
  provider: z.string().min(1).max(80),
  connectionType: z.enum(['open_banking', 'sftp', 'manual_file']),
  configEncrypted: z.record(z.string(), z.unknown())
});

export const TriggerBankSyncRequestSchema = z.object({
  connectionId: z.string().uuid()
});
