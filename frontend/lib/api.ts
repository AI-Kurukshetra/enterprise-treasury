import { getClientSession, getPreferredOrganizationId, setPreferredOrganizationId } from '@/lib/session';
import { getSupabaseBrowserClient } from '@/lib/supabase-client';
import type {
  Account,
  AdminRole,
  AdminUser,
  AuditLogPage,
  ApiErrorResponse,
  ApiSuccess,
  AuthProfile,
  CashPositionSummary,
  CashSummaryReport,
  CashTrendPoint,
  ComplianceReportArchiveItem,
  ComplianceReportJobResponse,
  ComplianceReportType,
  CopilotSession,
  CopilotSessionSummary,
  Counterparty,
  ForecastAccuracyMetric,
  ForecastCreateInput,
  ForecastDetail,
  ForecastGenerationResponse,
  ForecastListItem,
  ForecastScenarioInput,
  IntercompanyLoan,
  LiquidityPoolDetail,
  LiquidityPoolSummary,
  LiquidityPositionResponse,
  LiquidityReport,
  Notification,
  NotificationCount,
  NotificationMarkAllReadResult,
  NotificationReadResult,
  PaginatedResponse,
  Payment,
  PaymentDetail,
  PolicyDomain,
  PolicyRule,
  RiskAlert,
  RiskAlertStatus,
  RiskAlertSeverity,
  RiskExposureSnapshot,
  SweepExecutionResult,
  SweepingRule,
  Transaction,
  TransactionImportStartResponse,
  TransactionImportStatus,
  TreasuryPolicy
} from '@/lib/types';

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:3001/api/v1';

export class ApiError extends Error {
  readonly code: string;
  readonly details: Record<string, unknown> | undefined;
  readonly status: number;

  constructor(message: string, options: { code: string; details?: Record<string, unknown>; status: number }) {
    super(message);
    this.name = 'ApiError';
    this.code = options.code;
    this.details = options.details;
    this.status = options.status;
  }
}

export interface ListAccountsParams {
  status?: Account['status'];
  currencyCode?: string;
  bankConnectionId?: string;
  cursor?: string;
  limit?: number;
}

export interface ListPaymentsParams {
  status?: Payment['status'];
  accountId?: string;
  beneficiaryId?: string;
  fromDate?: string;
  toDate?: string;
  minAmount?: string;
  maxAmount?: string;
  cursor?: string;
  limit?: number;
}

export interface ListTransactionsParams {
  accountId?: string;
  direction?: Transaction['direction'];
  reconciliationStatus?: Transaction['reconciliation_status'];
  fromDate?: string;
  toDate?: string;
  minAmount?: string;
  maxAmount?: string;
  cursor?: string;
  limit?: number;
}

export interface ListCounterpartiesParams {
  type?: Counterparty['type'];
  search?: string;
  cursor?: string;
  limit?: number;
}

export interface ListPoliciesParams {
  domain?: PolicyDomain;
}

export interface ListForecastsParams {
  type?: ForecastListItem['forecast_type'];
  status?: ForecastListItem['status'];
  generationStatus?: ForecastListItem['generation_status'];
  fromDate?: string;
  toDate?: string;
  cursor?: string;
  limit?: number;
}

export interface CashPositionHistoryParams {
  days?: number;
  granularity?: 'daily';
}

export interface ListNotificationsParams {
  isRead?: boolean;
  cursor?: string;
  limit?: number;
}

export interface CreatePaymentInput {
  paymentReference: string;
  sourceAccountId: string;
  beneficiaryCounterpartyId: string;
  amount: string;
  currencyCode: string;
  valueDate: string;
  purpose: string;
  idempotencyKey: string;
}

export interface CreatePolicyInput {
  name: string;
  domain: PolicyDomain;
  rules: PolicyRule[];
  isActive?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

export interface UpdatePolicyInput {
  name?: string;
  domain?: PolicyDomain;
  rules: PolicyRule[];
  isActive?: boolean;
  effectiveFrom?: string;
  effectiveTo?: string | null;
}

export interface CashSummaryReportParams {
  periodStart: string;
  periodEnd: string;
  format?: 'json' | 'csv';
}

export interface LiquidityReportParams {
  asOf: string;
  format?: 'json' | 'csv';
}

export interface GenerateComplianceReportInput {
  reportType: ComplianceReportType;
  periodStart: string;
  periodEnd: string;
}

export interface AuditLogQueryParams {
  fromDate?: string;
  toDate?: string;
  userId?: string;
  action?: string;
  entityType?: string;
  search?: string;
  limit?: number;
  cursor?: string;
  format?: 'json' | 'csv';
}

export interface ListLiquidityPoolsParams {
  poolType?: 'physical' | 'notional';
  baseCurrency?: string;
}

export interface ListLiquidityRulesParams {
  poolId?: string;
}

export interface LiquidityPositionParams {
  poolId?: string;
  region?: string;
  currencyCode?: string;
}

export interface ListIntercompanyLoansParams {
  status?: IntercompanyLoan['status'];
}

export interface CreateIntercompanyLoanInput {
  lenderEntityId: string;
  borrowerEntityId: string;
  amount: string;
  currencyCode: string;
  interestRate?: string;
  maturityDate?: string;
}

export interface UploadTransactionImportInput {
  bankAccountId: string;
  file: File;
  csvColumnMapping?: Record<string, string>;
}

export interface ListRiskAlertsParams {
  status?: RiskAlertStatus;
  severity?: RiskAlertSeverity;
  riskType?: string;
}

function createQueryString(params: Record<string, string | number | undefined>) {
  const searchParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') {
      searchParams.set(key, String(value));
    }
  }

  const queryString = searchParams.toString();
  return queryString ? `?${queryString}` : '';
}

async function fetchApiResponse(path: string, init?: RequestInit): Promise<Response> {
  const session = getClientSession();
  const headers = new Headers(init?.headers);
  let organizationId = getPreferredOrganizationId();
  const accessToken = await resolveAccessToken(session.accessToken);

  headers.set('Accept', 'application/json');

  if (accessToken) {
    headers.set('Authorization', `Bearer ${accessToken}`);
  }

  if (!organizationId && path !== '/auth/me' && accessToken) {
    organizationId = await hydrateOrganizationId(accessToken);
  }

  if (organizationId) {
    headers.set('X-Organization-Id', organizationId);
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers,
    cache: 'no-store'
  });

  if (!response.ok) {
    const errorBody = (await response.json().catch(() => null)) as ApiErrorResponse | null;
    throw new ApiError(errorBody?.error.message ?? `Request failed with status ${response.status}`, {
      code: errorBody?.error.code ?? 'UNKNOWN_ERROR',
      details: errorBody?.error.details,
      status: response.status
    });
  }

  return response;
}

async function resolveAccessToken(sessionAccessToken: string | null): Promise<string | null> {
  if (sessionAccessToken) {
    return sessionAccessToken;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const browserSupabase = getSupabaseBrowserClient();
    const {
      data: { session }
    } = await browserSupabase.auth.getSession();
    return session?.access_token ?? null;
  } catch {
    return null;
  }
}

async function hydrateOrganizationId(accessToken: string): Promise<string | null> {
  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json'
    },
    cache: 'no-store'
  });

  if (!response.ok) {
    return null;
  }

  const payload = (await response.json()) as ApiSuccess<AuthProfile>;
  const organizationId = payload.data.memberships[0]?.organizationId ?? null;

  if (organizationId) {
    setPreferredOrganizationId(organizationId);
  }

  return organizationId;
}

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetchApiResponse(path, init);

  if (response.status === 204) {
    return undefined as T;
  }

  const json = (await response.json()) as ApiSuccess<T>;
  return json.data;
}

async function downloadApiFile(path: string, filename: string, init?: RequestInit) {
  const response = await fetchApiResponse(path, init);
  const blob = await response.blob();
  const downloadUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');

  anchor.href = downloadUrl;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  window.URL.revokeObjectURL(downloadUrl);
}

export function listAccounts(params: ListAccountsParams) {
  return fetchApi<PaginatedResponse<Account>>(
    `/accounts${createQueryString({
      status: params.status,
      currencyCode: params.currencyCode,
      bankConnectionId: params.bankConnectionId,
      cursor: params.cursor,
      limit: params.limit
    })}`
  );
}

export function listCounterparties(params: ListCounterpartiesParams) {
  return fetchApi<PaginatedResponse<Counterparty>>(
    `/counterparties${createQueryString({
      type: params.type,
      search: params.search,
      cursor: params.cursor,
      limit: params.limit
    })}`
  );
}

export function listPayments(params: ListPaymentsParams) {
  return fetchApi<PaginatedResponse<Payment>>(
    `/payments${createQueryString({
      status: params.status,
      accountId: params.accountId,
      beneficiaryId: params.beneficiaryId,
      fromDate: params.fromDate,
      toDate: params.toDate,
      minAmount: params.minAmount,
      maxAmount: params.maxAmount,
      cursor: params.cursor,
      limit: params.limit
    })}`
  );
}

export function getPayment(paymentId: string) {
  return fetchApi<PaymentDetail>(`/payments/${paymentId}`);
}

export function createPayment(payload: CreatePaymentInput) {
  const { idempotencyKey, ...body } = payload;

  return fetchApi<Payment>('/payments', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'X-Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(body)
  });
}

export function approvePayment(paymentId: string, body: { rowVersionToken: string; comment?: string }) {
  return fetchApi<void>(`/approvals/${paymentId}/approve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

export function rejectPayment(paymentId: string, body: { rowVersionToken: string; reason: string }) {
  return fetchApi<void>(`/approvals/${paymentId}/reject`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
}

export function listTransactions(params: ListTransactionsParams) {
  return fetchApi<PaginatedResponse<Transaction>>(
    `/transactions${createQueryString({
      accountId: params.accountId,
      direction: params.direction,
      reconciliationStatus: params.reconciliationStatus,
      fromDate: params.fromDate,
      toDate: params.toDate,
      minAmount: params.minAmount,
      maxAmount: params.maxAmount,
      cursor: params.cursor,
      limit: params.limit
    })}`
  );
}

export function getCashPositionSummary() {
  return fetchApi<CashPositionSummary>('/cash-positions/latest');
}

export function getCashPositionHistory(params: CashPositionHistoryParams = {}) {
  return fetchApi<CashTrendPoint[]>(
    `/cash-positions/history${createQueryString({
      days: params.days ?? 30,
      granularity: params.granularity ?? 'daily'
    })}`
  );
}

export function getCurrentProfile() {
  return fetchApi<AuthProfile>('/auth/me').then((profile) => {
    const organizationId = getPreferredOrganizationId() ?? profile.memberships[0]?.organizationId ?? null;
    if (organizationId) {
      setPreferredOrganizationId(organizationId);
    }
    return profile;
  });
}

export function listNotifications(params: ListNotificationsParams = {}) {
  return fetchApi<PaginatedResponse<Notification>>(
    `/notifications${createQueryString({
      isRead: params.isRead === undefined ? undefined : String(params.isRead),
      cursor: params.cursor,
      limit: params.limit
    })}`
  );
}

export function getNotificationCount() {
  return fetchApi<NotificationCount>('/notifications/count');
}

export function markNotificationRead(notificationId: string) {
  return fetchApi<NotificationReadResult>(`/notifications/${notificationId}/read`, {
    method: 'POST'
  });
}

export function markNotificationUnread(notificationId: string) {
  return fetchApi<NotificationReadResult>(`/notifications/${notificationId}/unread`, {
    method: 'POST'
  });
}

export function markAllNotificationsRead() {
  return fetchApi<NotificationMarkAllReadResult>('/notifications/read-all', {
    method: 'POST'
  });
}

export function listForecasts(params: ListForecastsParams = {}) {
  return fetchApi<PaginatedResponse<ForecastListItem>>(
    `/forecasts${createQueryString({
      type: params.type,
      status: params.status,
      generationStatus: params.generationStatus,
      fromDate: params.fromDate,
      toDate: params.toDate,
      cursor: params.cursor,
      limit: params.limit
    })}`
  );
}

export function getForecast(forecastId: string) {
  return fetchApi<ForecastDetail>(`/forecasts/${forecastId}`);
}

export function createForecast(payload: ForecastCreateInput) {
  const { idempotencyKey, ...body } = payload;

  return fetchApi<ForecastGenerationResponse>('/forecasts', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'X-Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(body)
  });
}

export function publishForecast(forecastId: string) {
  return fetchApi<ForecastListItem>(`/forecasts/${forecastId}/publish`, {
    method: 'POST'
  });
}

export function generateForecastScenario(forecastId: string, payload: ForecastScenarioInput) {
  const { idempotencyKey, ...body } = payload;

  return fetchApi<ForecastGenerationResponse>(`/forecasts/${forecastId}/scenario`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': idempotencyKey,
      'X-Idempotency-Key': idempotencyKey
    },
    body: JSON.stringify(body)
  });
}

export function listCopilotSessions() {
  return fetchApi<CopilotSessionSummary[]>('/copilot/sessions');
}

export function getCopilotSession(sessionId: string) {
  return fetchApi<CopilotSession>(`/copilot/sessions/${sessionId}`);
}

export function uploadTransactionImport(payload: UploadTransactionImportInput) {
  const formData = new FormData();
  formData.set('bankAccountId', payload.bankAccountId);
  formData.set('file', payload.file);

  if (payload.csvColumnMapping && Object.keys(payload.csvColumnMapping).length > 0) {
    formData.set('csvColumnMapping', JSON.stringify(payload.csvColumnMapping));
  }

  return fetchApi<TransactionImportStartResponse>('/transactions/import', {
    method: 'POST',
    body: formData
  });
}

export function getTransactionImportStatus(jobId: string) {
  return fetchApi<TransactionImportStatus>(`/transactions/import/${jobId}/status`);
}

export function getCashSummaryReport(params: CashSummaryReportParams) {
  return fetchApi<CashSummaryReport>(
    `/reports/cash-summary${createQueryString({
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      format: params.format ?? 'json'
    })}`
  );
}

export function downloadCashSummaryReport(params: CashSummaryReportParams) {
  const format = params.format ?? 'csv';
  return downloadApiFile(
    `/reports/cash-summary${createQueryString({
      periodStart: params.periodStart,
      periodEnd: params.periodEnd,
      format
    })}`,
    `cash-summary-${params.periodStart}-${params.periodEnd}.${format === 'csv' ? 'csv' : 'json'}`
  );
}

export function getLiquidityReport(params: LiquidityReportParams) {
  return fetchApi<LiquidityReport>(
    `/reports/liquidity${createQueryString({
      asOf: params.asOf,
      format: params.format ?? 'json'
    })}`
  );
}

export function listLiquidityPools(params: ListLiquidityPoolsParams = {}) {
  return fetchApi<LiquidityPoolSummary[]>(
    `/liquidity/pools${createQueryString({
      poolType: params.poolType,
      baseCurrency: params.baseCurrency
    })}`
  );
}

export function getLiquidityPool(poolId: string) {
  return fetchApi<LiquidityPoolDetail>(`/liquidity/pools/${poolId}`);
}

export function runLiquidityPoolSweep(poolId: string) {
  return fetchApi<SweepExecutionResult[]>(`/liquidity/pools/${poolId}/sweep`, {
    method: 'POST'
  });
}

export function listLiquidityRules(params: ListLiquidityRulesParams = {}) {
  return fetchApi<SweepingRule[]>(
    `/liquidity/rules${createQueryString({
      poolId: params.poolId
    })}`
  );
}

export function getLiquidityPosition(params: LiquidityPositionParams = {}) {
  return fetchApi<LiquidityPositionResponse>(
    `/liquidity/position${createQueryString({
      poolId: params.poolId,
      region: params.region,
      currencyCode: params.currencyCode
    })}`
  );
}

export function listIntercompanyLoans(params: ListIntercompanyLoansParams = {}) {
  return fetchApi<IntercompanyLoan[]>(
    `/liquidity/intercompany${createQueryString({
      status: params.status
    })}`
  );
}

export function createIntercompanyLoan(payload: CreateIntercompanyLoanInput) {
  return fetchApi<IntercompanyLoan>('/liquidity/intercompany', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

export function downloadLiquidityReport(params: LiquidityReportParams) {
  const format = params.format ?? 'csv';
  return downloadApiFile(
    `/reports/liquidity${createQueryString({
      asOf: params.asOf,
      format
    })}`,
    `liquidity-report-${params.asOf}.${format === 'csv' ? 'csv' : 'json'}`
  );
}

export function generateComplianceReport(payload: GenerateComplianceReportInput) {
  return fetchApi<ComplianceReportJobResponse>('/reports/compliance', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

export function listComplianceReports() {
  return fetchApi<ComplianceReportArchiveItem[]>('/reports/compliance');
}

export function downloadComplianceReport(downloadId: string) {
  return downloadApiFile(`/reports/compliance${createQueryString({ downloadId })}`, `compliance-report-${downloadId}.json`);
}

export function listAuditLogs(params: AuditLogQueryParams) {
  return fetchApi<AuditLogPage>(
    `/admin/audit-logs${createQueryString({
      fromDate: params.fromDate,
      toDate: params.toDate,
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      search: params.search,
      limit: params.limit,
      cursor: params.cursor,
      format: params.format
    })}`
  );
}

export function exportAuditLogsCsv(params: AuditLogQueryParams) {
  return downloadApiFile(
    `/admin/audit-logs${createQueryString({
      fromDate: params.fromDate,
      toDate: params.toDate,
      userId: params.userId,
      action: params.action,
      entityType: params.entityType,
      search: params.search,
      limit: params.limit ?? 5000,
      cursor: params.cursor,
      format: 'csv'
    })}`,
    `audit-logs-${params.fromDate ?? 'all'}-${params.toDate ?? 'current'}.csv`
  );
}

export function listAdminUsers() {
  return fetchApi<AdminUser[]>('/admin/users');
}

export function inviteAdminUser(payload: { email: string; role: string }) {
  return fetchApi<{ status: 'queued'; email: string; role: string; message: string }>('/admin/users/invite', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

export function revokeAdminUser(userId: string) {
  return fetchApi<{ userId: string; status: 'revoked' }>(`/admin/users/${userId}/revoke`, {
    method: 'POST'
  });
}

export function listAdminRoles() {
  return fetchApi<AdminRole[]>('/admin/roles');
}

export function listPolicies(params: ListPoliciesParams = {}) {
  return fetchApi<TreasuryPolicy[]>(
    `/admin/policies${createQueryString({
      domain: params.domain
    })}`
  );
}

export function getRiskExposures() {
  return fetchApi<RiskExposureSnapshot>('/risk/exposures');
}

export function listRiskAlerts(params: ListRiskAlertsParams = {}) {
  return fetchApi<RiskAlert[]>(
    `/risk/alerts${createQueryString({
      status: params.status,
      severity: params.severity,
      riskType: params.riskType
    })}`
  );
}

export function acknowledgeRiskAlert(alertId: string, note: string) {
  return fetchApi<RiskAlert>(`/risk/alerts/${alertId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'acknowledge',
      note
    })
  });
}

export function resolveRiskAlert(alertId: string, note: string) {
  return fetchApi<RiskAlert>(`/risk/alerts/${alertId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'resolve',
      note
    })
  });
}

export function recalculateRisk(referenceDate?: string) {
  return fetchApi<{ jobId: string }>('/risk/exposures/recalculate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(referenceDate ? { referenceDate } : {})
  });
}

export function createPolicy(payload: CreatePolicyInput) {
  return fetchApi<TreasuryPolicy>('/admin/policies', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

export function updatePolicy(policyId: string, payload: UpdatePolicyInput) {
  return fetchApi<TreasuryPolicy>(`/admin/policies/${policyId}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(payload)
  });
}

export function deletePolicy(policyId: string) {
  return fetchApi<TreasuryPolicy>(`/admin/policies/${policyId}`, {
    method: 'DELETE'
  });
}

export function validatePolicyRules(rules: PolicyRule[]) {
  return fetchApi<{ valid: boolean; errors: string[] }>('/admin/policies/validate', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ rules })
  });
}
