import Link from 'next/link';
import { ArrowRight, ChartNoAxesCombined, Globe2, ShieldCheck, Workflow } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { landingCapabilities, landingMetrics, landingSections } from '@/lib/mock-data';

const treasuryHighlights = [
  {
    icon: Workflow,
    title: 'Treasury capabilities',
    description: 'Release payments, manage approvals, and watch concentration risk in one operating flow.'
  },
  {
    icon: ChartNoAxesCombined,
    title: 'Liquidity analytics',
    description: 'Track trapped cash, runway, and policy buffers with entity-level drilldown.'
  },
  {
    icon: ShieldCheck,
    title: 'Risk management',
    description: 'Monitor counterparty and FX exposure with audit-ready exceptions built into the UI.'
  },
  {
    icon: Globe2,
    title: 'Global operating model',
    description: 'Support regional treasury desks with high-density layouts tuned for large financial datasets.'
  }
];

export function LandingPage() {
  return (
    <main id="main-content" className="relative overflow-hidden">
      <section className="mx-auto min-h-screen max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="section-frame data-grid overflow-hidden bg-[radial-gradient(circle_at_top_left,rgba(168,106,55,0.18),transparent_26%),radial-gradient(circle_at_72%_18%,rgba(15,118,110,0.14),transparent_30%),linear-gradient(180deg,rgba(255,255,255,0.98),rgba(245,241,235,0.94))] px-6 py-8 lg:px-10 lg:py-10">
          <header className="flex flex-col gap-5 border-b border-slate-200/70 pb-8 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="eyebrow">Atlas Treasury</p>
              <p className="mt-2 text-sm text-slate-600">Enterprise Treasury & Cash Flow Command Center</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="outline">
                <Link href="/dashboard">View dashboard</Link>
              </Button>
              <Button asChild variant="accent">
                <Link href="/accounts">Open product tour</Link>
              </Button>
            </div>
          </header>

          <div className="grid gap-10 py-10 lg:grid-cols-[1.2fr_0.8fr] lg:py-16">
            <div className="space-y-8">
              <Badge variant="outline">Built for corporate treasury teams</Badge>
              <div className="space-y-6">
                <h1 className="max-w-4xl font-serif text-5xl leading-none tracking-tight text-slate-950 sm:text-6xl lg:text-7xl">
                  Command cash, liquidity, and payment risk from one precise operating surface.
                </h1>
                <p className="max-w-2xl text-balance text-lg leading-8 text-slate-600">
                  Atlas brings together global balances, payment approvals, forecast scenarios, and risk watchlists in a
                  frontend designed for finance teams managing real scale.
                </p>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button asChild size="lg">
                  <Link href="/dashboard">
                    Launch dashboard
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild variant="ghost" size="lg">
                  <Link href="#platform-overview">Explore platform overview</Link>
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {landingMetrics.map((metric, index) => (
                  <div
                    key={metric.label}
                    className="animate-reveal rounded-2xl border border-white/70 bg-white/85 p-4 shadow-panel"
                    style={{ animationDelay: `${index * 90}ms` }}
                  >
                    <p className="eyebrow">{metric.label}</p>
                    <p className="mt-3 text-2xl font-semibold text-slate-950">{metric.value}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="surface-panel-dark relative overflow-hidden p-6 lg:p-8">
              <div className="absolute inset-0 bg-radial-panel opacity-80" aria-hidden="true" />
              <div className="relative space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="eyebrow text-slate-400">Treasury pulse</p>
                    <h2 className="mt-2 text-2xl font-semibold">Today&apos;s command board</h2>
                  </div>
                  <Badge variant="outline" className="border-slate-700 bg-slate-900 text-slate-300">
                    Live
                  </Badge>
                </div>
                <div className="grid gap-4">
                  {[
                    ['Global cash position', '$14.82B', '+3.4%'],
                    ['Payments pending approval', '$428M', '37 items'],
                    ['Liquidity buffer', '$1.72B', 'Above floor'],
                    ['Risk watchlist', '4 alerts', '2 moderate / 2 low']
                  ].map(([label, value, detail]) => (
                    <div key={label} className="rounded-2xl border border-slate-800 bg-slate-900/80 px-4 py-4">
                      <p className="text-sm text-slate-400">{label}</p>
                      <div className="mt-2 flex items-end justify-between gap-3">
                        <p className="text-2xl font-semibold">{value}</p>
                        <p className="text-sm text-slate-400">{detail}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="platform-overview" className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[0.8fr_1.2fr]">
          <Card className="bg-slate-950 text-slate-50">
            <CardHeader>
              <CardDescription className="text-slate-400">Platform overview</CardDescription>
              <CardTitle className="text-3xl">Professional treasury workflows without the spreadsheet drag.</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm leading-7 text-slate-300">
              {landingSections.overview.map((item) => (
                <p key={item}>{item}</p>
              ))}
            </CardContent>
          </Card>
          <div className="grid gap-6 md:grid-cols-3">
            {landingCapabilities.map((item) => (
              <Card key={item.title}>
                <CardHeader>
                  <CardDescription>Platform capability</CardDescription>
                  <CardTitle>{item.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-7 text-slate-600">{item.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardDescription>Treasury capabilities</CardDescription>
              <CardTitle className="text-3xl">Built for execution speed and financial control.</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {landingSections.treasuryCapabilities.map((item) => (
                <div key={item} className="rounded-2xl border border-slate-100 px-4 py-4 text-sm text-slate-700">
                  {item}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardDescription>Product pillars</CardDescription>
              <CardTitle className="text-3xl">Enterprise UX shaped for high-density finance work.</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              {treasuryHighlights.map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="rounded-2xl border border-slate-100 bg-slate-50/60 p-4">
                    <Icon className="h-5 w-5 text-accent" />
                    <h3 className="mt-4 font-semibold text-slate-900">{item.title}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-600">{item.description}</p>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardDescription>Liquidity analytics</CardDescription>
              <CardTitle className="text-3xl">See where cash can move, not just where it sits.</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {landingSections.liquidityAnalytics.map((item) => (
                <div key={item} className="rounded-2xl border border-slate-100 px-4 py-4 text-sm text-slate-700">
                  {item}
                </div>
              ))}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardDescription>Risk management</CardDescription>
              <CardTitle className="text-3xl">Policy-linked risk monitoring with an operational edge.</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {landingSections.riskManagement.map((item) => (
                <div key={item} className="rounded-2xl border border-slate-100 px-4 py-4 text-sm text-slate-700">
                  {item}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="mx-auto max-w-[1440px] px-4 py-8 pb-16 sm:px-6 lg:px-8">
        <Card className="overflow-hidden border-slate-900 bg-slate-950 text-slate-50">
          <CardContent className="grid gap-8 px-6 py-10 lg:grid-cols-[1fr_auto] lg:items-center lg:px-10">
            <div className="space-y-3">
              <p className="eyebrow text-slate-400">Call to action</p>
              <h2 className="max-w-3xl text-3xl font-semibold tracking-tight">
                Replace fragmented treasury reporting with a frontend built for real operating decisions.
              </h2>
              <p className="max-w-2xl text-sm leading-7 text-slate-300">
                Launch the command center, connect live accounts and payments, and give treasury, risk, and finance operations one shared execution layer.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild variant="accent" size="lg">
                <Link href="/dashboard">Enter the command center</Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="border-slate-700 bg-slate-900 text-slate-200 hover:bg-slate-800">
                <Link href="/reports">Review reporting surfaces</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
