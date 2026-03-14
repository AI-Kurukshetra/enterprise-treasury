import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseQuery, parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { csvFormatter, type ColumnDef } from '@/lib/report-formatters/csv-formatter';
import { AdminService } from '@/services/admin/service';

const AuditLogsQuerySchema = z.object({
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional(),
  userId: z.string().uuid().optional(),
  action: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional().default(100),
  cursor: z.string().optional(),
  format: z.enum(['json', 'csv']).optional().default('json')
});

const AuditLogSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  userEmail: z.string().email().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  previousState: z.record(z.unknown()).nullable(),
  newState: z.record(z.unknown()).nullable(),
  requestId: z.string().nullable(),
  createdAt: z.string()
});

const AuditLogPageSchema = z.object({
  items: z.array(AuditLogSchema),
  nextCursor: z.string().nullable()
});

function streamCsv(filename: string, csv: string): NextResponse {
  const encoder = new TextEncoder();
  const chunks = csv.match(/.{1,65536}/gs) ?? [''];
  let index = 0;

  return new NextResponse(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks[index++];
        if (!next) {
          controller.close();
          return;
        }

        controller.enqueue(encoder.encode(next));
      }
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    }
  );
}

export async function GET(request: NextRequest) {
  return executeRoute(request, { requiredPermission: 'admin.audit_logs.read' }, async (_req, context) => {
    const query = parseQuery(request, AuditLogsQuerySchema);
    const adminService = new AdminService(toServiceContext(context));
    const result = parseResponse(
      await adminService.listAuditLogs({
        fromDate: query.fromDate,
        toDate: query.toDate,
        userId: query.userId,
        action: query.action,
        entityType: query.entityType,
        search: query.search,
        limit: query.limit ?? 100,
        cursor: query.cursor
      }),
      AuditLogPageSchema
    );

    if (query.format === 'csv') {
      const columns: ColumnDef[] = [
        { key: 'createdAt', header: 'Timestamp', type: 'datetime' },
        { key: 'userEmail', header: 'User Email' },
        { key: 'userId', header: 'User ID' },
        { key: 'action', header: 'Action' },
        { key: 'entityType', header: 'Entity Type' },
        { key: 'entityId', header: 'Entity ID' },
        { key: 'requestId', header: 'Request ID' },
        { key: 'previousState', header: 'Previous State', type: 'json' },
        { key: 'newState', header: 'New State', type: 'json' }
      ];

      return streamCsv(`audit-logs-${new Date().toISOString().slice(0, 10)}.csv`, csvFormatter.format(result.items, columns));
    }

    return ok(result, context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
