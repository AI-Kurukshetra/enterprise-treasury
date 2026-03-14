import { CashTrendChart } from '@/components/charts/cash-trend-chart';
import { LiquidityAnalyticsChart } from '@/components/charts/liquidity-analytics-chart';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ModuleShell } from '@/features/treasury/module-shell';
import { cashTrendData, liquidityMixData } from '@/lib/mock-data';
import { formatCompactCurrency } from '@/lib/format';

export default function CashPositionsPage() {
  return (
    <ModuleShell
      eyebrow="Cash positions"
      title="Consolidated positions for global liquidity visibility."
      description="Move from account-level balances to entity and regional cash intelligence with policy buffer context and trapped cash segmentation."
      primaryAction="Refresh positions"
      secondaryAction="Export cash summary"
      metrics={[
        { label: 'Global balance', value: '$14.82B', detail: 'All entities, translated to USD view' },
        { label: 'Policy buffer', value: '$1.72B', detail: 'Above minimum liquidity floor' },
        { label: 'Trapped cash', value: '$1.6B', detail: 'Regulatory or structural restrictions' },
        { label: 'Pools monitored', value: '11', detail: 'Sweeping and concentration structures' }
      ]}
    >
      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <Card>
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardDescription>Position history</CardDescription>
            <CardTitle>Global cash run-rate</CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <CashTrendChart data={cashTrendData} title="Cash position history and buffer" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="border-b border-slate-100 pb-4">
            <CardDescription>Regional liquidity</CardDescription>
            <CardTitle>Deployable cash by region</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 pt-6">
            {[
              ['Americas', 4.7],
              ['EMEA', 3.9],
              ['APAC', 2.8],
              ['LATAM', 0.7]
            ].map(([region, value]) => (
              <div key={region} className="flex items-center justify-between rounded-2xl border border-slate-100 px-4 py-4">
                <p className="font-semibold text-slate-900">{region}</p>
                <p className="text-lg font-semibold">{formatCompactCurrency((value as number) * 1_000_000_000)}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
      <Card>
        <CardHeader className="border-b border-slate-100 pb-4">
          <CardDescription>Liquidity composition</CardDescription>
          <CardTitle>Operating, reserve, and trapped cash segmentation</CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          <LiquidityAnalyticsChart data={liquidityMixData} title="Liquidity segmentation by region" />
        </CardContent>
      </Card>
    </ModuleShell>
  );
}
