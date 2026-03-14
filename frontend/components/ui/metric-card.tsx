'use client';

import { ArrowDownRight, ArrowUpRight, TriangleAlert } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

type TrendDirection = 'up' | 'down' | 'neutral';

export function MetricCard({
  title,
  value,
  delta,
  hint,
  loading = false,
  error = false,
  trend,
  onClick
}: {
  title: string;
  value?: string;
  delta?: string;
  hint?: string;
  loading?: boolean;
  error?: boolean;
  trend?: TrendDirection;
  onClick?: () => void;
}) {
  return (
    <Card
      className={cn(onClick ? 'cursor-pointer transition-colors hover:border-slate-300' : undefined)}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      <CardHeader className="gap-3 pb-4">
        <CardDescription>{title}</CardDescription>
        {loading ? (
          <div className="space-y-3">
            <div className="h-9 w-32 animate-pulse rounded-lg bg-slate-200" />
            <div className="h-5 w-20 animate-pulse rounded-lg bg-slate-100" />
          </div>
        ) : (
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <CardTitle className="text-3xl">{value ?? '--'}</CardTitle>
              {error ? <TriangleAlert className="h-4 w-4 text-amber-600" /> : null}
            </div>
            {delta ? (
              <Badge variant={resolveBadgeVariant(error, trend, delta)}>
                {trend === 'up' ? <ArrowUpRight className="mr-1 h-3.5 w-3.5" /> : null}
                {trend === 'down' ? <ArrowDownRight className="mr-1 h-3.5 w-3.5" /> : null}
                {delta}
              </Badge>
            ) : null}
          </div>
        )}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-4 w-40 animate-pulse rounded-lg bg-slate-100" />
        ) : (
          <p className={cn('text-sm', error ? 'text-amber-700' : 'text-slate-500')}>{hint ?? ''}</p>
        )}
      </CardContent>
    </Card>
  );
}

function resolveBadgeVariant(error: boolean, trend: TrendDirection | undefined, delta: string) {
  if (error) {
    return 'warning';
  }
  if (trend === 'up') {
    return 'success';
  }
  if (trend === 'down') {
    return 'danger';
  }
  return delta.startsWith('+') ? 'success' : 'secondary';
}
