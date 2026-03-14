import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { PageHeader } from '@/components/layout/page-header';

export interface ModuleMetric {
  label: string;
  value: string;
  detail: string;
}

export function ModuleShell({
  eyebrow,
  title,
  description,
  primaryAction,
  secondaryAction,
  metrics,
  children
}: {
  eyebrow: string;
  title: string;
  description: string;
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  metrics: ModuleMetric[];
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={eyebrow}
        title={title}
        description={description}
        primaryAction={primaryAction}
        secondaryAction={secondaryAction}
      />
      <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {metrics.map((metric) => (
          <Card key={metric.label}>
            <CardHeader className="gap-3 pb-4">
              <CardDescription>{metric.label}</CardDescription>
              <CardTitle className="text-3xl">{metric.value}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-500">{metric.detail}</p>
            </CardContent>
          </Card>
        ))}
      </section>
      {children}
    </div>
  );
}
