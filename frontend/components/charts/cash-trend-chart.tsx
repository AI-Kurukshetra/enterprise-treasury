'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { formatCompactCurrency } from '@/lib/format';
import type { CashTrendPoint } from '@/lib/types';

interface CashTrendChartProps {
  data: Array<
    Pick<CashTrendPoint, 'label'> & {
      value: string | number;
      projected?: string | number;
      buffer?: string | number;
    }
  >;
  title: string;
}

export function CashTrendChart({ data, title }: CashTrendChartProps) {
  const chartData = data.map((point) => ({
    ...point,
    value: Number(point.value),
    projected: point.projected === undefined ? undefined : Number(point.projected),
    buffer: point.buffer === undefined ? undefined : Number(point.buffer)
  }));

  return (
    <div className="h-[300px]" role="img" aria-label={title}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="cash-value" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#1f2937" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#1f2937" stopOpacity={0.02} />
            </linearGradient>
            <linearGradient id="cash-projected" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#a86a37" stopOpacity={0.28} />
              <stop offset="95%" stopColor="#a86a37" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 8" stroke="#dce3e8" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#66758a', fontSize: 12 }} />
          <YAxis
            tickFormatter={(value) => formatCompactCurrency(value)}
            tickLine={false}
            axisLine={false}
            tick={{ fill: '#66758a', fontSize: 12 }}
            width={78}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 18,
              border: '1px solid rgba(226,232,240,1)',
              background: 'rgba(255,255,255,0.95)',
              boxShadow: '0 20px 40px rgba(15,23,42,0.08)'
            }}
            formatter={(value: number, name: string) => [
              formatCompactCurrency(value),
              name === 'value' ? 'Actual cash' : name === 'projected' ? 'Projected cash' : 'Buffer'
            ]}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke="#1f2937"
            fill="url(#cash-value)"
            strokeWidth={2.5}
            name="value"
          />
          <Area
            type="monotone"
            dataKey="projected"
            stroke="#a86a37"
            fill="url(#cash-projected)"
            strokeWidth={2}
            strokeDasharray="5 5"
            name="projected"
          />
          <Line type="monotone" dataKey="buffer" stroke="#0f766e" strokeWidth={2} dot={false} name="buffer" />
        </AreaChart>
      </ResponsiveContainer>
      <ul className="sr-only">
        {chartData.map((point) => (
          <li key={point.label}>
            {point.label}: actual {point.value}, projected {point.projected}, buffer {point.buffer}
          </li>
        ))}
      </ul>
    </div>
  );
}
