import { beforeEach, describe, expect, it, vi } from 'vitest';
import { bankAccountFixture, cashPositionFixture, paymentFixture, pendingApprovalFixture, transactionFixture } from '../../fixtures/treasury';
import { invokeRoute } from '../../utils/routeInvoke';

const routeState = vi.hoisted(() => ({
  permissionAllowed: true,
  membershipAllowed: true,
  user: {
    id: '00000000-0000-4000-8000-000000000101',
    email: 'approver@example.com'
  },
  services: {} as Record<string, unknown>
}));

vi.mock('@/repositories/access/repository', () => ({
  AccessRepository: class {
    async authenticate(token: string) {
      if (token !== 'valid-token') {
        throw new Error('AUTH_INVALID_TOKEN');
      }
      return routeState.user;
    }

    async ensureOrganizationMembership() {
      if (!routeState.membershipAllowed) {
        throw new Error('ACCESS_ORGANIZATION_FORBIDDEN');
      }
    }

    async hasPermission() {
      return routeState.permissionAllowed;
    }
  }
}));

vi.mock('@/lib/supabase', () => ({
  createServiceSupabaseClient: () => ({
    from: () => ({
      insert: async () => ({ error: null })
    })
  }),
  createAnonSupabaseClient: vi.fn()
}));

vi.mock('@/services/serviceFactory', () => ({
  buildServices: () => routeState.services
}));

import * as accountsRoute from '@api/v1/accounts/route';
import * as accountByIdRoute from '@api/v1/accounts/[accountId]/route';
import * as transactionsRoute from '@api/v1/transactions/route';
import * as transactionsImportRoute from '@api/v1/transactions/import/route';
import * as transactionsReconcileRoute from '@api/v1/transactions/[transactionId]/reconcile/route';
import * as paymentsRoute from '@api/v1/payments/route';
import * as approvalsPendingRoute from '@api/v1/approvals/pending/route';
import * as approvalsApproveRoute from '@api/v1/approvals/[paymentId]/approve/route';
import * as approvalsRejectRoute from '@api/v1/approvals/[paymentId]/reject/route';
import * as cashLatestRoute from '@api/v1/cash-positions/latest/route';
import * as cashHistoryRoute from '@api/v1/cash-positions/history/route';
import * as forecastsRoute from '@api/v1/forecasts/route';
import * as investmentsRoute from '@api/v1/investments/route';
import * as investmentsByIdRoute from '@api/v1/investments/[investmentId]/route';

beforeEach(() => {
  routeState.permissionAllowed = true;
  routeState.membershipAllowed = true;
  routeState.services = {
    accounts: {
      list: vi.fn(async () => ({ items: [bankAccountFixture()], nextCursor: null })),
      create: vi.fn(async () => bankAccountFixture()),
      getById: vi.fn(async () => bankAccountFixture()),
      update: vi.fn(async () => bankAccountFixture({ status: 'dormant' }))
    },
    transactions: {
      list: vi.fn(async () => ({ items: [transactionFixture()], nextCursor: null })),
      reconcile: vi.fn(async () => transactionFixture({ reconciliation_status: 'reconciled' }))
    },
    cashPositions: {
      getLatest: vi.fn(async () => ({
        totalCash: '950000.000000',
        availableLiquidity: '900000.000000',
        pendingPayments: {
          amount: '125000.120000',
          count: 1
        },
        riskLimitsInWatch: 1,
        baseCurrency: 'USD',
        asOf: '2026-03-14T09:00:00.000Z',
        byCurrency: [
          {
            currencyCode: 'USD',
            currentBalance: '950000.000000',
            availableBalance: '900000.000000',
            restrictedBalance: '50000.000000',
            currentBalanceInBase: '950000.000000',
            availableBalanceInBase: '900000.000000',
            restrictedBalanceInBase: '50000.000000'
          }
        ],
        byRegion: [
          {
            region: 'North America',
            operating: '900000.000000',
            reserve: '50000.000000',
            trapped: '0.000000'
          }
        ],
        trend: [
          {
            date: '2026-03-14',
            label: 'Mar 14',
            value: '950000.000000',
            projected: '940000.000000',
            buffer: '150000.000000'
          }
        ],
        paymentVolume: [
          {
            label: 'Mar 14',
            urgent: 1,
            scheduled: 3
          }
        ]
      })),
      getHistory: vi.fn(async () => [
        {
          date: '2026-03-14',
          label: 'Mar 14',
          value: '950000.000000',
          projected: '940000.000000',
          buffer: '150000.000000'
        }
      ])
    },
    payments: {
      list: vi.fn(async () => ({ items: [paymentFixture()], nextCursor: null })),
      create: vi.fn(async () => paymentFixture())
    },
    approvals: {
      listPending: vi.fn(async () => [pendingApprovalFixture()]),
      approve: vi.fn(async () => paymentFixture({ status: 'approved', version: 2 })),
      reject: vi.fn(async () => paymentFixture({ status: 'rejected', version: 2 }))
    },
    forecasts: {
      list: vi.fn(async () => ({
        items: [
          {
            id: '00000000-0000-4000-8000-000000000901',
            organization_id: '00000000-0000-4000-8000-000000000001',
            name: 'Weekly cash forecast',
            forecast_type: 'short_term',
            start_date: '2026-03-14',
            end_date: '2026-03-21',
            horizon_days: 7,
            currency_code: 'USD',
            model_type: 'statistical',
            model_version: 'v1',
            confidence_score: '0.9200',
            status: 'draft',
            scenario_name: 'base',
            notes: null,
            generation_status: 'completed',
            estimated_time_seconds: 18,
            accuracy_score: '0.9500',
            accuracy_details: {},
            created_at: '2026-03-14T09:00:00.000Z',
            updated_at: '2026-03-14T09:00:00.000Z'
          }
        ],
        nextCursor: null
      })),
      create: vi.fn(async () => ({
        forecastId: '00000000-0000-4000-8000-000000000901',
        status: 'completed',
        estimatedTimeSeconds: 18
      }))
    },
    investments: {
      list: vi.fn(async () => ({
        items: [
          {
            id: '00000000-0000-4000-8000-000000000950',
            organization_id: '00000000-0000-4000-8000-000000000001',
            instrument_name: 'USD Money Market Fund',
            instrument_type: 'mmf',
            principal_amount: '5000000.000000',
            currency_code: 'USD',
            maturity_date: '2026-04-14',
            status: 'active'
          }
        ],
        nextCursor: null
      })),
      create: vi.fn(async () => ({
        id: '00000000-0000-4000-8000-000000000950',
        organization_id: '00000000-0000-4000-8000-000000000001',
        instrument_name: 'USD Money Market Fund',
        instrument_type: 'mmf',
        principal_amount: '5000000.000000',
        currency_code: 'USD',
        maturity_date: '2026-04-14',
        status: 'active'
      })),
      getById: vi.fn(async () => ({
        id: '00000000-0000-4000-8000-000000000950',
        organization_id: '00000000-0000-4000-8000-000000000001',
        instrument_name: 'USD Money Market Fund',
        instrument_type: 'mmf',
        principal_amount: '5000000.000000',
        currency_code: 'USD',
        maturity_date: '2026-04-14',
        status: 'active'
      }))
    }
  };
});

function authHeaders(extra: Record<string, string> = {}) {
  return {
    authorization: 'Bearer valid-token',
    'x-organization-id': '00000000-0000-4000-8000-000000000001',
    'x-request-id': 'req-test-1',
    ...extra
  };
}

describe('treasury route integration', () => {
  it('returns paginated accounts', async () => {
    const result = await invokeRoute(accountsRoute.GET, {
      url: 'https://example.com/api/v1/accounts?status=active&currencyCode=usd',
      method: 'GET',
      headers: authHeaders()
    });

    expect(result.status).toBe(200);
    expect(result.json.data.items).toHaveLength(1);
    expect(result.json.meta.requestId).toBe('req-test-1');
  });

  it('rejects unauthorized account creation', async () => {
    routeState.permissionAllowed = false;
    const result = await invokeRoute(accountsRoute.POST, {
      url: 'https://example.com/api/v1/accounts',
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: {
        bankConnectionId: '00000000-0000-4000-8000-000000000301',
        accountName: 'Ops Account',
        accountNumberMasked: '****1234',
        currencyCode: 'USD'
      }
    });

    expect(result.status).toBe(403);
    expect(result.json.error.code).toBe('ACCESS_DENIED');
  });

  it('returns an account by id', async () => {
    const result = await invokeRoute(accountByIdRoute.GET, {
      url: 'https://example.com/api/v1/accounts/00000000-0000-4000-8000-000000000201',
      method: 'GET',
      headers: authHeaders(),
      params: {
        accountId: '00000000-0000-4000-8000-000000000201'
      }
    });

    expect(result.status).toBe(200);
    expect(result.json.data.id).toBe('00000000-0000-4000-8000-000000000201');
  });

  it('updates an account with a valid patch payload', async () => {
    const result = await invokeRoute(accountByIdRoute.PATCH, {
      url: 'https://example.com/api/v1/accounts/00000000-0000-4000-8000-000000000201',
      method: 'PATCH',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: {
        status: 'dormant'
      },
      params: {
        accountId: '00000000-0000-4000-8000-000000000201'
      }
    });

    expect(result.status).toBe(200);
    expect(result.json.data.status).toBe('dormant');
  });

  it('validates empty account patch requests', async () => {
    const result = await invokeRoute(accountByIdRoute.PATCH, {
      url: 'https://example.com/api/v1/accounts/00000000-0000-4000-8000-000000000201',
      method: 'PATCH',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: {},
      params: {
        accountId: '00000000-0000-4000-8000-000000000201'
      }
    });

    expect(result.status).toBe(400);
    expect(result.json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns transactions', async () => {
    const result = await invokeRoute(transactionsRoute.GET, {
      url: 'https://example.com/api/v1/transactions?direction=outflow',
      method: 'GET',
      headers: authHeaders()
    });

    expect(result.status).toBe(200);
    expect(result.json.data.items[0].dedupe_hash).toBe('dedupe-hash-0000001');
  });

  it('validates manual transaction import requests', async () => {
    const formData = new FormData();
    const result = await invokeRoute(transactionsImportRoute.POST, {
      url: 'https://example.com/api/v1/transactions/import',
      method: 'POST',
      headers: authHeaders(),
      body: formData
    });

    expect(result.status).toBe(400);
    expect(result.json.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication for payment listing', async () => {
    const result = await invokeRoute(paymentsRoute.GET, {
      url: 'https://example.com/api/v1/payments',
      method: 'GET'
    });

    expect(result.status).toBe(403);
    expect(result.json.error.code).toBe('ACCESS_DENIED');
  });

  it('creates payments with idempotency enforcement', async () => {
    const result = await invokeRoute(paymentsRoute.POST, {
      url: 'https://example.com/api/v1/payments',
      method: 'POST',
      headers: { ...authHeaders({ 'idempotency-key': 'idem-pay-001' }), 'content-type': 'application/json' },
      body: {
        paymentReference: 'PAY-20260314-0001',
        sourceAccountId: '00000000-0000-4000-8000-000000000201',
        beneficiaryCounterpartyId: '00000000-0000-4000-8000-000000000501',
        amount: '125000.120000',
        currencyCode: 'USD',
        valueDate: '2026-03-15'
      }
    });

    expect(result.status).toBe(201);
    expect(result.json.data.status).toBe('pending_approval');
  });

  it('rejects missing idempotency keys on payment creation', async () => {
    const result = await invokeRoute(paymentsRoute.POST, {
      url: 'https://example.com/api/v1/payments',
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: {
        paymentReference: 'PAY-20260314-0001',
        sourceAccountId: '00000000-0000-4000-8000-000000000201',
        beneficiaryCounterpartyId: '00000000-0000-4000-8000-000000000501',
        amount: '125000.120000',
        currencyCode: 'USD',
        valueDate: '2026-03-15'
      }
    });

    expect(result.status).toBe(400);
    expect(result.json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns pending approvals', async () => {
    const result = await invokeRoute(approvalsPendingRoute.GET, {
      url: 'https://example.com/api/v1/approvals/pending',
      method: 'GET',
      headers: authHeaders()
    });

    expect(result.status).toBe(200);
    expect(result.json.data[0].paymentReference).toBe('PAY-20260314-0001');
  });

  it('validates approval input payloads', async () => {
    const result = await invokeRoute(approvalsApproveRoute.POST as never, {
      url: 'https://example.com/api/v1/approvals/00000000-0000-4000-8000-000000000401/approve',
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: {
        rowVersionToken: 'not-a-number'
      },
      params: {
        paymentId: '00000000-0000-4000-8000-000000000401'
      }
    });

    expect(result.status).toBe(400);
    expect(result.json.error.code).toBe('VALIDATION_ERROR');
  });

  it('records approval rejections with a reason', async () => {
    const result = await invokeRoute(approvalsRejectRoute.POST as never, {
      url: 'https://example.com/api/v1/approvals/00000000-0000-4000-8000-000000000401/reject',
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: {
        rowVersionToken: '1',
        reason: 'sanctions screening mismatch'
      },
      params: {
        paymentId: '00000000-0000-4000-8000-000000000401'
      }
    });

    expect(result.status).toBe(200);
    expect(result.json.data.status).toBe('rejected');
  });

  it('returns current cash positions', async () => {
    const result = await invokeRoute(cashLatestRoute.GET, {
      url: 'https://example.com/api/v1/cash-positions/latest',
      method: 'GET',
      headers: authHeaders()
    });

    expect(result.status).toBe(200);
    expect(result.json.data.totalCash).toBe('950000.000000');
  });

  it('validates cash position history query parameters', async () => {
    const result = await invokeRoute(cashHistoryRoute.GET, {
      url: 'https://example.com/api/v1/cash-positions/history?days=bad',
      method: 'GET',
      headers: authHeaders()
    });

    expect(result.status).toBe(400);
    expect(result.json.error.code).toBe('VALIDATION_ERROR');
  });

  it('validates forecast creation payloads', async () => {
    const result = await invokeRoute(forecastsRoute.POST, {
      url: 'https://example.com/api/v1/forecasts',
      method: 'POST',
      headers: { ...authHeaders({ 'idempotency-key': 'forecast-create-invalid-1' }), 'content-type': 'application/json' },
      body: {
        forecastType: 'short_term',
        horizon: 0,
        currencyCode: 'USD',
        scenarioName: 'base'
      }
    });

    expect(result.status).toBe(400);
    expect(result.json.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns paginated forecasts', async () => {
    const result = await invokeRoute(forecastsRoute.GET, {
      url: 'https://example.com/api/v1/forecasts?type=short_term&status=draft',
      method: 'GET',
      headers: authHeaders()
    });

    expect(result.status).toBe(200);
    expect(result.json.data.items[0].forecast_type).toBe('short_term');
  });

  it('creates forecasts for authorized users', async () => {
    const result = await invokeRoute(forecastsRoute.POST, {
      url: 'https://example.com/api/v1/forecasts',
      method: 'POST',
      headers: { ...authHeaders({ 'idempotency-key': 'forecast-create-valid-1' }), 'content-type': 'application/json' },
      body: {
        forecastType: 'short_term',
        horizon: 7,
        currencyCode: 'USD',
        scenarioName: 'Weekly cash forecast'
      }
    });

    expect(result.status).toBe(201);
    expect(result.json.data.forecastId).toBe('00000000-0000-4000-8000-000000000901');
  });

  it('returns paginated investments', async () => {
    const result = await invokeRoute(investmentsRoute.GET, {
      url: 'https://example.com/api/v1/investments?status=active&instrumentType=mmf',
      method: 'GET',
      headers: authHeaders()
    });

    expect(result.status).toBe(200);
    expect(result.json.data.items[0].instrument_type).toBe('mmf');
  });

  it('creates investments for authorized users', async () => {
    const result = await invokeRoute(investmentsRoute.POST, {
      url: 'https://example.com/api/v1/investments',
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: {
        instrumentName: 'USD Money Market Fund',
        instrumentType: 'mmf',
        principalAmount: '5000000.000000',
        currencyCode: 'USD',
        startDate: '2026-03-14',
        maturityDate: '2026-04-14',
        rate: '4.250000'
      }
    });

    expect(result.status).toBe(201);
    expect(result.json.data.instrument_name).toBe('USD Money Market Fund');
  });

  it('returns investments by id', async () => {
    const result = await invokeRoute(investmentsByIdRoute.GET, {
      url: 'https://example.com/api/v1/investments/00000000-0000-4000-8000-000000000950',
      method: 'GET',
      headers: authHeaders(),
      params: {
        investmentId: '00000000-0000-4000-8000-000000000950'
      }
    });

    expect(result.status).toBe(200);
    expect(result.json.data.id).toBe('00000000-0000-4000-8000-000000000950');
  });

  it('reconciles transactions for authorized users', async () => {
    const result = await invokeRoute(transactionsReconcileRoute.POST, {
      url: 'https://example.com/api/v1/transactions/00000000-0000-4000-8000-000000000701/reconcile',
      method: 'POST',
      headers: { ...authHeaders(), 'content-type': 'application/json' },
      body: {
        reconciliationReference: 'REC-20260314-0001'
      },
      params: {
        transactionId: '00000000-0000-4000-8000-000000000701'
      }
    });

    expect(result.status).toBe(200);
    expect(result.json.data.reconciliation_status).toBe('reconciled');
  });
});
