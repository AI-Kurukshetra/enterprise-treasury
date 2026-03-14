import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { JobQueue } from '@/lib/job-queue/job-queue';
import { detectStatementFormat } from '@/lib/parsers';
import { ValidationError } from '@/errors/ValidationError';
import { buildServices } from '@/services/serviceFactory';

const ImportResponseSchema = z.object({
  jobId: z.string().uuid(),
  status: z.literal('queued'),
  format: z.enum(['mt940', 'csv', 'ofx'])
});

function parseOptionalJson(value: FormDataEntryValue | null): Record<string, string> | undefined {
  if (!value || typeof value !== 'string' || value.trim().length === 0) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new ValidationError('csvColumnMapping must be valid JSON');
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('csvColumnMapping must be a JSON object');
  }

  return Object.entries(parsed).reduce<Record<string, string>>((result, [key, entryValue]) => {
    if (typeof entryValue === 'string' && entryValue.trim().length > 0) {
      result[key] = entryValue;
    }
    return result;
  }, {});
}

export async function POST(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'transactions.import' }, async (_req, context) => {
    const formData = await request.formData();
    const file = formData.get('file');
    const bankAccountId = formData.get('bankAccountId');

    if (!(file instanceof File)) {
      throw new ValidationError('A statement file is required');
    }

    if (typeof bankAccountId !== 'string' || bankAccountId.trim().length === 0) {
      throw new ValidationError('bankAccountId is required');
    }

    if (file.size > 50 * 1024 * 1024) {
      throw new ValidationError('Statement file must be 50MB or smaller');
    }

    const fileContent = await file.text();
    const detectedFormat = detectStatementFormat(fileContent, file.name);
    const services = buildServices(toServiceContext(context));
    const account = await services.accounts.getById(bankAccountId);
    if (!account.bank_connection_id) {
      throw new ValidationError('Selected bank account is not linked to a bank connection');
    }
    const importJob = await services.transactions.queueImportUpload({
      bankAccountId,
      sourceFilename: file.name,
      format: detectedFormat
    });
    const queue = new JobQueue();
    await queue.enqueue(
      'bank.sync',
      {
        connectionId: account.bank_connection_id,
        organizationId: context.organizationId!,
        importJobId: importJob.importJobId,
        sourceFilename: file.name,
        fileContent,
        format: detectedFormat,
        csvColumnMapping: parseOptionalJson(formData.get('csvColumnMapping')),
        initiatedByUserId: context.user!.id
      },
      {
        organizationId: context.organizationId!,
        maxAttempts: 4
      }
    );

    return ok(
      parseResponse(
        {
          jobId: importJob.importJobId,
          status: 'queued',
          format: detectedFormat
        },
        ImportResponseSchema
      ),
      context.requestId,
      202
    );
  });
}

export const OPTIONS = buildOptionsHandler();
