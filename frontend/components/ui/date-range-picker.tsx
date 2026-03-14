'use client';

import { startTransition, useEffect, useMemo, useState } from 'react';
import { CalendarRange } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface DateRangeValue {
  from: Date;
  to: Date;
}

interface DateRangePickerProps {
  value?: DateRangeValue;
  onChange?: (value: DateRangeValue) => void;
  className?: string;
}

function toInputValue(date: Date) {
  return date.toISOString().slice(0, 10);
}

function fromInputValue(value: string) {
  return new Date(`${value}T00:00:00.000Z`);
}

function startOfCurrentMonth() {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
}

function endOfCurrentMonth() {
  const today = new Date();
  return new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0));
}

function resolvePreset(preset: 'today' | 'last7' | 'last30' | 'thisMonth' | 'lastQuarter'): DateRangeValue {
  const today = new Date();
  const utcToday = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  if (preset === 'today') {
    return { from: utcToday, to: utcToday };
  }

  if (preset === 'last7') {
    return {
      from: new Date(Date.UTC(utcToday.getUTCFullYear(), utcToday.getUTCMonth(), utcToday.getUTCDate() - 6)),
      to: utcToday
    };
  }

  if (preset === 'last30') {
    return {
      from: new Date(Date.UTC(utcToday.getUTCFullYear(), utcToday.getUTCMonth(), utcToday.getUTCDate() - 29)),
      to: utcToday
    };
  }

  if (preset === 'thisMonth') {
    return {
      from: startOfCurrentMonth(),
      to: endOfCurrentMonth()
    };
  }

  const quarter = Math.floor(utcToday.getUTCMonth() / 3);
  const currentQuarterStartMonth = quarter * 3;
  const lastQuarterStartMonth = currentQuarterStartMonth - 3;
  const year = lastQuarterStartMonth < 0 ? utcToday.getUTCFullYear() - 1 : utcToday.getUTCFullYear();
  const normalizedStartMonth = lastQuarterStartMonth < 0 ? lastQuarterStartMonth + 12 : lastQuarterStartMonth;

  return {
    from: new Date(Date.UTC(year, normalizedStartMonth, 1)),
    to: new Date(Date.UTC(year, normalizedStartMonth + 3, 0))
  };
}

export function DateRangePicker({ value, onChange, className }: DateRangePickerProps) {
  const defaultValue = useMemo<DateRangeValue>(
    () =>
      value ?? {
        from: startOfCurrentMonth(),
        to: endOfCurrentMonth()
      },
    [value]
  );
  const [from, setFrom] = useState(toInputValue(defaultValue.from));
  const [to, setTo] = useState(toInputValue(defaultValue.to));

  useEffect(() => {
    setFrom(toInputValue(defaultValue.from));
    setTo(toInputValue(defaultValue.to));
  }, [defaultValue]);

  const validationMessage = useMemo(() => {
    if (!from || !to) {
      return 'Select both dates.';
    }

    if (from > to) {
      return 'From date must be on or before the To date.';
    }

    return null;
  }, [from, to]);

  useEffect(() => {
    if (!onChange || validationMessage) {
      return;
    }

    startTransition(() => {
      onChange({
        from: fromInputValue(from),
        to: fromInputValue(to)
      });
    });
  }, [from, onChange, to, validationMessage]);

  function applyPreset(preset: 'today' | 'last7' | 'last30' | 'thisMonth' | 'lastQuarter') {
    const next = resolvePreset(preset);
    setFrom(toInputValue(next.from));
    setTo(toInputValue(next.to));
  }

  return (
    <div className={cn('rounded-[28px] border border-slate-200 bg-white/90 p-4 shadow-sm', className)}>
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-950 text-slate-50">
          <CalendarRange className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-950">Date range</p>
          <p className="text-xs text-slate-500">Two-field picker with fast treasury presets.</p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">From</span>
          <Input type="date" value={from} onChange={(event) => setFrom(event.target.value)} max={to || undefined} />
        </label>
        <label className="space-y-2">
          <span className="text-xs font-medium uppercase tracking-[0.18em] text-slate-500">To</span>
          <Input type="date" value={to} onChange={(event) => setTo(event.target.value)} min={from || undefined} />
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={() => applyPreset('today')}>
          Today
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => applyPreset('last7')}>
          Last 7 days
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => applyPreset('last30')}>
          Last 30 days
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => applyPreset('thisMonth')}>
          This month
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => applyPreset('lastQuarter')}>
          Last quarter
        </Button>
      </div>

      {validationMessage ? <p className="mt-3 text-sm text-rose-600">{validationMessage}</p> : null}
    </div>
  );
}
