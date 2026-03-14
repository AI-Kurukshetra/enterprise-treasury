'use client';

import { startTransition, useDeferredValue, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Search } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

type SortDirection = 'asc' | 'desc';

export interface DataTableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => React.ReactNode;
  sortValue?: (row: T) => string | number;
  className?: string;
}

interface DataTableProps<T> {
  title: string;
  caption: string;
  data: T[];
  columns: DataTableColumn<T>[];
  getRowId: (row: T) => string;
  searchPlaceholder: string;
  searchKeys: Array<(row: T) => string>;
  toolbar?: React.ReactNode;
  emptyMessage: string;
  pageSize?: number;
  defaultSortKey?: string;
  defaultSortDirection?: SortDirection;
}

function compareValues(left: string | number, right: string | number, direction: SortDirection) {
  if (typeof left === 'number' && typeof right === 'number') {
    return direction === 'asc' ? left - right : right - left;
  }

  const normalizedLeft = String(left).toLowerCase();
  const normalizedRight = String(right).toLowerCase();
  return direction === 'asc'
    ? normalizedLeft.localeCompare(normalizedRight)
    : normalizedRight.localeCompare(normalizedLeft);
}

export function DataTable<T>({
  title,
  caption,
  data,
  columns,
  getRowId,
  searchPlaceholder,
  searchKeys,
  toolbar,
  emptyMessage,
  pageSize = 8,
  defaultSortKey,
  defaultSortDirection = 'desc'
}: DataTableProps<T>) {
  const [search, setSearch] = useState('');
  const deferredSearch = useDeferredValue(search);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState<{ key: string; direction: SortDirection }>({
    key: defaultSortKey ?? columns[0]?.key ?? 'default',
    direction: defaultSortDirection
  });

  const filteredData = useMemo(() => {
    const query = deferredSearch.trim().toLowerCase();
    if (!query) {
      return data;
    }

    return data.filter((row) =>
      searchKeys.some((getValue) => getValue(row).toLowerCase().includes(query))
    );
  }, [data, deferredSearch, searchKeys]);

  const sortedData = useMemo(() => {
    const sortColumn = columns.find((column) => column.key === sort.key);
    if (!sortColumn?.sortValue) {
      return filteredData;
    }

    return [...filteredData].sort((left: T, right: T) =>
      compareValues(sortColumn.sortValue!(left), sortColumn.sortValue!(right), sort.direction)
    );
  }, [columns, filteredData, sort]);

  const totalPages = Math.max(1, Math.ceil(sortedData.length / pageSize));
  const currentPage = Math.min(page, totalPages);
  const paginatedData = sortedData.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const startCount = sortedData.length === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endCount = sortedData.length === 0 ? 0 : Math.min(currentPage * pageSize, sortedData.length);

  function handleSort(columnKey: string) {
    setSort((current) => {
      if (current.key === columnKey) {
        return { key: columnKey, direction: current.direction === 'asc' ? 'desc' : 'asc' };
      }

      return { key: columnKey, direction: 'asc' };
    });
  }

  function updateSearch(value: string) {
    startTransition(() => {
      setSearch(value);
      setPage(1);
    });
  }

  return (
    <Card className="content-auto">
      <CardHeader className="gap-4 border-b border-slate-100 pb-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <CardTitle>{title}</CardTitle>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <label className="relative block min-w-[260px]" htmlFor={`${title}-search`}>
              <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <span className="sr-only">{searchPlaceholder}</span>
              <Input
                id={`${title}-search`}
                placeholder={searchPlaceholder}
                value={search}
                onChange={(event) => updateSearch(event.target.value)}
                className="pl-10"
              />
            </label>
            {toolbar}
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-0 pb-2">
        <Table>
          <TableCaption className="sr-only">{caption}</TableCaption>
          <TableHeader>
            <TableRow>
              {columns.map((column) => {
                const isActive = sort.key === column.key;
                const Icon = !column.sortValue
                  ? null
                  : isActive
                    ? sort.direction === 'asc'
                      ? ArrowUp
                      : ArrowDown
                    : ArrowUpDown;

                return (
                  <TableHead key={column.key} className={column.className}>
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() => handleSort(column.key)}
                        className="focus-ring inline-flex items-center gap-2 rounded-full px-2 py-1 text-left"
                        aria-label={`Sort by ${column.header}`}
                      >
                        <span>{column.header}</span>
                        {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                      </button>
                    ) : (
                      column.header
                    )}
                  </TableHead>
                );
              })}
            </TableRow>
          </TableHeader>
          <TableBody>
            {paginatedData.length > 0 ? (
              paginatedData.map((row: T) => (
                <TableRow key={getRowId(row)}>
                  {columns.map((column) => (
                    <TableCell key={column.key} className={cn('text-slate-700', column.className)}>
                      {column.render(row)}
                    </TableCell>
                  ))}
                </TableRow>
              ))
            ) : (
              <TableRow>
                <TableCell colSpan={columns.length} className="py-10 text-center text-sm text-slate-500">
                  {emptyMessage}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
        <div className="flex flex-col gap-3 border-t border-slate-100 px-6 py-4 text-sm text-slate-500 md:flex-row md:items-center md:justify-between">
          <p>
            Showing {startCount}-{endCount} of {sortedData.length}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onClick={() => setPage((value) => Math.max(1, value - 1))}
            >
              Previous
            </Button>
            <span className="min-w-20 text-center font-mono text-xs uppercase tracking-[0.18em]">
              {currentPage} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === totalPages}
              onClick={() => setPage((value) => Math.min(totalPages, value + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
