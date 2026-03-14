import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ModuleShell } from '@/features/treasury/module-shell';
import { investmentHoldings } from '@/lib/mock-data';
import { formatCurrency, formatDate, formatPercent } from '@/lib/format';

export default function InvestmentsPage() {
  return (
    <ModuleShell
      eyebrow="Investments"
      title="Short-duration investments tracked alongside liquidity needs."
      description="Manage MMFs, deposits, and near-cash instruments with visibility into maturity ladders and yield contribution."
      primaryAction="Add investment"
      secondaryAction="Export ladder"
      metrics={[
        { label: 'Portfolio size', value: '$880M', detail: 'Treasury-managed near-cash instruments' },
        { label: 'Weighted yield', value: '4.6%', detail: 'Current annualized blended rate' },
        { label: 'Maturing in 30d', value: '$700M', detail: 'Near-term liquidity available for deployment' },
        { label: 'Issuers', value: '3', detail: 'Active counterparties in current ladder' }
      ]}
    >
      <Card>
        <CardHeader>
          <CardDescription>Investment holdings</CardDescription>
          <CardTitle>Maturity ladder and return profile</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          {investmentHoldings.map((holding) => (
            <div key={holding.instrument} className="grid gap-4 rounded-2xl border border-slate-100 px-4 py-4 lg:grid-cols-[1.4fr_0.8fr_0.8fr_0.6fr]">
              <div>
                <p className="font-semibold text-slate-900">{holding.instrument}</p>
                <p className="text-sm text-slate-500">{holding.issuer}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Amount</p>
                <p className="font-semibold">{formatCurrency(holding.amount, holding.currencyCode)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Maturity</p>
                <p className="font-semibold">{formatDate(holding.maturityDate)}</p>
              </div>
              <div>
                <p className="text-sm text-slate-500">Yield</p>
                <p className="font-semibold">{formatPercent(holding.yield)}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </ModuleShell>
  );
}
