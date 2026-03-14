import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { bankAccountFixture, cashPositionFixture, paymentFixture, pendingApprovalFixture, transactionFixture } from '../../fixtures/treasury';
import { createRouteTestClient } from '../../utils/routeHarness';

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
import * as transactionsRoute from '@api/v1/transactions/route';
import * as transactionsImportRoute from '@api/v1/transactions/import/route';
import * as paymentsRoute from '@api/v1/payments/route';
import * as approvalsPendingRoute from '@api/v1/approvals/pending/route';
import * as approvalsApproveRoute from '@api/v1/approvals/[paymentId]/approve/route';
import * as cashLatestRoute from '@api/v1/cash-positions/latest/route';
import * as cashHistoryRoute from '@api/v1/cash-positions/history/route';
import * as forecastsRoute from '@api/v1/forecasts/route';
import * as investmentsRoute from '@api/v1/investments/route';

const client = createRouteTestClient([
  { method: 'GET', pattern: '/api/v1/accounts', handler: accountsRoute.GET },
  { method: 'POST', pattern: '/api/v1/accounts', handler: accountsRoute.POST },
  { method: 'GET', pattern: '/api/v1/transactions', handler: transactionsRoute.GET },
  { method: 'POST', pattern: '/api/v1/transactions/import', handler: transactionsImportRoute.POST },
  { method: 'GET', pattern: '/api/v1/payments', handler: paymentsRoute.GET },
  { method: 'POST', pattern: '/api/v1/payments', handler: paymentsRoute.POST },
  { method: 'GET', pattern: '/api/v1/approvals/pending', handler: approvalsPendingRoute.GET },
  { method: 'POST', pattern: '/api/v1/approvals/:paymentId/approve', handler: approvalsApproveRoute.POST as never },
  { method: 'GET', pattern: '/api/v1/cash-positions/latest', handler: cashLatestRoute.GET },
  { method: 'GET', pattern: '/api/v1/cash-positions/history', handler: cashHistoryRoute.GET },
  { method: 'GET', pattern: '/api/v1/forecasts', handler: forecastsRoute.GET },
  { method: 'POST', pattern: '/api/v1/forecasts', handler: forecastsRoute.POST },
  { method: 'GET', pattern: '/api/v1/investments', handler: investmentsRoute.GET },
  { method: 'POST', pattern: '/api/v1/investments', handler: investmentsRoute.POST }
]);

beforeEach(() => {
  routeState.permissionAllowed = true;
  routeState.membershipAllowed = true;
  routeState.services = {
    accounts: {
      list: vi.fn(async () => ({ items: [bankAccountFixture()], nextCursor: null })),
      create: vi.fn(async () => bankAccountFixture())
    },
    transactions: {
      list: vi.fn(async () => ({ items: [transactionFixture()], nextCursor: null })),
      reconcile: vi.fn()
    },
    cashPositions: {
      getLatest: vi.fn(async () => [cashPositionFixture()]),
      getHistory: vi.fn(async () => [cashPositionFixture()])
    },
    payments: {
      list: vi.fn(async () => ({ items: [paymentFixture()], nextCursor: null })),
      create: vi.fn(async () => paymentFixture())
    },
    approvals: {
      listPending: vi.fn(async () => [pendingApprovalFixture()]),
      approve: vi.fn(async () => paymentFixture({ status: 'approved', version: 2 }))
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
            currency_code: 'USD',
            model_type: 'statistical',
            model_version: 'v1',
            status: 'draft',
            created_at: '2026-03-14T09:00:00.000Z',
            updated_at: '2026-03-14T09:00:00.000Z'
          }
        ],
        nextCursor: null
      })),
      create: vi.fn(async () => ({
        id: '00000000-0000-4000-8000-000000000901',
        organization_id: '00000000-0000-4000-8000-000000000001',
        name: 'Weekly cash forecast',
        forecast_type: 'short_term',
        start_date: '2026-03-14',
        end_date: '2026-03-21',
        currency_code: 'USD',
        model_type: 'statistical',
        model_version: 'v1',
        status: 'draft',
        created_at: '2026-03-14T09:00:00.000Z',
        updated_at: '2026-03-14T09:00:00.000Z'
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
      }))
    }
  };
});

afterAll(async () => {
  await client.close();
});

function authorized(requestBuilder: ReturnType<typeof client.request.get>) {
  return requestBuilder
    .set('authorization', 'Bearer valid-token')
    .set('x-organization-id', '00000000-0000-4000-8000-000000000001')
    .set('x-request-id', 'req-test-1');
}

describe.skipIf(process.env.ENABLE_SUPERTEST_SOCKET_TESTS !== '1')('treasury API routes', () => {
  it('returns paginated accounts through the accounts endpoint', async () => {
    const response = await authorized(client.request.get('/api/v1/accounts?status=active&currencyCode=usd'));

    expect(response.status).toBe(200);
    expect(response.body.data.items).toHaveLength(1);
    expect(response.body.meta.requestId).toBe('req-test-1');
  });

  it('rejects unauthorized account creation when the permission is missing', async () => {
    routeState.permissionAllowed = false;

    const response = await authorized(client.request.post('/api/v1/accounts')).send({
      bankConnectionId: '00000000-0000-4000-8000-000000000301',
      accountName: 'Ops Account',
      accountNumberMasked: '****1234',
      currencyCode: 'USD'
    });

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ACCESS_DENIED');
  });

  it('returns transactions using Supertest-backed route execution', async () => {
    const response = await authorized(client.request.get('/api/v1/transactions?direction=outflow'));

    expect(response.status).toBe(200);
    expect(response.body.data.items[0].dedupe_hash).toBe('dedupe-hash-0000001');
  });

  it('validates manual transaction import requests', async () => {
    const response = await authorized(client.request.post('/api/v1/transactions/import')).send({
      bankConnectionId: 'not-a-uuid',
      sourceFilename: ''
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('requires authentication for payment listing', async () => {
    const response = await client.request.get('/api/v1/payments');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('ACCESS_DENIED');
  });

  it('creates payments with an idempotency key and returns the API envelope', async () => {
    const response = await authorized(client.request.post('/api/v1/payments'))
      .set('idempotency-key', 'idem-pay-001')
      .send({
        paymentReference: 'PAY-20260314-0001',
        sourceAccountId: '00000000-0000-4000-8000-000000000201',
        beneficiaryCounterpartyId: '00000000-0000-4000-8000-000000000501',
        amount: '125000.120000',
        currencyCode: 'USD',
        valueDate: '2026-03-15'
      });

    expect(response.status).toBe(201);
    expect(response.body.data.status).toBe('pending_approval');
  });

  it('rejects payment creation without an idempotency key', async () => {
    const response = await authorized(client.request.post('/api/v1/payments')).send({
      paymentReference: 'PAY-20260314-0001',
      sourceAccountId: '00000000-0000-4000-8000-000000000201',
      beneficiaryCounterpartyId: '00000000-0000-4000-8000-000000000501',
      amount: '125000.120000',
      currencyCode: 'USD',
      valueDate: '2026-03-15'
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns pending approvals for the authenticated approver', async () => {
    const response = await authorized(client.request.get('/api/v1/approvals/pending'));
    expect(response.status).toBe(200);
    expect(response.body.data[0].paymentReference).toBe('PAY-20260314-0001');
  });

  it('validates approval decisions before execution', async () => {
    const response = await authorized(client.request.post('/api/v1/approvals/00000000-0000-4000-8000-000000000401/approve')).send({
      rowVersionToken: 'not-a-number'
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns current cash positions', async () => {
    const response = await authorized(client.request.get('/api/v1/cash-positions/latest?scopeType=organization&currencyCode=USD'));
    expect(response.status).toBe(200);
    expect(response.body.data[0].current_balance).toBe('950000.000000');
  });

  it('validates forecast creation payloads', async () => {
    const response = await authorized(client.request.post('/api/v1/forecasts')).send({
      name: '',
      forecastType: 'short_term',
      startDate: '2026-03-14',
      endDate: '2026-03-21',
      currencyCode: 'USD',
      scenario: 'base'
    });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('creates investment records for authorized users', async () => {
    const response = await authorized(client.request.post('/api/v1/investments')).send({
      instrumentName: 'USD Money Market Fund',
      instrumentType: 'mmf',
      principalAmount: '5000000.000000',
      currencyCode: 'USD',
      startDate: '2026-03-14',
      maturityDate: '2026-04-14',
      rate: '4.250000'
    });

    expect(response.status).toBe(201);
    expect(response.body.data.instrument_name).toBe('USD Money Market Fund');
  });

  it('validates cash position history query parameters', async () => {
    const response = await authorized(client.request.get('/api/v1/cash-positions/history?scopeType=organization&currencyCode=USD&fromDate=bad&toDate=2026-03-31'));
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
