const counters = new Map<string, number>();
const timings = new Map<string, number[]>();

export function incrementCounter(metricName: string): void {
  const existing = counters.get(metricName) ?? 0;
  counters.set(metricName, existing + 1);
}

export function readCounter(metricName: string): number {
  return counters.get(metricName) ?? 0;
}

export function recordTiming(metricName: string, valueMs: number): void {
  const existing = timings.get(metricName) ?? [];
  existing.push(valueMs);
  timings.set(metricName, existing);
}

export function readTimings(metricName: string): number[] {
  return timings.get(metricName) ?? [];
}

export function resetMetrics(): void {
  counters.clear();
  timings.clear();
}
