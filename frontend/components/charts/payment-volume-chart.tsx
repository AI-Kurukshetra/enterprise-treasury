'use client';

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import type { PaymentVolumePoint } from '@/lib/types';

export function PaymentVolumeChart({
  data,
  title
}: {
  data: PaymentVolumePoint[];
  title: string;
}) {
  return (
    <div className="h-[280px]" role="img" aria-label={title}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 12, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 8" stroke="#dce3e8" vertical={false} />
          <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fill: '#66758a', fontSize: 12 }} />
          <YAxis tickLine={false} axisLine={false} tick={{ fill: '#66758a', fontSize: 12 }} width={48} />
          <Tooltip
            contentStyle={{
              borderRadius: 18,
              border: '1px solid rgba(226,232,240,1)',
              background: 'rgba(255,255,255,0.95)'
            }}
          />
          <Legend />
          <Bar dataKey="urgent" fill="#a86a37" radius={[6, 6, 0, 0]} />
          <Bar dataKey="scheduled" fill="#1f2937" radius={[6, 6, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
      <ul className="sr-only">
        {data.map((point) => (
          <li key={point.label}>
            {point.label}: urgent {point.urgent}, scheduled {point.scheduled}
          </li>
        ))}
      </ul>
    </div>
  );
}
