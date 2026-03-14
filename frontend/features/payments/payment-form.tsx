'use client';

import { startTransition, useDeferredValue, useEffect, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { z } from 'zod';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { PolicyViolationBanner } from '@/features/payments/policy-violation-banner';
import { ApiError, type CreatePaymentInput } from '@/lib/api';
import { compareDecimalStrings, toFixedAmount } from '@/lib/decimal';
import { formatCurrency } from '@/lib/format';
import {
  useAccountsQuery,
  useCounterpartiesQuery,
  useCreatePaymentMutation
} from '@/hooks/use-treasury-queries';
import type { Payment, PolicyViolation, PolicyWarning } from '@/lib/types';

interface PaymentFormProps {
  onCancel: () => void;
  onSuccess?: (payment: Payment) => void;
}

interface PaymentFormState {
  paymentReference: string;
  sourceAccountId: string;
  beneficiaryCounterpartyId: string;
  beneficiarySearch: string;
  amount: string;
  currencyCode: string;
  valueDate: string;
  purpose: string;
  idempotencyKey: string;
}

const amountPattern = /^\d{0,13}(\.\d{0,2})?$/;
const isoCurrencySet = getSupportedCurrencyCodes();

const PaymentFormSchema = z
  .object({
    paymentReference: z.string().min(1).max(80),
    sourceAccountId: z.string().uuid('Select a source account'),
    beneficiaryCounterpartyId: z.string().uuid('Select a beneficiary'),
    amount: z
      .string()
      .min(1, 'Enter an amount')
      .regex(/^\d{1,13}(\.\d{1,2})?$/, 'Use up to 13 digits and 2 decimals')
      .refine(
        (value) => (/^\d{1,13}(\.\d{1,2})?$/.test(value) ? compareDecimalStrings(value, '0') > 0 : true),
        'Amount must be greater than zero'
      ),
    currencyCode: z.string().refine((value) => isoCurrencySet.has(value.toUpperCase()), 'Select a valid ISO 4217 currency'),
    valueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Enter a valid value date')
      .refine((value) => !isPastDate(value), 'Value date cannot be in the past')
      .refine((value) => !isWeekend(value), 'Value date cannot fall on a weekend'),
    purpose: z
      .string()
      .trim()
      .min(3, 'Purpose must be at least 3 characters')
      .max(140, 'Purpose must be 140 characters or fewer')
  })
  .superRefine((value, context) => {
    if (!isoCurrencySet.has(value.currencyCode.toUpperCase())) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['currencyCode'],
        message: 'Select a valid ISO 4217 currency'
      });
    }
  });

export function PaymentForm({ onCancel, onSuccess }: PaymentFormProps) {
  const router = useRouter();
  const datalistId = useId();
  const [form, setForm] = useState<PaymentFormState>(() => createInitialState());
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [liveMessage, setLiveMessage] = useState<string>('');
  const [createdPayment, setCreatedPayment] = useState<Payment | null>(null);
  const [policyViolations, setPolicyViolations] = useState<PolicyViolation[]>([]);
  const [policyWarnings, setPolicyWarnings] = useState<PolicyWarning[]>([]);
  const deferredBeneficiarySearch = useDeferredValue(form.beneficiarySearch);

  const accountsQuery = useAccountsQuery({ status: 'active', limit: 100 });
  const counterpartiesQuery = useCounterpartiesQuery({ limit: 100 });
  const createPaymentMutation = useCreatePaymentMutation();

  const accounts = accountsQuery.data?.items ?? [];
  const counterparties = counterpartiesQuery.data?.items ?? [];
  const selectedAccount = accounts.find((account) => account.id === form.sourceAccountId) ?? null;
  const availableBalance = selectedAccount?.available_balance ?? null;
  const selectedCounterparty = counterparties.find(
    (counterparty) => counterparty.id === form.beneficiaryCounterpartyId
  );

  const currencyOptions = useMemo(() => {
    const optionSet = new Set<string>();

    if (selectedAccount?.currency_code) {
      optionSet.add(selectedAccount.currency_code);
    }

    for (const account of accounts) {
      optionSet.add(account.currency_code);
    }

    return Array.from(optionSet).sort();
  }, [accounts, selectedAccount?.currency_code]);

  const filteredCounterparties = useMemo(() => {
    const query = deferredBeneficiarySearch.trim().toLowerCase();
    if (!query) {
      return counterparties;
    }

    return counterparties.filter((counterparty) => {
      const haystack = `${counterparty.name} ${counterparty.type} ${counterparty.country_code ?? ''}`.toLowerCase();
      return haystack.includes(query);
    });
  }, [counterparties, deferredBeneficiarySearch]);

  const balanceIndicator = useMemo(() => {
    if (!selectedAccount || !form.amount || !availableBalance) {
      return null;
    }

    try {
      const normalizedAmount = toFixedAmount(form.amount);
      if (!normalizedAmount) {
        return null;
      }

      const isSufficient = compareDecimalStrings(availableBalance, normalizedAmount) >= 0;
      return {
        label: isSufficient ? 'Sufficient balance' : 'Insufficient balance',
        variant: isSufficient ? 'success' : 'danger',
        detail: `${formatCurrency(availableBalance, selectedAccount.currency_code)} available`
      } as const;
    } catch {
      return null;
    }
  }, [availableBalance, form.amount, selectedAccount]);

  useEffect(() => {
    if (!selectedAccount) {
      return;
    }

    setForm((current) => ({
      ...current,
      currencyCode: selectedAccount.currency_code
    }));
  }, [selectedAccount]);

  useEffect(() => {
    if (!createdPayment) {
      return;
    }

    const timeout = window.setTimeout(() => {
      router.replace('/payments');
      router.refresh();
      onSuccess?.(createdPayment);
      onCancel();
    }, 1200);

    return () => window.clearTimeout(timeout);
  }, [createdPayment, onCancel, onSuccess, router]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);
    setLiveMessage('');
    setPolicyViolations([]);
    setPolicyWarnings([]);

    const candidate = {
      paymentReference: form.paymentReference,
      sourceAccountId: form.sourceAccountId,
      beneficiaryCounterpartyId: form.beneficiaryCounterpartyId,
      amount: toFixedAmount(form.amount),
      currencyCode: form.currencyCode.toUpperCase(),
      valueDate: form.valueDate,
      purpose: form.purpose.trim()
    };

    const parsed = PaymentFormSchema.safeParse(candidate);
    const nextFieldErrors = parsed.success ? {} : mapZodErrors(parsed.error);

    if (
      selectedAccount &&
      parsed.success &&
      candidate.currencyCode !== selectedAccount.currency_code
    ) {
      nextFieldErrors.currencyCode = `Payment currency must match ${selectedAccount.currency_code}`;
    }

    if (availableBalance && parsed.success && compareDecimalStrings(availableBalance, candidate.amount) < 0) {
      nextFieldErrors.amount = 'Selected account does not have sufficient available balance';
    }

    setFieldErrors(nextFieldErrors);

    if (Object.keys(nextFieldErrors).length > 0 || !parsed.success) {
      setLiveMessage('Payment form has validation errors.');
      return;
    }

    try {
      const payload: CreatePaymentInput = {
        ...candidate,
        idempotencyKey: form.idempotencyKey
      };

      const payment = await createPaymentMutation.mutateAsync(payload);
      setCreatedPayment(payment);
      setPolicyWarnings(payment.policy_warnings ?? []);
      setLiveMessage(`Payment ${payment.payment_reference} created successfully.`);
    } catch (error) {
      const apiError = error instanceof ApiError ? error : null;
      const apiFieldErrors = mapApiFieldErrors(apiError);
      const violations = extractPolicyViolations(apiError);
      const warnings = extractPolicyWarnings(apiError);

      setFieldErrors((current) => ({
        ...current,
        ...apiFieldErrors
      }));
      setPolicyViolations(violations);
      setPolicyWarnings(warnings);
      setFormError(violations.length > 0 ? null : (apiError?.message ?? 'Payment could not be submitted.'));
      setLiveMessage(apiError?.message ?? 'Payment submission failed.');
    }
  }

  function updateField<Key extends keyof PaymentFormState>(key: Key, value: PaymentFormState[Key]) {
    setFieldErrors((current) => {
      if (!current[key]) {
        return current;
      }

      const next = { ...current };
      delete next[key];
      return next;
    });

    setForm((current) => ({
      ...current,
      [key]: value
    }));
  }

  function handleAmountChange(value: string) {
    const normalized = value.replace(/[^\d.]/g, '');
    if (normalized === '' || amountPattern.test(normalized)) {
      updateField('amount', normalized);
    }
  }

  function handleCounterpartyInput(value: string) {
    const match = counterparties.find((counterparty) => counterparty.name === value) ?? null;

    startTransition(() => {
      setForm((current) => ({
        ...current,
        beneficiarySearch: value,
        beneficiaryCounterpartyId: match?.id ?? ''
      }));
    });
  }

  return (
    <div className="space-y-6">
      <div className="sr-only" aria-live="polite" role="status">
        {liveMessage}
      </div>
      {createdPayment ? (
        <Card className="border-emerald-200 bg-emerald-50/80">
          <CardHeader>
            <CardDescription>Payment created</CardDescription>
            <CardTitle className="text-emerald-950">{createdPayment.payment_reference}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-emerald-900">The instruction has entered the approval workflow. Returning to the payment queue.</p>
            <div className="mt-4">
              <PolicyViolationBanner warnings={policyWarnings} />
            </div>
          </CardContent>
        </Card>
      ) : null}
      <form className="space-y-6" onSubmit={handleSubmit} noValidate>
        <PolicyViolationBanner violations={policyViolations} warnings={!createdPayment ? policyWarnings : []} />
        <Card>
          <CardHeader>
            <CardDescription>Instruction metadata</CardDescription>
            <CardTitle>Payment initiation</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 md:grid-cols-2">
            <FormField
              label="Payment reference"
              htmlFor="paymentReference"
              error={fieldErrors.paymentReference}
              helperText="Generated reference for audit and reconciliation."
            >
              <Input id="paymentReference" value={form.paymentReference} readOnly aria-readonly="true" />
            </FormField>
            <FormField
              label="Idempotency key"
              htmlFor="idempotencyKey"
              error={fieldErrors.idempotencyKey}
              helperText="Used to guarantee replay-safe submission."
            >
              <Input id="idempotencyKey" value={form.idempotencyKey} readOnly aria-readonly="true" />
            </FormField>
            <FormField
              label="Source account"
              htmlFor="sourceAccountId"
              error={fieldErrors.sourceAccountId}
              helperText={
                balanceIndicator ? (
                  <span className="inline-flex items-center gap-2">
                    <Badge variant={balanceIndicator.variant}>{balanceIndicator.label}</Badge>
                    <span>{balanceIndicator.detail}</span>
                  </span>
                ) : accountsQuery.isLoading ? (
                  'Checking latest available balance...'
                ) : (
                  'Choose the funding account for this payment.'
                )
              }
            >
              <Select
                id="sourceAccountId"
                value={form.sourceAccountId}
                onChange={(event) => updateField('sourceAccountId', event.target.value)}
                aria-invalid={Boolean(fieldErrors.sourceAccountId)}
              >
                <option value="">Select source account</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.account_name} · {account.account_number_masked} · {account.currency_code}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField
              label="Beneficiary"
              htmlFor="beneficiarySearch"
              error={fieldErrors.beneficiaryCounterpartyId}
              helperText={
                selectedCounterparty
                  ? `${selectedCounterparty.type} · ${selectedCounterparty.country_code ?? 'No country'}`
                  : 'Search the approved counterparty directory.'
              }
            >
              <Input
                id="beneficiarySearch"
                list={datalistId}
                value={form.beneficiarySearch}
                onChange={(event) => handleCounterpartyInput(event.target.value)}
                placeholder="Search by counterparty name"
                aria-invalid={Boolean(fieldErrors.beneficiaryCounterpartyId)}
              />
              <datalist id={datalistId}>
                {filteredCounterparties.map((counterparty) => (
                  <option key={counterparty.id} value={counterparty.name}>
                    {counterparty.type}
                  </option>
                ))}
              </datalist>
            </FormField>
            <FormField
              label="Amount"
              htmlFor="amount"
              error={fieldErrors.amount}
              helperText="Amount is submitted as a string to preserve decimal precision."
            >
              <div className="grid gap-3 sm:grid-cols-[1fr_132px]">
                <Input
                  id="amount"
                  inputMode="decimal"
                  placeholder="0.00"
                  value={form.amount}
                  onChange={(event) => handleAmountChange(event.target.value)}
                  aria-invalid={Boolean(fieldErrors.amount)}
                />
                <Select
                  value={form.currencyCode}
                  onChange={(event) => updateField('currencyCode', event.target.value)}
                  aria-invalid={Boolean(fieldErrors.currencyCode)}
                >
                  <option value="">Currency</option>
                  {currencyOptions.map((currencyCode) => (
                    <option key={currencyCode} value={currencyCode}>
                      {currencyCode}
                    </option>
                  ))}
                </Select>
              </div>
            </FormField>
            <FormField
              label="Value date"
              htmlFor="valueDate"
              error={fieldErrors.valueDate}
              helperText="Weekend and past-date value instructions are blocked."
            >
              <Input
                id="valueDate"
                type="date"
                min={todayString()}
                value={form.valueDate}
                onChange={(event) => updateField('valueDate', event.target.value)}
                aria-invalid={Boolean(fieldErrors.valueDate)}
              />
            </FormField>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardDescription>Instruction narrative</CardDescription>
            <CardTitle>Purpose and internal context</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <FormField
              label="Purpose / reference"
              htmlFor="purpose"
              error={fieldErrors.purpose}
              helperText={`${form.purpose.length}/140 characters`}
            >
              <Input
                id="purpose"
                maxLength={140}
                value={form.purpose}
                onChange={(event) => updateField('purpose', event.target.value)}
                placeholder="Invoice settlement, tax remittance, intercompany funding..."
                aria-invalid={Boolean(fieldErrors.purpose)}
              />
            </FormField>
            {formError ? (
              <p className="rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">{formError}</p>
            ) : null}
          </CardContent>
        </Card>
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onCancel} disabled={createPaymentMutation.isPending}>
            Cancel
          </Button>
          <Button type="submit" disabled={createPaymentMutation.isPending || accountsQuery.isLoading || counterpartiesQuery.isLoading}>
            {createPaymentMutation.isPending ? 'Submitting payment...' : 'Submit payment'}
          </Button>
        </div>
      </form>
    </div>
  );
}

function FormField({
  label,
  htmlFor,
  error,
  helperText,
  children
}: {
  label: string;
  htmlFor: string;
  error?: string;
  helperText?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-4">
        <label htmlFor={htmlFor} className="text-sm font-medium text-slate-900">
          {label}
        </label>
        {typeof helperText === 'string' ? <span className="text-xs text-slate-500">{helperText}</span> : null}
      </div>
      {children}
      {typeof helperText !== 'string' && helperText ? <div className="text-xs text-slate-500">{helperText}</div> : null}
      {error ? <p className="text-sm text-rose-600">{error}</p> : null}
    </div>
  );
}

function createInitialState(): PaymentFormState {
  const idempotencyKey = crypto.randomUUID();

  return {
    paymentReference: `PAY-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    sourceAccountId: '',
    beneficiaryCounterpartyId: '',
    beneficiarySearch: '',
    amount: '',
    currencyCode: '',
    valueDate: todayString(),
    purpose: '',
    idempotencyKey
  };
}

function todayString() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isPastDate(value: string) {
  return value < todayString();
}

function isWeekend(value: string) {
  const date = new Date(`${value}T00:00:00`);
  const day = date.getDay();
  return day === 0 || day === 6;
}

function getSupportedCurrencyCodes() {
  if (typeof Intl.supportedValuesOf === 'function') {
    return new Set(Intl.supportedValuesOf('currency').map((code) => code.toUpperCase()));
  }

  return new Set(['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'SEK', 'SGD']);
}

function mapZodErrors(error: z.ZodError) {
  const flattened = error.flatten().fieldErrors;
  return Object.fromEntries(
    Object.entries(flattened)
      .map(([key, messages]) => [key, Array.isArray(messages) ? messages[0] : undefined])
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
}

function mapApiFieldErrors(error: ApiError | null) {
  if (!error?.details) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(error.details)
      .map(([key, value]) => [key, formatUnknownError(value)])
      .filter((entry): entry is [string, string] => Boolean(entry[1]))
  );
}

function formatUnknownError(value: unknown): string | null {
  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string').join(', ') || null;
  }

  if (value && typeof value === 'object') {
    const message = (value as Record<string, unknown>).message;
    return typeof message === 'string' ? message : null;
  }

  return null;
}

function extractPolicyViolations(error: ApiError | null): PolicyViolation[] {
  const violations = error?.details?.violations;
  return Array.isArray(violations)
    ? violations.filter(
        (violation): violation is PolicyViolation =>
          Boolean(violation) &&
          typeof violation === 'object' &&
          typeof (violation as PolicyViolation).policyId === 'string' &&
          typeof (violation as PolicyViolation).ruleId === 'string' &&
          typeof (violation as PolicyViolation).message === 'string'
      )
    : [];
}

function extractPolicyWarnings(error: ApiError | null): PolicyWarning[] {
  const warnings = error?.details?.warnings;
  return Array.isArray(warnings)
    ? warnings.filter(
        (warning): warning is PolicyWarning =>
          Boolean(warning) &&
          typeof warning === 'object' &&
          typeof (warning as PolicyWarning).policyId === 'string' &&
          typeof (warning as PolicyWarning).ruleId === 'string' &&
          typeof (warning as PolicyWarning).message === 'string'
      )
    : [];
}
