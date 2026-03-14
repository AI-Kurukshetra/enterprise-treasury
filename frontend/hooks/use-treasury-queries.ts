'use client';

import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  approvePayment,
  acknowledgeRiskAlert,
  createIntercompanyLoan,
  createForecast,
  createPayment,
  generateComplianceReport,
  generateForecastScenario,
  getNotificationCount,
  getCopilotSession,
  getForecast,
  getCashPositionHistory,
  getCashPositionSummary,
  getCashSummaryReport,
  getCurrentProfile,
  getRiskExposures,
  getLiquidityPool,
  getLiquidityPosition,
  getLiquidityReport,
  getPayment,
  listCopilotSessions,
  listAccounts,
  listAdminRoles,
  listAdminUsers,
  listAuditLogs,
  listComplianceReports,
  listCounterparties,
  listForecasts,
  listIntercompanyLoans,
  listLiquidityPools,
  listLiquidityRules,
  listNotifications,
  listPayments,
  type ListPoliciesParams,
  listPolicies,
  listRiskAlerts,
  listTransactions,
  markAllNotificationsRead,
  markNotificationRead,
  markNotificationUnread,
  rejectPayment,
  recalculateRisk,
  resolveRiskAlert,
  runLiquidityPoolSweep,
  publishForecast,
  type AuditLogQueryParams,
  type CashPositionHistoryParams,
  type CashSummaryReportParams,
  type CreateIntercompanyLoanInput,
  type ListForecastsParams,
  type ListNotificationsParams,
  type CreatePaymentInput,
  type GenerateComplianceReportInput,
  type ListRiskAlertsParams,
  type LiquidityPositionParams,
  type LiquidityReportParams,
  type ListAccountsParams,
  type ListCounterpartiesParams,
  type ListIntercompanyLoansParams,
  type ListLiquidityPoolsParams,
  type ListLiquidityRulesParams,
  type ListPaymentsParams,
  type ListTransactionsParams
} from '@/lib/api';
import type {
  Account,
  AuditLogPage,
  CashPositionSummary,
  CopilotSession,
  ForecastCreateInput,
  ForecastDetail,
  ForecastGenerationResponse,
  ForecastScenarioInput,
  Notification,
  NotificationCount,
  NotificationMarkAllReadResult,
  NotificationReadResult,
  PaginatedResponse
} from '@/lib/types';
import { addDecimalStrings, subtractDecimalStrings } from '@/lib/decimal';

const defaultPagination = { limit: 25 };
const cashPositionStaleTime = 5 * 60 * 1000;

export const treasuryQueryKeys = {
  accounts: (params: ListAccountsParams = {}) => ['accounts', params] as const,
  counterparties: (params: ListCounterpartiesParams = {}) => ['counterparties', params] as const,
  payments: (params: ListPaymentsParams = {}) => ['payments', params] as const,
  paymentDetail: (paymentId: string) => ['payments', 'detail', paymentId] as const,
  cashPositionSummary: () => ['cash-positions', 'summary'] as const,
  cashTrend: (params: CashPositionHistoryParams = {}) => ['cash-positions', 'history', params.days ?? 30, params.granularity ?? 'daily'] as const,
  transactions: (params: ListTransactionsParams = {}) => ['transactions', params] as const,
  forecasts: (params: ListForecastsParams = {}) => ['forecasts', params] as const,
  forecastDetail: (forecastId: string) => ['forecasts', 'detail', forecastId] as const,
  currentProfile: () => ['auth', 'me'] as const,
  notifications: (params: ListNotificationsParams = {}) => ['notifications', params] as const,
  notificationsCount: () => ['notifications', 'count'] as const,
  copilotSessions: () => ['copilot', 'sessions'] as const,
  copilotSession: (sessionId: string) => ['copilot', 'sessions', sessionId] as const,
  auditLogs: (filters: Omit<AuditLogQueryParams, 'cursor' | 'format'> = {}) => ['admin', 'audit-logs', filters] as const,
  cashSummaryReport: (params: CashSummaryReportParams) => ['reports', 'cash-summary', params] as const,
  liquidityReport: (params: LiquidityReportParams) => ['reports', 'liquidity', params] as const,
  liquidityPools: (params: ListLiquidityPoolsParams = {}) => ['liquidity', 'pools', params] as const,
  liquidityPoolDetail: (poolId: string) => ['liquidity', 'pools', 'detail', poolId] as const,
  liquidityRules: (params: ListLiquidityRulesParams = {}) => ['liquidity', 'rules', params] as const,
  liquidityPosition: (params: LiquidityPositionParams = {}) => ['liquidity', 'position', params] as const,
  intercompanyLoans: (params: ListIntercompanyLoansParams = {}) => ['liquidity', 'intercompany', params] as const,
  complianceArchive: () => ['reports', 'compliance', 'archive'] as const,
  adminUsers: () => ['admin', 'users'] as const,
  adminRoles: () => ['admin', 'roles'] as const,
  policies: (params: ListPoliciesParams = {}) => ['admin', 'policies', params] as const,
  riskExposures: () => ['risk', 'exposures'] as const,
  riskAlerts: (filters: ListRiskAlertsParams = {}) => ['risk', 'alerts', filters] as const
};

export function useAccountsQuery(params: ListAccountsParams = {}) {
  return useQuery({
    queryKey: treasuryQueryKeys.accounts(params),
    queryFn: () => listAccounts({ ...defaultPagination, ...params }),
    placeholderData: keepPreviousData,
    staleTime: cashPositionStaleTime
  });
}

export function useCounterpartiesQuery(params: ListCounterpartiesParams = {}) {
  return useQuery({
    queryKey: treasuryQueryKeys.counterparties(params),
    queryFn: () => listCounterparties({ limit: 100, ...params }),
    placeholderData: keepPreviousData
  });
}

export function usePaymentsQuery(params: ListPaymentsParams = {}) {
  return useQuery({
    queryKey: treasuryQueryKeys.payments(params),
    queryFn: () => listPayments({ ...defaultPagination, ...params }),
    placeholderData: keepPreviousData,
    staleTime: cashPositionStaleTime
  });
}

export function usePaymentDetailQuery(paymentId: string | null) {
  return useQuery({
    queryKey: treasuryQueryKeys.paymentDetail(paymentId ?? 'unknown'),
    queryFn: () => getPayment(paymentId!),
    enabled: Boolean(paymentId)
  });
}

export function useCashPositionQuery() {
  return useQuery({
    queryKey: treasuryQueryKeys.cashPositionSummary(),
    queryFn: getCashPositionSummary,
    staleTime: cashPositionStaleTime,
    refetchInterval: 60_000
  });
}

export function useCashTrendQuery(days: number) {
  return useQuery({
    queryKey: treasuryQueryKeys.cashTrend({ days, granularity: 'daily' }),
    queryFn: () => getCashPositionHistory({ days, granularity: 'daily' }),
    staleTime: cashPositionStaleTime,
    refetchInterval: 60_000
  });
}

export function useTransactionsQuery(params: ListTransactionsParams = {}) {
  return useQuery({
    queryKey: treasuryQueryKeys.transactions(params),
    queryFn: () => listTransactions({ ...defaultPagination, ...params }),
    placeholderData: keepPreviousData
  });
}

export function useForecastsQuery(params: ListForecastsParams = {}) {
  return useQuery({
    queryKey: treasuryQueryKeys.forecasts(params),
    queryFn: () => listForecasts({ ...defaultPagination, ...params }),
    placeholderData: keepPreviousData,
    refetchInterval: 60_000
  });
}

export function useForecastDetailQuery(forecastId: string | null) {
  return useQuery({
    queryKey: treasuryQueryKeys.forecastDetail(forecastId ?? 'unknown'),
    queryFn: () => getForecast(forecastId!),
    enabled: Boolean(forecastId),
    refetchInterval: (query) => {
      const data = query.state.data as ForecastDetail | undefined;
      if (!data) {
        return false;
      }

      return data.generation_status === 'queued' || data.generation_status === 'running' ? 5_000 : false;
    }
  });
}

export function useCurrentProfileQuery() {
  return useQuery({
    queryKey: treasuryQueryKeys.currentProfile(),
    queryFn: getCurrentProfile
  });
}

export function useNotificationsQuery(params: ListNotificationsParams = {}) {
  return useQuery({
    queryKey: treasuryQueryKeys.notifications(params),
    queryFn: () => listNotifications(params),
    placeholderData: keepPreviousData
  });
}

export function useInfiniteNotificationsQuery(params: ListNotificationsParams = {}) {
  return useInfiniteQuery({
    queryKey: treasuryQueryKeys.notifications(params),
    queryFn: ({ pageParam }) =>
      listNotifications({
        ...params,
        limit: params.limit ?? 50,
        cursor: typeof pageParam === 'string' ? pageParam : undefined
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: PaginatedResponse<Notification>) => lastPage.nextCursor ?? undefined
  });
}

export function useNotificationCountQuery() {
  return useQuery({
    queryKey: treasuryQueryKeys.notificationsCount(),
    queryFn: getNotificationCount
  });
}

export function useMarkNotificationReadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: string) => markNotificationRead(notificationId),
    onSuccess: async (_result: NotificationReadResult) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.notificationsCount() })
      ]);
    }
  });
}

export function useMarkNotificationUnreadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notificationId: string) => markNotificationUnread(notificationId),
    onSuccess: async (_result: NotificationReadResult) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.notificationsCount() })
      ]);
    }
  });
}

export function useMarkAllNotificationsReadMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onSuccess: async (_result: NotificationMarkAllReadResult) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notifications'] }),
        queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.notificationsCount() })
      ]);
    }
  });
}

export function useRiskExposuresQuery() {
  return useQuery({
    queryKey: treasuryQueryKeys.riskExposures(),
    queryFn: getRiskExposures,
    refetchInterval: 60_000
  });
}

export function useRiskAlertsQuery(filters: ListRiskAlertsParams = {}) {
  return useQuery({
    queryKey: treasuryQueryKeys.riskAlerts(filters),
    queryFn: () => listRiskAlerts(filters),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000
  });
}

export function useCreateForecastMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ForecastCreateInput) => createForecast(payload),
    onSuccess: async (result: ForecastGenerationResponse) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['forecasts'] }),
        queryClient.invalidateQueries({ queryKey: ['notifications'] })
      ]);

      await queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.forecastDetail(result.forecastId) });
    }
  });
}

export function usePublishForecastMutation(forecastId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => publishForecast(forecastId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['forecasts'] }),
        queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.forecastDetail(forecastId) })
      ]);
    }
  });
}

export function useGenerateForecastScenarioMutation(forecastId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: ForecastScenarioInput) => generateForecastScenario(forecastId, payload),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['forecasts'] }),
        queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.forecastDetail(forecastId) }),
        queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.forecastDetail(result.forecastId) })
      ]);
    }
  });
}

export function useCopilotSessionsQuery(enabled = true) {
  return useQuery({
    queryKey: treasuryQueryKeys.copilotSessions(),
    queryFn: listCopilotSessions,
    enabled,
    placeholderData: keepPreviousData,
    refetchInterval: 30_000
  });
}

export function useCopilotSessionQuery(sessionId: string | null, enabled = true) {
  return useQuery({
    queryKey: treasuryQueryKeys.copilotSession(sessionId ?? 'new'),
    queryFn: () => getCopilotSession(sessionId!),
    enabled: enabled && Boolean(sessionId)
  });
}

export function useCreatePaymentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreatePaymentInput) => createPayment(payload),
    onMutate: async (payload) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: treasuryQueryKeys.cashPositionSummary() }),
        queryClient.cancelQueries({ queryKey: ['accounts'] })
      ]);

      const previousSummary = queryClient.getQueryData<CashPositionSummary>(treasuryQueryKeys.cashPositionSummary());
      const previousAccounts = queryClient.getQueriesData<PaginatedResponse<Account>>({ queryKey: ['accounts'] });

      if (previousSummary) {
        queryClient.setQueryData<CashPositionSummary>(treasuryQueryKeys.cashPositionSummary(), {
          ...previousSummary,
          availableLiquidity:
            previousSummary.baseCurrency === payload.currencyCode
              ? subtractDecimalStrings(previousSummary.availableLiquidity, payload.amount)
              : previousSummary.availableLiquidity,
          pendingPayments: {
            amount:
              previousSummary.baseCurrency === payload.currencyCode
                ? addDecimalStrings(previousSummary.pendingPayments.amount, payload.amount)
                : previousSummary.pendingPayments.amount,
            count: previousSummary.pendingPayments.count + 1
          }
        });
      }

      for (const [queryKey, data] of previousAccounts) {
        if (!data) {
          continue;
        }

        queryClient.setQueryData<PaginatedResponse<Account>>(queryKey, {
          ...data,
          items: data.items.map((account) => {
            if (account.id !== payload.sourceAccountId || !account.available_balance || !account.restricted_balance) {
              return account;
            }

            return {
              ...account,
              available_balance: subtractDecimalStrings(account.available_balance, payload.amount),
              restricted_balance: addDecimalStrings(account.restricted_balance, payload.amount)
            };
          })
        });
      }

      return { previousSummary, previousAccounts };
    },
    onError: (_error, _payload, context) => {
      if (context?.previousSummary) {
        queryClient.setQueryData(treasuryQueryKeys.cashPositionSummary(), context.previousSummary);
      }

      for (const [queryKey, data] of context?.previousAccounts ?? []) {
        queryClient.setQueryData(queryKey, data);
      }
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payments'] }),
        queryClient.invalidateQueries({ queryKey: ['cash-positions'] }),
        queryClient.invalidateQueries({ queryKey: ['accounts'] })
      ]);
    }
  });
}

export function useApprovePaymentMutation(paymentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: { rowVersionToken: string; comment?: string }) => approvePayment(paymentId, body),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payments'] }),
        queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.paymentDetail(paymentId) }),
        queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.currentProfile() })
      ]);
    }
  });
}

export function useRejectPaymentMutation(paymentId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: { rowVersionToken: string; reason: string }) => rejectPayment(paymentId, body),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payments'] }),
        queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.paymentDetail(paymentId) }),
        queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.currentProfile() })
      ]);
    }
  });
}

export function useAuditLogsQuery(filters: Omit<AuditLogQueryParams, 'cursor' | 'format'> = {}) {
  return useInfiniteQuery({
    queryKey: treasuryQueryKeys.auditLogs(filters),
    queryFn: ({ pageParam }) =>
      listAuditLogs({
        ...filters,
        limit: filters.limit ?? 100,
        cursor: typeof pageParam === 'string' ? pageParam : undefined
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage: AuditLogPage) => lastPage.nextCursor ?? undefined
  });
}

export function useCashSummaryReportQuery(params: CashSummaryReportParams) {
  return useQuery({
    queryKey: treasuryQueryKeys.cashSummaryReport(params),
    queryFn: () => getCashSummaryReport({ ...params, format: 'json' }),
    enabled: Boolean(params.periodStart && params.periodEnd)
  });
}

export function useLiquidityReportQuery(params: LiquidityReportParams) {
  return useQuery({
    queryKey: treasuryQueryKeys.liquidityReport(params),
    queryFn: () => getLiquidityReport({ ...params, format: 'json' }),
    enabled: Boolean(params.asOf)
  });
}

export function useGenerateComplianceReportMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: GenerateComplianceReportInput) => generateComplianceReport(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.complianceArchive() });
    }
  });
}

export function useComplianceArchiveQuery() {
  return useQuery({
    queryKey: treasuryQueryKeys.complianceArchive(),
    queryFn: listComplianceReports
  });
}

export function useAdminUsersQuery() {
  return useQuery({
    queryKey: treasuryQueryKeys.adminUsers(),
    queryFn: listAdminUsers
  });
}

export function useAdminRolesQuery() {
  return useQuery({
    queryKey: treasuryQueryKeys.adminRoles(),
    queryFn: listAdminRoles
  });
}

export function usePoliciesQuery(params: ListPoliciesParams = {}) {
  return useQuery({
    queryKey: treasuryQueryKeys.policies(params),
    queryFn: () => listPolicies(params)
  });
}

export function useLiquidityPoolsQuery(params: ListLiquidityPoolsParams = {}, enabled = true) {
  return useQuery({
    queryKey: treasuryQueryKeys.liquidityPools(params),
    queryFn: () => listLiquidityPools(params),
    enabled
  });
}

export function useLiquidityPoolDetailQuery(poolId: string | null, enabled = true) {
  return useQuery({
    queryKey: treasuryQueryKeys.liquidityPoolDetail(poolId ?? 'unknown'),
    queryFn: () => getLiquidityPool(poolId!),
    enabled: enabled && Boolean(poolId)
  });
}

export function useLiquidityRulesQuery(params: ListLiquidityRulesParams = {}, enabled = true) {
  return useQuery({
    queryKey: treasuryQueryKeys.liquidityRules(params),
    queryFn: () => listLiquidityRules(params),
    enabled
  });
}

export function useLiquidityPositionQuery(params: LiquidityPositionParams = {}, enabled = true) {
  return useQuery({
    queryKey: treasuryQueryKeys.liquidityPosition(params),
    queryFn: () => getLiquidityPosition(params),
    enabled
  });
}

export function useIntercompanyLoansQuery(params: ListIntercompanyLoansParams = {}, enabled = true) {
  return useQuery({
    queryKey: treasuryQueryKeys.intercompanyLoans(params),
    queryFn: () => listIntercompanyLoans(params),
    enabled
  });
}

export function useRunLiquidityPoolSweepMutation(poolId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => runLiquidityPoolSweep(poolId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['liquidity'] }),
        queryClient.invalidateQueries({ queryKey: ['cash-positions'] })
      ]);
    }
  });
}

export function useCreateIntercompanyLoanMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: CreateIntercompanyLoanInput) => createIntercompanyLoan(payload),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['liquidity', 'intercompany'] }),
        queryClient.invalidateQueries({ queryKey: ['liquidity', 'position'] })
      ]);
    }
  });
}

export function useAcknowledgeAlertMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ alertId, note }: { alertId: string; note: string }) => acknowledgeRiskAlert(alertId, note),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['risk', 'alerts'] }),
        queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.riskExposures() })
      ]);
    }
  });
}

export function useResolveAlertMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ alertId, note }: { alertId: string; note: string }) => resolveRiskAlert(alertId, note),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['risk', 'alerts'] }),
        queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.riskExposures() })
      ]);
    }
  });
}

export function useRecalculateRiskMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input?: { referenceDate?: string }) => recalculateRisk(input?.referenceDate),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: treasuryQueryKeys.riskExposures() }),
        queryClient.invalidateQueries({ queryKey: ['risk', 'alerts'] })
      ]);
    }
  });
}
