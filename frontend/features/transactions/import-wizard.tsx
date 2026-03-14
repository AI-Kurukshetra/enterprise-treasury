'use client';

import Link from 'next/link';
import {
  startTransition,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CheckCircle2, CircleAlert, Download, FileCog, FileSpreadsheet, Upload } from 'lucide-react';
import { SlideOver } from '@/components/ui/slide-over';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useAccountsQuery } from '@/hooks/use-treasury-queries';
import { getTransactionImportStatus, uploadTransactionImport, type UploadTransactionImportInput } from '@/lib/api';
import { useEvent } from '@/lib/use-event';

type ImportFormat = 'mt940' | 'csv' | 'ofx';
type WizardStep = 1 | 2 | 3 | 4 | 5;

interface CsvPreview {
  headers: string[];
  rows: string[][];
  mapping: Record<string, string>;
}

interface ImportPreview {
  format: ImportFormat;
  fileName: string;
  fileSize: number;
  estimatedCount: number;
  dateRange: string;
  accountHint: string;
  csvPreview?: CsvPreview;
}

const STANDARD_MAPPING_FIELDS = [
  { key: 'bookingDate', label: 'Booking date' },
  { key: 'valueDate', label: 'Value date' },
  { key: 'amount', label: 'Signed amount' },
  { key: 'credit', label: 'Credit column' },
  { key: 'debit', label: 'Debit column' },
  { key: 'direction', label: 'Direction' },
  { key: 'description', label: 'Description' },
  { key: 'bankReference', label: 'Bank reference' },
  { key: 'reference', label: 'Reference' },
  { key: 'currency', label: 'Currency' },
  { key: 'accountId', label: 'Account identifier' }
] as const;

const HEADER_ALIASES: Record<string, string[]> = {
  bookingDate: ['booking date', 'date', 'transaction date', 'posted date', 'book date', 'effective date'],
  valueDate: ['value date', 'settlement date'],
  amount: ['amount', 'transaction amount', 'signed amount', 'net amount'],
  credit: ['credit', 'deposit', 'money in', 'paid in'],
  debit: ['debit', 'withdrawal', 'money out', 'paid out'],
  direction: ['direction', 'type', 'dr cr', 'debit credit'],
  description: ['description', 'details', 'narration', 'memo', 'remittance information'],
  bankReference: ['bank reference', 'reference', 'transaction reference', 'bank ref', 'fitid'],
  reference: ['customer reference', 'beneficiary reference', 'remittance reference', 'payment reference', 'ref'],
  currency: ['currency', 'currency code', 'ccy'],
  accountId: ['account', 'account id', 'account number', 'iban']
};

function bytesToDisplay(size: number): string {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function detectFormat(fileName: string, content: string): ImportFormat {
  const lowerName = fileName.toLowerCase();
  if (lowerName.endsWith('.mt940') || lowerName.endsWith('.sta')) {
    return 'mt940';
  }
  if (lowerName.endsWith('.ofx') || lowerName.endsWith('.qfx')) {
    return 'ofx';
  }
  if (lowerName.endsWith('.csv')) {
    return 'csv';
  }
  const trimmed = content.trimStart();
  if (trimmed.startsWith('{1:') || trimmed.includes(':20:') || trimmed.includes(':61:')) {
    return 'mt940';
  }
  if (trimmed.startsWith('<OFX') || trimmed.startsWith('OFXHEADER:')) {
    return 'ofx';
  }
  return 'csv';
}

function sanitizeHeader(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];

    if (character === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
      continue;
    }

    current += character;
  }

  result.push(current.trim());
  return result;
}

function detectDelimiter(lines: string[]): string {
  const candidates = [',', ';', '|', '\t'];
  let bestDelimiter = ',';
  let bestScore = -1;

  for (const candidate of candidates) {
    const widths = lines.slice(0, 5).map((line) => splitCsvLine(line, candidate).length);
    const minWidth = widths.length > 0 ? Math.min(...widths) : 0;
    const score = widths.filter((width) => width > 1).length * 100 + minWidth;
    if (score > bestScore) {
      bestScore = score;
      bestDelimiter = candidate;
    }
  }

  return bestDelimiter;
}

function detectCsvMapping(headers: string[]): Record<string, string> {
  const mapping: Record<string, string> = {};
  const normalizedHeaders = headers.map((header) => sanitizeHeader(header));

  for (const field of STANDARD_MAPPING_FIELDS) {
    const aliases = HEADER_ALIASES[field.key] ?? [];
    const index = normalizedHeaders.findIndex((header) => aliases.includes(header));
    if (index >= 0) {
      mapping[field.key] = headers[index] ?? '';
    }
  }

  return mapping;
}

function buildPreview(file: File, content: string): ImportPreview {
  const format = detectFormat(file.name, content);

  if (format === 'csv') {
    const lines = content.split(/\r?\n/).filter((line) => line.trim().length > 0);
    const delimiter = detectDelimiter(lines);
    const headers = splitCsvLine(lines[0] ?? '', delimiter);
    const rows = lines.slice(1, 6).map((line) => splitCsvLine(line, delimiter));
    const mapping = detectCsvMapping(headers);
    const bookingDateIndex = headers.indexOf(mapping.bookingDate ?? '');
    const bookingDates =
      bookingDateIndex >= 0 ? rows.map((row) => row[bookingDateIndex] ?? '').filter((value) => value.length > 0) : [];

    return {
      format,
      fileName: file.name,
      fileSize: file.size,
      estimatedCount: Math.max(lines.length - 1, 0),
      dateRange:
        bookingDates.length > 0 ? `${bookingDates[0]} to ${bookingDates[bookingDates.length - 1]}` : 'Date range unavailable',
      accountHint: 'CSV import requires account selection',
      csvPreview: {
        headers,
        rows,
        mapping
      }
    };
  }

  if (format === 'mt940') {
    const accountMatch = content.match(/:25:(.+)/);
    const bookingDates = Array.from(content.matchAll(/:61:(\d{6})/g)).map((match) => match[1] ?? '');
    return {
      format,
      fileName: file.name,
      fileSize: file.size,
      estimatedCount: bookingDates.length,
      dateRange: bookingDates.length > 0 ? `${bookingDates[0]} to ${bookingDates[bookingDates.length - 1]}` : 'Date range unavailable',
      accountHint: accountMatch?.[1]?.trim() ?? 'Account identifier unavailable'
    };
  }

  const accountMatch = content.match(/<ACCTID>([^<\r\n]+)/i);
  const postedDates = Array.from(content.matchAll(/<DTPOSTED>(\d{8})/gi)).map((match) => match[1] ?? '');
  return {
    format,
    fileName: file.name,
    fileSize: file.size,
    estimatedCount: Array.from(content.matchAll(/<STMTTRN>/gi)).length,
    dateRange: postedDates.length > 0 ? `${postedDates[0]} to ${postedDates[postedDates.length - 1]}` : 'Date range unavailable',
    accountHint: accountMatch?.[1]?.trim() ?? 'Account identifier unavailable'
  };
}

export function ImportWizard() {
  const queryClient = useQueryClient();
  const accountsQuery = useAccountsQuery();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<WizardStep>(1);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<Awaited<ReturnType<typeof getTransactionImportStatus>> | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const deferredPreview = useDeferredValue(preview);

  const accountOptions = useMemo(
    () =>
      (accountsQuery.data?.items ?? []).map((account) => ({
        id: account.id,
        label: `${account.account_name} · ${account.currency_code}`
      })),
    [accountsQuery.data?.items]
  );

  const resetWizard = () => {
    setStep(1);
    setSelectedFile(null);
    setPreview(null);
    setSelectedAccountId('');
    setJobId(null);
    setJobStatus(null);
    setSubmitting(false);
    setDragging(false);
    setErrorMessage(null);
  };

  const closeWizard = () => {
    resetWizard();
    setOpen(false);
  };

  const advanceTo = (nextStep: WizardStep) => {
    startTransition(() => {
      setStep(nextStep);
    });
  };

  const loadFile = async (file: File) => {
    const content = await file.text();
    setSelectedFile(file);
    setPreview(buildPreview(file, content));
    setErrorMessage(null);
    advanceTo(2);
  };

  const handleStatusPoll = useEvent(async () => {
    if (!jobId) {
      return;
    }

    const nextStatus = await getTransactionImportStatus(jobId);
    setJobStatus(nextStatus);

    if (nextStatus.status === 'completed' || nextStatus.status === 'partial' || nextStatus.status === 'failed') {
      await queryClient.invalidateQueries({ queryKey: ['transactions'] });
      advanceTo(5);
    }
  });

  useEffect(() => {
    if (step !== 4 || !jobId) {
      return;
    }

    const intervalId = window.setInterval(() => {
      void handleStatusPoll();
    }, 2_000);

    void handleStatusPoll();
    return () => window.clearInterval(intervalId);
  }, [handleStatusPoll, jobId, step]);

  const startImport = async () => {
    if (!selectedFile || !preview || !selectedAccountId) {
      setErrorMessage('Select a file and destination account before starting the import.');
      return;
    }

    setSubmitting(true);
    setErrorMessage(null);

    try {
      const payload: UploadTransactionImportInput = {
        bankAccountId: selectedAccountId,
        file: selectedFile,
        csvColumnMapping: preview.csvPreview?.mapping
      };
      const response = await uploadTransactionImport(payload);
      setJobId(response.jobId);
      setJobStatus({
        id: response.jobId,
        status: 'queued',
        total: preview.estimatedCount,
        imported: 0,
        duplicates: 0,
        errors: 0,
        warnings: 0
      });
      advanceTo(4);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Import could not be started');
    } finally {
      setSubmitting(false);
    }
  };

  const downloadErrorReport = () => {
    if (!jobStatus?.errorReport) {
      return;
    }

    const blob = new Blob([JSON.stringify(jobStatus.errorReport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `transaction-import-errors-${jobStatus.id}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Upload className="h-4 w-4" />
        Import transactions
      </Button>
      <SlideOver
        open={open}
        onClose={closeWizard}
        title="Bank Statement Import"
        description="Move from raw bank files to validated treasury transactions with parser checks, dedupe, and reconciliation polling."
        className="max-w-4xl"
      >
        <div className="space-y-6">
          <div className="flex flex-wrap items-center gap-3">
            {[1, 2, 3, 4, 5].map((index) => (
              <div key={index} className="flex items-center gap-3">
                <div
                  className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold ${
                    step >= index ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {index}
                </div>
                {index < 5 ? <div className="h-px w-8 bg-slate-200" /> : null}
              </div>
            ))}
          </div>

          {step === 1 ? (
            <Card>
              <CardHeader>
                <CardDescription>Step 1</CardDescription>
                <CardTitle>Drop a bank statement</CardTitle>
              </CardHeader>
              <CardContent>
                <button
                  type="button"
                  className={`flex w-full flex-col items-center justify-center rounded-[2rem] border border-dashed px-6 py-12 text-center transition ${
                    dragging ? 'border-slate-950 bg-slate-50' : 'border-slate-300 bg-white'
                  }`}
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    const nextFile = event.dataTransfer.files?.[0];
                    if (nextFile) {
                      void loadFile(nextFile);
                    }
                  }}
                >
                  <FileSpreadsheet className="h-10 w-10 text-slate-400" />
                  <p className="mt-4 text-lg font-semibold text-slate-950">Drag a file here or click to browse</p>
                  <p className="mt-2 text-sm text-slate-500">Accepted: `.sta`, `.mt940`, `.csv`, `.ofx`, `.qfx`</p>
                </button>
                <input
                  ref={fileInputRef}
                  className="hidden"
                  type="file"
                  accept=".sta,.mt940,.csv,.ofx,.qfx"
                  onChange={(event) => {
                    const nextFile = event.target.files?.[0];
                    if (nextFile) {
                      void loadFile(nextFile);
                    }
                  }}
                />
              </CardContent>
            </Card>
          ) : null}

          {step === 2 && deferredPreview ? (
            <Card>
              <CardHeader>
                <CardDescription>Step 2</CardDescription>
                <CardTitle>Confirm parser preview</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant="outline">{deferredPreview.fileName}</Badge>
                  <Badge variant="secondary">{bytesToDisplay(deferredPreview.fileSize)}</Badge>
                  <Badge variant="success">{deferredPreview.format.toUpperCase()}</Badge>
                  <Badge variant="warning">{`${deferredPreview.estimatedCount} estimated`}</Badge>
                </div>

                {deferredPreview.csvPreview ? (
                  <>
                    {(() => {
                      const csvPreview = deferredPreview.csvPreview!;
                      return (
                        <>
                    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                      {STANDARD_MAPPING_FIELDS.map((field) => (
                        <label key={field.key} className="space-y-2">
                          <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
                            {field.label}
                          </span>
                          <Select
                            value={deferredPreview.csvPreview?.mapping[field.key] ?? ''}
                            onChange={(event) =>
                              setPreview((current) =>
                                current?.csvPreview
                                  ? {
                                      ...current,
                                      csvPreview: {
                                        ...current.csvPreview,
                                        mapping: {
                                          ...current.csvPreview.mapping,
                                          [field.key]: event.target.value
                                        }
                                      }
                                    }
                                  : current
                              )
                            }
                          >
                            <option value="">Unmapped</option>
                            {csvPreview.headers.map((header) => (
                              <option key={header} value={header}>
                                {header}
                              </option>
                            ))}
                          </Select>
                        </label>
                      ))}
                    </div>
                    <div className="overflow-x-auto rounded-[1.75rem] border border-slate-200">
                      <table className="min-w-full divide-y divide-slate-200 text-sm">
                        <thead className="bg-slate-50">
                          <tr>
                            {csvPreview.headers.map((header) => (
                              <th key={header} className="px-4 py-3 text-left font-semibold text-slate-700">
                                {header}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 bg-white">
                          {csvPreview.rows.map((row, rowIndex) => (
                            <tr key={`${rowIndex}-${row.join('|')}`}>
                              {csvPreview.headers.map((header, columnIndex) => {
                                const mappedField = Object.entries(csvPreview.mapping).find(
                                  ([, value]) => value === header
                                )?.[0];
                                return (
                                  <td key={`${header}-${columnIndex}`} className="px-4 py-3 text-slate-600">
                                    <div className="space-y-1">
                                      <p>{row[columnIndex] ?? ''}</p>
                                      {mappedField ? (
                                        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                                          {mappedField}
                                        </p>
                                      ) : null}
                                    </div>
                                  </td>
                                );
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                        </>
                      );
                    })()}
                  </>
                ) : (
                  <div className="grid gap-4 md:grid-cols-3">
                    <Card>
                      <CardHeader>
                        <CardDescription>Detected account</CardDescription>
                        <CardTitle>{deferredPreview.accountHint}</CardTitle>
                      </CardHeader>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardDescription>Date range</CardDescription>
                        <CardTitle>{deferredPreview.dateRange}</CardTitle>
                      </CardHeader>
                    </Card>
                    <Card>
                      <CardHeader>
                        <CardDescription>Estimated rows</CardDescription>
                        <CardTitle>{String(deferredPreview.estimatedCount)}</CardTitle>
                      </CardHeader>
                    </Card>
                  </div>
                )}

                <div className="flex justify-end">
                  <Button onClick={() => advanceTo(3)}>
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {step === 3 && preview ? (
            <Card>
              <CardHeader>
                <CardDescription>Step 3</CardDescription>
                <CardTitle>Confirm import</CardTitle>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Destination account</span>
                    <Select value={selectedAccountId} onChange={(event) => setSelectedAccountId(event.target.value)}>
                      <option value="">Select an account</option>
                      {accountOptions.map((account) => (
                        <option key={account.id} value={account.id}>
                          {account.label}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">Selected file</span>
                    <Input value={preview.fileName} readOnly />
                  </label>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <Card>
                    <CardHeader>
                      <CardDescription>Detected format</CardDescription>
                      <CardTitle>{preview.format.toUpperCase()}</CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardDescription>Date range</CardDescription>
                      <CardTitle>{preview.dateRange}</CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardDescription>Estimated count</CardDescription>
                      <CardTitle>{String(preview.estimatedCount)}</CardTitle>
                    </CardHeader>
                  </Card>
                </div>
                {errorMessage ? (
                  <div className="flex items-center gap-3 rounded-[1.5rem] bg-rose-50 px-4 py-3 text-sm text-rose-700">
                    <CircleAlert className="h-4 w-4" />
                    {errorMessage}
                  </div>
                ) : null}
                <div className="flex justify-end">
                  <Button onClick={startImport} disabled={submitting || !selectedAccountId}>
                    <FileCog className="h-4 w-4" />
                    {submitting ? 'Starting import...' : 'Start Import'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ) : null}

          {step === 4 ? (
            <Card>
              <CardHeader>
                <CardDescription>Step 4</CardDescription>
                <CardTitle>Processing statement</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-slate-950 transition-all"
                    style={{
                      width:
                        jobStatus && jobStatus.total > 0
                          ? `${Math.min(100, ((jobStatus.imported + jobStatus.duplicates + jobStatus.errors) / jobStatus.total) * 100)}%`
                          : '10%'
                    }}
                  />
                </div>
                <div className="grid gap-4 md:grid-cols-4">
                  {[
                    ['Imported', jobStatus?.imported ?? 0],
                    ['Duplicates', jobStatus?.duplicates ?? 0],
                    ['Errors', jobStatus?.errors ?? 0],
                    ['Warnings', jobStatus?.warnings ?? 0]
                  ].map(([label, value]) => (
                    <Card key={label}>
                      <CardHeader>
                        <CardDescription>{label}</CardDescription>
                        <CardTitle>{String(value)}</CardTitle>
                      </CardHeader>
                    </Card>
                  ))}
                </div>
                <p className="text-sm text-slate-500">Polling job status every 2 seconds while the backend parses, deduplicates, inserts, and reconciles the imported transactions.</p>
              </CardContent>
            </Card>
          ) : null}

          {step === 5 ? (
            <Card>
              <CardHeader>
                <CardDescription>Step 5</CardDescription>
                <CardTitle>Import summary</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="flex flex-wrap items-center gap-3">
                  <Badge variant={jobStatus?.status === 'failed' ? 'danger' : jobStatus?.status === 'partial' ? 'warning' : 'success'}>
                    {jobStatus?.status ?? 'completed'}
                  </Badge>
                  <Badge variant="secondary">{`${jobStatus?.imported ?? 0} imported`}</Badge>
                  <Badge variant="secondary">{`${jobStatus?.duplicates ?? 0} duplicates`}</Badge>
                  <Badge variant="secondary">{`${jobStatus?.errors ?? 0} errors`}</Badge>
                </div>
                <div className="grid gap-4 md:grid-cols-3">
                  <Card>
                    <CardHeader>
                      <CardDescription>Imported rows</CardDescription>
                      <CardTitle>{String(jobStatus?.imported ?? 0)}</CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardDescription>Duplicates skipped</CardDescription>
                      <CardTitle>{String(jobStatus?.duplicates ?? 0)}</CardTitle>
                    </CardHeader>
                  </Card>
                  <Card>
                    <CardHeader>
                      <CardDescription>Error entries</CardDescription>
                      <CardTitle>{String(jobStatus?.errors ?? 0)}</CardTitle>
                    </CardHeader>
                  </Card>
                </div>
                <div className="flex flex-wrap gap-3">
                  {jobStatus?.errors ? (
                    <Button variant="outline" onClick={downloadErrorReport}>
                      <Download className="h-4 w-4" />
                      Download error report
                    </Button>
                  ) : null}
                  <Button asChild>
                    <Link href="/transactions">
                      <CheckCircle2 className="h-4 w-4" />
                      View imported transactions
                    </Link>
                  </Button>
                  <Button variant="ghost" onClick={closeWizard}>
                    Close
                  </Button>
                </div>
                {jobStatus?.warnings ? (
                  <p className="rounded-[1.5rem] bg-amber-50 px-4 py-3 text-sm text-amber-800">
                    {jobStatus.warnings} warnings were recorded. Review the error report for the detailed parser notes.
                  </p>
                ) : null}
              </CardContent>
            </Card>
          ) : null}
        </div>
      </SlideOver>
    </>
  );
}
