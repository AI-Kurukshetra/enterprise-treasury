'use client';

import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { formatCompactCurrency } from '@/lib/format';
import type { RegionalBreakdown } from '@/lib/types';

export function LiquidityAnalyticsChart({
  data,
  title
}: {
  data: Array<
    RegionalBreakdown | {
      label: string;
      operating: string | number;
      reserve: string | number;
      trapped: string | number;
    }
  >;
  title: string;
}) {
  const chartData = data.map((point) => ({
    label: 'region' in point ? point.region : point.label,
    operating: Number(point.operating),
    reserve: Number(point.reserve),
    trapped: Number(point.trapped)
  }));

  return (
    <div className="h-[300px]" role="img" aria-label={title}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
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
              background: 'rgba(255,255,255,0.95)'
            }}
            formatter={(value: number, name: string) => [formatCompactCurrency(value), name]}
          />
          <Legend />
          <Bar dataKey="operating" stackId="a" fill="#1f2937" radius={[6, 6, 0, 0]} />
          <Bar dataKey="reserve" stackId="a" fill="#a86a37" radius={[6, 6, 0, 0]} />
          <Bar dataKey="trapped" stackId="a" fill="#0f766e" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <ul className="sr-only">
        {chartData.map((point) => (
          <li key={point.label}>
            {point.label}: operating {point.operating}, reserve {point.reserve}, trapped {point.trapped}
          </li>
        ))}
      </ul>
    </div>
  );
}
