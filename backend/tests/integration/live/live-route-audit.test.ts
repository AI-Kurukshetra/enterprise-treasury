import { describe, beforeAll, afterAll, expect, it } from 'vitest';
import type request from 'supertest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRouteTestClient } from '../../utils/routeHarness';
import {
  buildAuthHeaders,
  createLiveClients,
  ensureAuditRole,
  LIVE_ACCOUNT_PRIMARY_ID,
  LIVE_ACCOUNT_SECONDARY_ID,
  LIVE_APPROVER_ROLE_ID,
  LIVE_COUNTERPARTY_ID,
  provisionUser,
  seedLiveOrganizationData,
  signInUser,
  type ProvisionedUser
} from './live-support';
import * as authLoginRoute from '@api/v1/auth/login/route';
import * as authMeRoute from '@api/v1/auth/me/route';
import * as accountsRoute from '@api/v1/accounts/route';
import * as transactionsRoute from '@api/v1/transactions/route';
import * as paymentsRoute from '@api/v1/payments/route';
import * as paymentByIdRoute from '@api/v1/payments/[paymentId]/route';
import * as cashLatestRoute from '@api/v1/cash-positions/latest/route';
import * as cashHistoryRoute from '@api/v1/cash-positions/history/route';
import * as forecastsRoute from '@api/v1/forecasts/route';
import * as riskExposuresRoute from '@api/v1/risk/exposures/route';
import * as riskRecalculateRoute from '@api/v1/risk/exposures/recalculate/route';
import * as riskAlertsRoute from '@api/v1/risk/alerts/route';
import * as investmentsRoute from '@api/v1/investments/route';
import * as debtFacilitiesRoute from '@api/v1/debt/facilities/route';
import * as reportsCashSummaryRoute from '@api/v1/reports/cash-summary/route';
import * as reportsLiquidityRoute from '@api/v1/reports/liquidity/route';
import * as liquidityPoolsRoute from '@api/v1/liquidity/pools/route';
import * as liquidityRulesRoute from '@api/v1/liquidity/rules/route';
import * as liquidityPositionRoute from '@api/v1/liquidity/position/route';
import * as fxRatesRoute from '@api/v1/fx/rates/route';
import * as integrationsBanksRoute from '@api/v1/integrations/banks/route';
import * as adminAuditLogsRoute from '@api/v1/admin/audit-logs/route';
import * as notificationsRoute from '@api/v1/notifications/route';
import * as approvalsApproveRoute from '@api/v1/approvals/[paymentId]/approve/route';

const shouldRunLiveAudit = process.env.RUN_LIVE_ROUTE_AUDIT === '1';
const __dirname = dirname(fileURLToPath(import.meta.url));
const reportOutputPath = resolve(__dirname, '../../../test-results/live-route-audit.json');

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

interface AuditRecord {
  endpoint: string;
  method: string;
  status: number;
  schemaMatched: boolean;
  dataClassification: 'real' | 'empty' | 'stub' | 'error';
  note: string;
}

describe.skipIf(!shouldRunLiveAudit)('live route audit', () => {
  const client = createRouteTestClient([
    { method: 'POST', pattern: '/api/v1/auth/login', handler: authLoginRoute.POST as never },
    { method: 'GET', pattern: '/api/v1/auth/me', handler: authMeRoute.GET as never },
    { method: 'GET', pattern: '/api/v1/accounts', handler: accountsRoute.GET as never },
    { method: 'GET', pattern: '/api/v1/transactions', handler: transactionsRoute.GET as never },
    { method: 'GET', pattern: '/api/v1/payments', handler: paymentsRoute.GET as never },
    { method: 'POST', pattern: '/api/v1/payments', handler: paymentsRoute.POST as never },
    { method: 'GET', pattern: '/api/v1/payments/:paymentId', handler: paymentByIdRoute.GET as never },
    { method: 'GET', pattern: '/api/v1/cash-positions/latest', handler: cashLatestRoute.GET as never },
    { method: 'GET', pattern: '/api/v1/cash-positions/history', handler: cashHistoryRoute.GET as never },
    { method: 'GET', pattern: '/api/v1/forecasts', handler: forecastsRoute.GET as never },
    { method: 'GET', pattern: '/api/v1/risk/exposures', handler: riskExposuresRoute.GET as never },
    { method: 'POST', pattern: '/api/v1/risk/exposures/recalculate', handler: riskRecalculateRoute.POST as never },
    { method: 'GET', pattern: '/api/v1/risk/alerts', handler: riskAlertsRoute.GET as never },
    { method: 'GET', pattern: '/api/v1/investments', handler: investmentsRoute.GET as never },
    { method: 'GET', pattern: '/api/v1/debt/facilities', handler: debtFacilitiesRoute.GET as never },
    { method: 'GET', pattern: '/api/v1/reports/cash-summary', handler: reportsCashSummaryRoute.GET as never },
    { method: 'GET', pattern: '/api/v1/reports/liquidity', handler: reportsLiquidityRoute.GET as never },
    { method: 'GET', pattern: '/api/v1/liquidity/pools', handler: liquidityPoolsRoute.GET as never },
    { method: 'POST', pattern: '/api/v1/liquidity/pools', handler: liquidityPoolsRoute.POST as never },
    { method: 'POST', pattern: '/api/v1/liquidity/rules', handler: liquidityRulesRoute.POST as never },
    { method: 'GET', pattern: '/api/v1/liquidity/position', handler: liquidityPositionRoute.GET as never },
    { method: 'GET', pattern: '/api/v1/fx/rates', handler: fxRatesRoute.GET as never },
    { method: 'GET', pattern: '/api/v1/integrations/banks', handler: integrationsBanksRoute.GET as never },
    { method: 'GET', pattern: '/api/v1/admin/audit-logs', handler: adminAuditLogsRoute.GET as never },
    { method: 'GET', pattern: '/api/v1/notifications', handler: notificationsRoute.GET as never },
    { method: 'POST', pattern: '/api/v1/approvals/:paymentId/approve', handler: approvalsApproveRoute.POST as never }
  ]);

  const endpointAudit: AuditRecord[] = [];
  let auditAccessToken = '';
  let approverAccessToken = '';
  let auditUser: ProvisionedUser;
  let approverUser: ProvisionedUser;

  function classifyPayload(status: number, payload: JsonValue): Pick<AuditRecord, 'schemaMatched' | 'dataClassification' | 'note'> {
    if (status >= 500) {
      const errorCode =
        payload && typeof payload === 'object' && 'error' in payload && payload.error && typeof payload.error === 'object' && 'code' in payload.error
          ? String((payload.error as { code?: unknown }).code ?? 'SYSTEM_UNEXPECTED_ERROR')
          : 'SYSTEM_UNEXPECTED_ERROR';
      return {
        schemaMatched: false,
        dataClassification: 'error',
        note: errorCode
      };
    }

    if (status === 501) {
      return {
        schemaMatched: false,
        dataClassification: 'stub',
        note: 'Not implemented'
      };
    }

    const data =
      payload && typeof payload === 'object' && 'data' in payload
        ? ((payload as { data?: JsonValue }).data ?? null)
        : payload;

    if (Array.isArray(data)) {
      return {
        schemaMatched: true,
        dataClassification: data.length > 0 ? 'real' : 'empty',
        note: `array(${data.length})`
      };
    }

    if (data && typeof data === 'object') {
      const keys = Object.keys(data);
      return {
        schemaMatched: true,
        dataClassification: keys.length > 0 ? 'real' : 'empty',
        note: `object(${keys.length})`
      };
    }

    return {
      schemaMatched: status < 400,
      dataClassification: data === null ? 'empty' : 'real',
      note: data === null ? 'null payload' : String(data)
    };
  }

  async function record(
    method: string,
    endpoint: string,
    requestBuilder: request.Test
  ): Promise<{ status: number; payload: JsonValue }> {
    const response = await requestBuilder;
    const contentType = response.headers['content-type'] ?? '';
    const payload = contentType.includes('application/json')
      ? (response.body as JsonValue)
      : (response.text as JsonValue);
    const classification = classifyPayload(response.status, payload);

    endpointAudit.push({
      endpoint,
      method,
      status: response.status,
      ...classification
    });

    return {
      status: response.status,
      payload
    };
  }

  beforeAll(async () => {
    const { anonClient, serviceClient } = createLiveClients();
    await seedLiveOrganizationData(serviceClient);
    const auditRoleId = await ensureAuditRole(serviceClient);

    auditUser = await provisionUser(serviceClient, {
      displayName: 'QA Live Auditor',
      roleId: auditRoleId,
      prefix: 'qa-auditor'
    });
    approverUser = await provisionUser(serviceClient, {
      displayName: 'QA Live Approver',
      roleId: LIVE_APPROVER_ROLE_ID,
      prefix: 'qa-approver'
    });

    auditAccessToken = await signInUser(anonClient, auditUser.email, auditUser.password);
    approverAccessToken = await signInUser(anonClient, approverUser.email, approverUser.password);
  }, 120_000);

  afterAll(async () => {
    mkdirSync(dirname(reportOutputPath), { recursive: true });
    writeFileSync(
      reportOutputPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          records: endpointAudit
        },
        null,
        2
      )
    );
    await client.close();
  });

  it('returns 401 for invalid backend login credentials', async () => {
    const result = await record(
      'POST',
      '/api/v1/auth/login',
      client.request.post('/api/v1/auth/login').send({
        email: 'nobody@example.com',
        password: 'NotTheRightPassword9'
      })
    );

    expect(result.status).toBe(401);
  }, 60_000);

  it('returns a valid session for a provisioned live user and loads /auth/me', async () => {
    const loginResult = await record(
      'POST',
      '/api/v1/auth/login',
      client.request.post('/api/v1/auth/login').send({
        email: auditUser.email,
        password: auditUser.password
      })
    );

    expect(loginResult.status).toBe(200);

    const meResult = await record(
      'GET',
      '/api/v1/auth/me',
      client.request.get('/api/v1/auth/me').set(buildAuthHeaders(auditAccessToken))
    );

    expect(meResult.status).toBe(200);
  }, 60_000);

  it('captures live GET endpoint health across the audited backend surface', async () => {
    await record('GET', '/api/v1/accounts', client.request.get('/api/v1/accounts').set(buildAuthHeaders(auditAccessToken)));
    await record('GET', '/api/v1/transactions', client.request.get('/api/v1/transactions').set(buildAuthHeaders(auditAccessToken)));
    await record('GET', '/api/v1/payments', client.request.get('/api/v1/payments').set(buildAuthHeaders(auditAccessToken)));
    await record('GET', '/api/v1/cash-positions/latest', client.request.get('/api/v1/cash-positions/latest').set(buildAuthHeaders(auditAccessToken)));
    await record('GET', '/api/v1/cash-positions/history', client.request.get('/api/v1/cash-positions/history').set(buildAuthHeaders(auditAccessToken)));
    await record('GET', '/api/v1/forecasts', client.request.get('/api/v1/forecasts').set(buildAuthHeaders(auditAccessToken)));
    await record('GET', '/api/v1/risk/exposures', client.request.get('/api/v1/risk/exposures').set(buildAuthHeaders(auditAccessToken)));
    await record('GET', '/api/v1/risk/alerts', client.request.get('/api/v1/risk/alerts').set(buildAuthHeaders(auditAccessToken)));
    await record('GET', '/api/v1/investments', client.request.get('/api/v1/investments').set(buildAuthHeaders(auditAccessToken)));
    await record('GET', '/api/v1/debt/facilities', client.request.get('/api/v1/debt/facilities').set(buildAuthHeaders(auditAccessToken)));
    await record(
      'GET',
      '/api/v1/reports/cash-summary',
      client.request
        .get('/api/v1/reports/cash-summary?periodStart=2026-03-01&periodEnd=2026-03-14')
        .set(buildAuthHeaders(auditAccessToken))
    );
    await record(
      'GET',
      '/api/v1/reports/liquidity',
      client.request
        .get('/api/v1/reports/liquidity?asOf=2026-03-14')
        .set(buildAuthHeaders(auditAccessToken))
    );
    await record('GET', '/api/v1/liquidity/pools', client.request.get('/api/v1/liquidity/pools').set(buildAuthHeaders(auditAccessToken)));
    await record('GET', '/api/v1/liquidity/position', client.request.get('/api/v1/liquidity/position').set(buildAuthHeaders(auditAccessToken)));
    await record(
      'GET',
      '/api/v1/fx/rates',
      client.request
        .get('/api/v1/fx/rates?base=USD&currencies=EUR,GBP,JPY')
        .set(buildAuthHeaders(auditAccessToken))
    );
    await record('GET', '/api/v1/integrations/banks', client.request.get('/api/v1/integrations/banks').set(buildAuthHeaders(auditAccessToken)));
    await record('GET', '/api/v1/admin/audit-logs', client.request.get('/api/v1/admin/audit-logs').set(buildAuthHeaders(auditAccessToken)));
    await record('GET', '/api/v1/notifications', client.request.get('/api/v1/notifications').set(buildAuthHeaders(auditAccessToken)));

    expect(endpointAudit.length).toBeGreaterThanOrEqual(18);
  }, 120_000);

  it('executes the payment workflow end-to-end, including replay protection', async () => {
    const paymentReference = `QA-LIVE-PAY-${Date.now()}`;
    const idempotencyKey = `qa-live-idem-${Date.now()}`;
    const createResult = await record(
      'POST',
      '/api/v1/payments',
      client.request
        .post('/api/v1/payments')
        .set(buildAuthHeaders(auditAccessToken, { 'idempotency-key': idempotencyKey }))
        .send({
          paymentReference,
          sourceAccountId: LIVE_ACCOUNT_PRIMARY_ID,
          beneficiaryCounterpartyId: LIVE_COUNTERPARTY_ID,
          amount: '1250.000000',
          currencyCode: 'USD',
          valueDate: '2026-03-20',
          purpose: 'Live QA payment workflow validation'
        })
    );

    expect(createResult.status).toBe(201);
    expect(createResult.payload).toBeTruthy();

    const paymentId =
      createResult.payload &&
      typeof createResult.payload === 'object' &&
      'data' in createResult.payload &&
      createResult.payload.data &&
      typeof createResult.payload.data === 'object' &&
      'id' in createResult.payload.data
        ? String((createResult.payload.data as { id?: unknown }).id)
        : '';
    const paymentVersion =
      createResult.payload &&
      typeof createResult.payload === 'object' &&
      'data' in createResult.payload &&
      createResult.payload.data &&
      typeof createResult.payload.data === 'object' &&
      'version' in createResult.payload.data
        ? String((createResult.payload.data as { version?: unknown }).version)
        : '';

    expect(paymentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    );

    const getResult = await record(
      'GET',
      `/api/v1/payments/${paymentId}`,
      client.request.get(`/api/v1/payments/${paymentId}`).set(buildAuthHeaders(auditAccessToken))
    );
    expect(getResult.status).toBe(200);

    const approveResult = await record(
      'POST',
      `/api/v1/approvals/${paymentId}/approve`,
      client.request
        .post(`/api/v1/approvals/${paymentId}/approve`)
        .set(buildAuthHeaders(approverAccessToken))
        .send({
          rowVersionToken: paymentVersion,
          comment: 'Approved by live QA audit'
        })
    );
    expect(approveResult.status).toBe(200);

    const replayResult = await record(
      'POST',
      `/api/v1/approvals/${paymentId}/approve`,
      client.request
        .post(`/api/v1/approvals/${paymentId}/approve`)
        .set(buildAuthHeaders(approverAccessToken))
        .send({
          rowVersionToken: paymentVersion,
          comment: 'Replay approval must fail'
        })
    );
    expect(replayResult.status).toBe(409);
  }, 120_000);

  it('executes the liquidity workflow and risk recalculation route', async () => {
    const poolName = `QA Live Pool ${Date.now()}`;
    const createPoolResult = await record(
      'POST',
      '/api/v1/liquidity/pools',
      client.request
        .post('/api/v1/liquidity/pools')
        .set(buildAuthHeaders(auditAccessToken))
        .send({
          name: poolName,
          poolType: 'physical',
          baseCurrency: 'USD',
          accounts: [
            { bankAccountId: LIVE_ACCOUNT_PRIMARY_ID, priority: 1 },
            { bankAccountId: LIVE_ACCOUNT_SECONDARY_ID, priority: 2 }
          ]
        })
    );

    expect(createPoolResult.status).toBe(201);

    const poolId =
      createPoolResult.payload &&
      typeof createPoolResult.payload === 'object' &&
      'data' in createPoolResult.payload &&
      createPoolResult.payload.data &&
      typeof createPoolResult.payload.data === 'object' &&
      'id' in createPoolResult.payload.data
        ? String((createPoolResult.payload.data as { id?: unknown }).id)
        : '';

    expect(poolId).not.toBe('');

    const createRuleResult = await record(
      'POST',
      '/api/v1/liquidity/rules',
      client.request
        .post('/api/v1/liquidity/rules')
        .set(buildAuthHeaders(auditAccessToken))
        .send({
          poolId,
          ruleName: `QA Live Sweep ${Date.now()}`,
          sourceAccountId: LIVE_ACCOUNT_PRIMARY_ID,
          targetAccountId: LIVE_ACCOUNT_SECONDARY_ID,
          minBalance: '1000.000000',
          targetBalance: '2500.000000',
          maxTransfer: '5000.000000',
          frequency: 'daily',
          isActive: true
        })
    );
    expect(createRuleResult.status).toBe(201);

    const positionResult = await record(
      'GET',
      '/api/v1/liquidity/position',
      client.request.get('/api/v1/liquidity/position').set(buildAuthHeaders(auditAccessToken))
    );
    expect(positionResult.status).toBe(200);

    const recalcResult = await record(
      'POST',
      '/api/v1/risk/exposures/recalculate',
      client.request
        .post('/api/v1/risk/exposures/recalculate')
        .set(buildAuthHeaders(auditAccessToken))
        .send({
          referenceDate: '2026-03-14'
        })
    );
    expect([200, 202]).toContain(recalcResult.status);
  }, 120_000);
});
