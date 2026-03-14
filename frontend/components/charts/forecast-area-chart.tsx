'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import { formatCompactCurrency, formatCurrency } from '@/lib/format';

export interface ForecastAreaChartPoint {
  date: string;
  label: string;
  projectedInflow: number;
  projectedOutflow: number;
  cumulativeBalance: number;
  balanceLow: number;
  balanceHigh: number;
}

interface ForecastAreaChartProps {
  data: ForecastAreaChartPoint[];
  currencyCode: string;
  minBuffer?: number | null;
  title: string;
}

export function ForecastAreaChart({ data, currencyCode, minBuffer, title }: ForecastAreaChartProps) {
  const chartData = data.map((point) => ({
    ...point,
    confidenceLower: point.balanceLow,
    confidenceSpan: Math.max(0, point.balanceHigh - point.balanceLow)
  }));

  return (
    <div className="h-[360px]" role="img" aria-label={title}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 14, right: 12, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="forecast-inflow" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#2f855a" stopOpacity={0.45} />
              <stop offset="95%" stopColor="#2f855a" stopOpacity={0.04} />
            </linearGradient>
            <linearGradient id="forecast-outflow" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#c05621" stopOpacity={0.4} />
              <stop offset="95%" stopColor="#c05621" stopOpacity={0.03} />
            </linearGradient>
            <linearGradient id="forecast-confidence" x1="0" x2="0" y1="0" y2="1">
              <stop offset="5%" stopColor="#2563eb" stopOpacity={0.18} />
              <stop offset="95%" stopColor="#2563eb" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 8" stroke="#dce3e8" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#66758a', fontSize: 12 }} />
          <YAxis
            tickFormatter={(value) => formatCompactCurrency(value, currencyCode)}
            tickLine={false}
            axisLine={false}
            tick={{ fill: '#66758a', fontSize: 12 }}
            width={88}
          />
          <Tooltip
            contentStyle={{
              borderRadius: 18,
              border: '1px solid rgba(226,232,240,1)',
              background: 'rgba(255,255,255,0.97)',
              boxShadow: '0 20px 40px rgba(15,23,42,0.08)'
            }}
            formatter={(value: number, name: string) => {
              const labelByKey: Record<string, string> = {
                projectedInflow: 'Projected inflow',
                projectedOutflow: 'Projected outflow',
                cumulativeBalance: 'Net cumulative balance',
                confidenceLower: 'Confidence band floor',
                confidenceSpan: 'Confidence band width'
              };

              return [formatCurrency(value, currencyCode), labelByKey[name] ?? name];
            }}
            labelFormatter={(_label, payload) => {
              const point = payload?.[0]?.payload as ForecastAreaChartPoint | undefined;
              return point?.date ?? title;
            }}
          />
          <Legend />
          <Area
            type="monotone"
            dataKey="confidenceLower"
            stackId="confidence"
            stroke="transparent"
            fill="transparent"
            name="confidenceLower"
            legendType="none"
          />
          <Area
            type="monotone"
            dataKey="confidenceSpan"
            stackId="confidence"
            stroke="transparent"
            fill="url(#forecast-confidence)"
            name="confidenceSpan"
          />
          <Area
            type="monotone"
            dataKey="projectedInflow"
            stroke="#2f855a"
            fill="url(#forecast-inflow)"
            strokeWidth={2}
            name="projectedInflow"
          />
          <Area
            type="monotone"
            dataKey="projectedOutflow"
            stroke="#c05621"
            fill="url(#forecast-outflow)"
            strokeWidth={2}
            name="projectedOutflow"
          />
          <Line type="monotone" dataKey="cumulativeBalance" stroke="#2563eb" strokeWidth={3} dot={false} name="cumulativeBalance" />
          {typeof minBuffer === 'number' ? (
            <ReferenceLine
              y={minBuffer}
              stroke="#d69e2e"
              strokeDasharray="6 6"
              ifOverflow="extendDomain"
              label={{ value: 'Minimum buffer', position: 'insideTopRight', fill: '#a86a37', fontSize: 11 }}
            />
          ) : null}
        </AreaChart>
      </ResponsiveContainer>
      <ul className="sr-only">
        {chartData.map((point) => (
          <li key={point.date}>
            {point.date}: inflow {point.projectedInflow}, outflow {point.projectedOutflow}, cumulative balance{' '}
            {point.cumulativeBalance}, confidence low {point.balanceLow}, confidence high {point.balanceHigh}
          </li>
        ))}
      </ul>
    </div>
  );
}
