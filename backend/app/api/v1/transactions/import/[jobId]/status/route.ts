import { z } from 'zod';
import type { NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';

const ImportStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['queued', 'running', 'partial', 'completed', 'failed']),
  total: z.number().int().nonnegative(),
  imported: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  errorReport: z.unknown().optional()
});

interface RouteParams {
  params: Promise<{ jobId: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams) {
  return executeRoute(request, { requiredPermission: 'transactions.import' }, async (_req, context) => {
    const { jobId } = await params;
    const services = buildServices(toServiceContext(context));
    const status = await services.transactions.getImportStatus(jobId);

    return ok(
      parseResponse(
        {
          id: status.id,
          status: status.status,
          total: Number(status.total_records ?? 0),
          imported: Number(status.imported_count ?? 0),
          duplicates: Number(status.duplicate_count ?? 0),
          errors: Number(status.error_count ?? 0),
          warnings: Number(status.warning_count ?? 0),
          errorReport: (status.result_summary as Record<string, unknown> | null) ?? undefined
        },
        ImportStatusSchema
      ),
      context.requestId
    );
  });
}

export const OPTIONS = buildOptionsHandler();
