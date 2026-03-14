import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseQuery, parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { buildServices } from '@/services/serviceFactory';
import { ok } from '@/lib/http';
import { csvFormatter, type ColumnDef } from '@/lib/report-formatters/csv-formatter';
import { LiquidityReportQuerySchema } from '@/schemas/reports/schema';

const LiquidityReportResponseSchema = z.object({
  generatedAt: z.string(),
  asOf: z.string(),
  availableLiquidityByAccount: z.array(
    z.object({
      accountId: z.string().uuid(),
      accountName: z.string(),
      accountNumberMasked: z.string(),
      currencyCode: z.string().length(3),
      countryCode: z.string().nullable(),
      region: z.string(),
      availableBalance: z.string(),
      currentBalance: z.string(),
      positionTimestamp: z.string().nullable()
    })
  ),
  liquidityPools: z.array(
    z.object({
      poolId: z.string().uuid(),
      name: z.string(),
      poolType: z.string(),
      baseCurrency: z.string().length(3),
      accountCount: z.number().int().nonnegative(),
      totalAvailableBalance: z.string(),
      totalCurrentBalance: z.string(),
      composition: z.array(
        z.object({
          accountId: z.string().uuid(),
          accountName: z.string(),
          currencyCode: z.string().length(3),
          availableBalance: z.string(),
          currentBalance: z.string()
        })
      )
    })
  ),
  runway: z.object({
    baseCurrency: z.string().length(3),
    availableBalance: z.string(),
    dailyBurnRate: z.string(),
    daysOfRunway: z.number().nullable()
  }),
  trappedCashByRegion: z.array(
    z.object({
      region: z.string(),
      currencyCode: z.string().length(3),
      reason: z.string(),
      trappedBalance: z.string()
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
    const query = parseQuery(request, LiquidityReportQuerySchema);
    const services = buildServices(toServiceContext(context));
    const report = parseResponse(
      await services.reports.generateLiquidityReport(context.organizationId!, query.asOf),
      LiquidityReportResponseSchema
    );

    await services.reports.logReportDownload({
      action: 'report.liquidity.view',
      entityType: 'report',
      metadata: {
        format: query.format,
        asOf: query.asOf
      }
    });

    if (query.format === 'csv') {
      const rows = [
        ...report.availableLiquidityByAccount.map((account) => ({
          section: 'available_liquidity',
          primaryLabel: account.accountName,
          secondaryLabel: account.accountNumberMasked,
          currencyCode: account.currencyCode,
          valueA: account.availableBalance,
          valueB: account.currentBalance,
          valueC: account.region,
          detail: account.countryCode ?? ''
        })),
        ...report.liquidityPools.map((pool) => ({
          section: 'liquidity_pool',
          primaryLabel: pool.name,
          secondaryLabel: pool.poolType,
          currencyCode: pool.baseCurrency,
          valueA: pool.totalAvailableBalance,
          valueB: pool.totalCurrentBalance,
          valueC: String(pool.accountCount),
          detail: JSON.stringify(pool.composition)
        })),
        {
          section: 'runway',
          primaryLabel: report.runway.baseCurrency,
          secondaryLabel: 'days_of_runway',
          currencyCode: report.runway.baseCurrency,
          valueA: report.runway.availableBalance,
          valueB: report.runway.dailyBurnRate,
          valueC: report.runway.daysOfRunway === null ? '' : String(report.runway.daysOfRunway),
          detail: ''
        },
        ...report.trappedCashByRegion.map((item) => ({
          section: 'trapped_cash',
          primaryLabel: item.region,
          secondaryLabel: item.reason,
          currencyCode: item.currencyCode,
          valueA: item.trappedBalance,
          valueB: '',
          valueC: '',
          detail: ''
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
        { key: 'detail', header: 'Detail' }
      ];

      return streamCsv(`liquidity-report-${query.asOf}.csv`, csvFormatter.format(rows, columns));
    }

    return ok(report, context.requestId);
  });
}

export const OPTIONS = buildOptionsHandler();
