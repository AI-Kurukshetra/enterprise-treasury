import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseQuery, parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { buildServices } from '@/services/serviceFactory';
import { ok } from '@/lib/http';
import { csvFormatter, type ColumnDef } from '@/lib/report-formatters/csv-formatter';
import { CashSummaryQuerySchema } from '@/schemas/reports/schema';

const CashSummaryResponseSchema = z.object({
  generatedAt: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  accounts: z.array(
    z.object({
      accountId: z.string().uuid(),
      accountName: z.string(),
      accountNumberMasked: z.string(),
      currencyCode: z.string().length(3),
      countryCode: z.string().nullable(),
      openingBalance: z.string(),
      closingBalance: z.string(),
      openingAvailableBalance: z.string(),
      closingAvailableBalance: z.string(),
      netMovement: z.string()
    })
  ),
  netCashFlowByCurrency: z.array(
    z.object({
      currencyCode: z.string().length(3),
      inflows: z.string(),
      outflows: z.string(),
      netCashFlow: z.string()
    })
  ),
  transactionStatistics: z.array(
    z.object({
      currencyCode: z.string().length(3),
      transactionCount: z.number().int().nonnegative(),
      averageTransactionSize: z.string()
    })
  ),
  topCounterparties: z.array(
    z.object({
      counterpartyId: z.string(),
      counterpartyName: z.string(),
      rankedVolume: z.string(),
      transactionCount: z.number().int().nonnegative(),
      currencyBreakdown: z.array(
        z.object({
          currencyCode: z.string().length(3),
          totalVolume: z.string(),
          transactionCount: z.number().int().nonnegative()
        })
      )
    })
  )
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
  return executeRoute(request, { requiredPermission: 'reports.read' }, async (_req, context) => {
    const query = parseQuery(request, CashSummaryQuerySchema);
    const services = buildServices(toServiceContext(context));
    const report = parseResponse(
      await services.reports.generateCashSummary(context.organizationId!, query.periodStart, query.periodEnd),
      CashSummaryResponseSchema
    );

    await services.reports.logReportDownload({
      action: 'report.cash_summary.view',
      entityType: 'report',
      metadata: {
        format: query.format,
        periodStart: query.periodStart,
        periodEnd: query.periodEnd
      }
    });

    if (query.format === 'csv') {
      const rows = [
        ...report.accounts.map((account) => ({
          section: 'account_balance',
          primaryLabel: account.accountName,
          secondaryLabel: account.accountNumberMasked,
          currencyCode: account.currencyCode,
          valueA: account.openingBalance,
          valueB: account.closingBalance,
          valueC: account.netMovement,
          detail: account.countryCode ?? ''
        })),
        ...report.netCashFlowByCurrency.map((item) => ({
          section: 'net_cash_flow',
          primaryLabel: item.currencyCode,
          secondaryLabel: '',
          currencyCode: item.currencyCode,
          valueA: item.inflows,
          valueB: item.outflows,
          valueC: item.netCashFlow,
          detail: ''
        })),
        ...report.transactionStatistics.map((item) => ({
          section: 'transaction_statistic',
          primaryLabel: item.currencyCode,
          secondaryLabel: '',
          currencyCode: item.currencyCode,
          valueA: String(item.transactionCount),
          valueB: item.averageTransactionSize,
          valueC: '',
          detail: ''
        })),
        ...report.topCounterparties.map((item) => ({
          section: 'top_counterparty',
          primaryLabel: item.counterpartyName,
          secondaryLabel: item.counterpartyId,
          currencyCode: item.currencyBreakdown.map((entry) => entry.currencyCode).join('; '),
          valueA: item.rankedVolume,
          valueB: String(item.transactionCount),
          valueC: '',
          detail: JSON.stringify(item.currencyBreakdown)
        }))
      ];
      const columns: ColumnDef[] = [
        { key: 'section', header: 'Section' },
        { key: 'primaryLabel', header: 'Primary Label' },
        { key: 'secondaryLabel', header: 'Secondary Label' },
        { key: 'currencyCode', header: 'Currency Code' },
        { key: 'valueA', header: 'Value A' },
        { key: 'valueB', header: 'Value B' },
        { key: 'valueC', header: 'Value C' },
        { key: 'detail', header: 'Detail', type: 'json' }
      ];

      return streamCsv(
        `cash-summary-${query.periodStart}-${query.periodEnd}.csv`,
        csvFormatter.format(rows, columns)
      );
    }

    return ok(report, context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
