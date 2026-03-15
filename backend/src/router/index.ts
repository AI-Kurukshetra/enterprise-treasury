import { z } from 'zod';
import { NextResponse, type NextRequest } from 'next/server';
import { buildOptionsHandler, executeRoute } from '@/api/route';
import { parseJsonBody, parseQuery, parseResponse } from '@/api/validation';
import { toServiceContext } from '@/api/serviceContext';
import { ok } from '@/lib/http';
import { buildServices } from '@/services/serviceFactory';
import { AdminService } from '@/services/admin/service';
import { PolicyAdminService } from '@/services/admin/policy-service';
import { AuthService } from '@/services/auth/service';
import { TreasuryCopilotService } from '@/services/copilot/copilot-service';
import { JobQueue } from '@/lib/job-queue/job-queue';
import { detectStatementFormat } from '@/lib/parsers';
import { ValidationError } from '@/errors/ValidationError';
import { NotFoundError } from '@/errors/NotFoundError';
import { csvFormatter, type ColumnDef } from '@/lib/report-formatters/csv-formatter';
import { CurrencyCodeSchema } from '@/utils/money';
import { PAYMENT_STATUSES } from '@/constants/financial';
import { PolicyDomainSchema, PolicyRuleSchema } from '@/lib/policy-engine/policy-types';

// Schema imports
import { UpdateAccountRequestSchema, CreateAccountRequestSchema, ListAccountsQuerySchema } from '@/schemas/accounts/schema';
import { ApprovalDecisionBodySchema, RejectDecisionBodySchema } from '@/schemas/approvals/schema';
import { CashPositionHistoryQuerySchema } from '@/schemas/cash_positions/schema';
import { ListCounterpartiesQuerySchema } from '@/schemas/counterparties/schema';
import { CreateDebtFacilityRequestSchema, ListDebtFacilitiesQuerySchema } from '@/schemas/debt/schema';
import { ListForecastsQuerySchema, CreateForecastRequestSchema } from '@/schemas/forecasts/schema';
import { GenerateForecastScenarioRequestSchema } from '@/schemas/forecasts/schema';
import { CreateBankIntegrationRequestSchema } from '@/schemas/integrations/schema';
import { ListInvestmentsQuerySchema, CreateInvestmentRequestSchema } from '@/schemas/investments/schema';
import { CreateIntercompanyLoanInputSchema } from '@/schemas/liquidity/schema';
import { UpdatePoolInputSchema, CreatePoolInputSchema, ListPoolsQuerySchema, LiquidityPositionQuerySchema, CreateSweepingRuleInputSchema } from '@/schemas/liquidity/schema';
import { NotificationReadSchema, NotificationCountSchema, NotificationMarkAllReadSchema, ListNotificationsQuerySchema, NotificationListResponseSchema } from '@/schemas/notifications/schema';
import { CreatePaymentRequestSchema, ListPaymentsQuerySchema } from '@/schemas/payments/schema';
import { CashSummaryQuerySchema, GenerateComplianceReportRequestSchema, ComplianceReportListQuerySchema, LiquidityReportQuerySchema } from '@/schemas/reports/schema';
import { UpdateRiskAlertRequestSchema, ListRiskAlertsQuerySchema, RecalculateRiskExposureRequestSchema, ListRiskExposureQuerySchema } from '@/schemas/risk/schema';
import { ReconcileTransactionRequestSchema, ListTransactionsQuerySchema } from '@/schemas/transactions/schema';

type RouteHandler = (req: NextRequest, pathParams: Record<string, string>) => Promise<Response>;

interface RouteEntry {
  method: string;
  pattern: string;
  handler: RouteHandler;
}

class Router {
  private routes: RouteEntry[] = [];

  register(method: string, pattern: string, handler: RouteHandler): void {
    this.routes.push({ method, pattern, handler });
  }

  private match(method: string, segments: string[]): { handler: RouteHandler; pathParams: Record<string, string> } | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const patternParts = route.pattern.split('/').filter(Boolean);
      if (patternParts.length !== segments.length) continue;
      const pathParams: Record<string, string> = {};
      let matched = true;
      for (let i = 0; i < patternParts.length; i++) {
        const part = patternParts[i]!;
        const seg = segments[i]!;
        if (part.startsWith(':')) {
          pathParams[part.slice(1)] = seg;
        } else if (part !== seg) {
          matched = false;
          break;
        }
      }
      if (matched) return { handler: route.handler, pathParams };
    }
    return null;
  }

  async dispatch(method: string, segments: string[], req: NextRequest): Promise<Response> {
    const result = this.match(method, segments);
    if (!result) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' }
      });
    }
    return result.handler(req, result.pathParams);
  }
}

// ─── Helper: stream CSV ────────────────────────────────────────────────────────
function streamCsv(filename: string, csv: string): NextResponse {
  const encoder = new TextEncoder();
  const chunks = csv.match(/.{1,65536}/gs) ?? [''];
  let index = 0;
  return new NextResponse(
    new ReadableStream<Uint8Array>({
      pull(controller) {
        const next = chunks[index++];
        if (!next) { controller.close(); return; }
        controller.enqueue(encoder.encode(next));
      }
    }),
    {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`
      }
    }
  );
}

// ─── Router instance ──────────────────────────────────────────────────────────
const router = new Router();

// ─── accounts ─────────────────────────────────────────────────────────────────
const AccountListSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  bank_connection_id: z.string().uuid().nullable(),
  account_name: z.string(),
  account_number_masked: z.string(),
  currency_code: z.string().length(3),
  region: z.string().nullable(),
  liquidity_type: z.enum(['operating', 'reserve']),
  withdrawal_restricted: z.boolean(),
  current_balance: z.string().optional(),
  available_balance: z.string().optional(),
  restricted_balance: z.string().optional(),
  reconciliation_status: z.enum(['reconciled', 'attention', 'no_activity']).optional(),
  status: z.enum(['active', 'dormant', 'closed']),
  created_at: z.string(),
  updated_at: z.string()
});

const ListAccountsResponseSchema = z.object({
  items: z.array(AccountListSchema),
  nextCursor: z.string().nullable()
});

router.register('GET', 'accounts', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const query = parseQuery(req, ListAccountsQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.accounts.list(
      { status: query.status, currencyCode: query.currencyCode, bankConnectionId: query.bankConnectionId },
      { cursor: query.cursor, limit: query.limit }
    );
    return ok(parseResponse(result, ListAccountsResponseSchema), context.requestId);
  });
});

router.register('POST', 'accounts', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'accounts.create' }, async (_req, context) => {
    const body = await parseJsonBody(req, CreateAccountRequestSchema);
    const services = buildServices(toServiceContext(context));
    const created = await services.accounts.create(body);
    const AccountDetailSchema = z.object({
      id: z.string().uuid(),
      organization_id: z.string().uuid(),
      bank_connection_id: z.string().uuid().nullable(),
      account_name: z.string(),
      account_number_masked: z.string(),
      currency_code: z.string().length(3),
      region: z.string().nullable(),
      liquidity_type: z.enum(['operating', 'reserve']),
      withdrawal_restricted: z.boolean(),
      current_balance: z.string().optional(),
      available_balance: z.string().optional(),
      restricted_balance: z.string().optional(),
      reconciliation_status: z.enum(['reconciled', 'attention', 'no_activity']).optional(),
      status: z.enum(['active', 'dormant', 'closed']),
      created_at: z.string(),
      updated_at: z.string()
    });
    return ok(parseResponse(created, AccountDetailSchema), context.requestId, 201);
  });
});

const AccountByIdSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  bank_connection_id: z.string().uuid(),
  account_name: z.string(),
  account_number_masked: z.string(),
  currency_code: z.string().length(3),
  status: z.enum(['active', 'dormant', 'closed']),
  created_at: z.string(),
  updated_at: z.string()
});

router.register('GET', 'accounts/:accountId', async (req, pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const accountId = pathParams.accountId!;
    const services = buildServices(toServiceContext(context));
    const account = await services.accounts.getById(accountId);
    return ok(parseResponse(account, AccountByIdSchema), context.requestId);
  });
});

router.register('PATCH', 'accounts/:accountId', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'accounts.update' }, async (_req, context) => {
    const accountId = pathParams.accountId!;
    const body = await parseJsonBody(req, UpdateAccountRequestSchema);
    const services = buildServices(toServiceContext(context));
    const account = await services.accounts.update(accountId, body);
    return ok(parseResponse(account, AccountByIdSchema), context.requestId);
  });
});

// ─── admin/audit-logs ─────────────────────────────────────────────────────────
const AuditLogsQuerySchema = z.object({
  fromDate: z.string().date().optional(),
  toDate: z.string().date().optional(),
  userId: z.string().uuid().optional(),
  action: z.string().min(1).optional(),
  entityType: z.string().min(1).optional(),
  search: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(5000).optional().default(100),
  cursor: z.string().optional(),
  format: z.enum(['json', 'csv']).optional().default('json')
});

const AuditLogSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid().nullable(),
  userEmail: z.string().email().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.string().nullable(),
  previousState: z.record(z.unknown()).nullable(),
  newState: z.record(z.unknown()).nullable(),
  requestId: z.string().nullable(),
  createdAt: z.string()
});

const AuditLogPageSchema = z.object({
  items: z.array(AuditLogSchema),
  nextCursor: z.string().nullable()
});

router.register('GET', 'admin/audit-logs', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'admin.audit_logs.read' }, async (_req, context) => {
    const query = parseQuery(req, AuditLogsQuerySchema);
    const adminService = new AdminService(toServiceContext(context));
    const result = parseResponse(
      await adminService.listAuditLogs({
        fromDate: query.fromDate,
        toDate: query.toDate,
        userId: query.userId,
        action: query.action,
        entityType: query.entityType,
        search: query.search,
        limit: query.limit ?? 100,
        cursor: query.cursor
      }),
      AuditLogPageSchema
    );
    if (query.format === 'csv') {
      const columns: ColumnDef[] = [
        { key: 'createdAt', header: 'Timestamp', type: 'datetime' },
        { key: 'userEmail', header: 'User Email' },
        { key: 'userId', header: 'User ID' },
        { key: 'action', header: 'Action' },
        { key: 'entityType', header: 'Entity Type' },
        { key: 'entityId', header: 'Entity ID' },
        { key: 'requestId', header: 'Request ID' },
        { key: 'previousState', header: 'Previous State', type: 'json' },
        { key: 'newState', header: 'New State', type: 'json' }
      ];
      return streamCsv(`audit-logs-${new Date().toISOString().slice(0, 10)}.csv`, csvFormatter.format(result.items, columns));
    }
    return ok(result, context.requestId);
  });
});

// ─── admin/policies ───────────────────────────────────────────────────────────
const AdminPolicySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  domain: PolicyDomainSchema,
  version: z.number().int().positive(),
  rules: z.array(PolicyRuleSchema),
  isActive: z.boolean(),
  effectiveFrom: z.string(),
  effectiveTo: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string()
});

const ListPoliciesQuerySchema = z.object({ domain: PolicyDomainSchema.optional() });

const CreatePolicyRequestSchema = z.object({
  name: z.string().min(1).max(120),
  domain: PolicyDomainSchema,
  rules: z.array(PolicyRuleSchema).min(1),
  isActive: z.boolean().optional(),
  effectiveFrom: z.string().date().optional(),
  effectiveTo: z.string().date().nullable().optional()
});

router.register('GET', 'admin/policies', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'policy.read' }, async (_req, context) => {
    const query = parseQuery(req, ListPoliciesQuerySchema);
    const service = new PolicyAdminService(toServiceContext(context));
    return ok(parseResponse(await service.listPolicies(query.domain), z.array(AdminPolicySchema)), context.requestId);
  });
});

router.register('POST', 'admin/policies', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'policy.manage' }, async (_req, context) => {
    const body = await parseJsonBody(req, CreatePolicyRequestSchema);
    const service = new PolicyAdminService(toServiceContext(context));
    return ok(parseResponse(await service.createPolicy(body), AdminPolicySchema), context.requestId, 201);
  });
});

const UpdatePolicyRequestSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  domain: PolicyDomainSchema.optional(),
  rules: z.array(PolicyRuleSchema).min(1),
  isActive: z.boolean().optional(),
  effectiveFrom: z.string().date().optional(),
  effectiveTo: z.string().date().nullable().optional()
});

router.register('GET', 'admin/policies/:policyId', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'policy.read' }, async (_req, context) => {
    const service = new PolicyAdminService(toServiceContext(context));
    return ok(parseResponse(await service.getPolicy(pathParams.policyId!), AdminPolicySchema), context.requestId);
  });
});

router.register('PATCH', 'admin/policies/:policyId', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'policy.manage' }, async (_req, context) => {
    const body = await parseJsonBody(req, UpdatePolicyRequestSchema);
    const service = new PolicyAdminService(toServiceContext(context));
    return ok(parseResponse(await service.updatePolicy(pathParams.policyId!, body), AdminPolicySchema), context.requestId);
  });
});

router.register('DELETE', 'admin/policies/:policyId', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'policy.manage' }, async (_req, context) => {
    const service = new PolicyAdminService(toServiceContext(context));
    return ok(parseResponse(await service.deactivatePolicy(pathParams.policyId!), AdminPolicySchema), context.requestId);
  });
});

// ─── admin/policies/validate ──────────────────────────────────────────────────
const ValidatePolicyRequestSchema = z.object({ rules: z.unknown() });
const ValidatePolicyResponseSchema = z.object({ valid: z.boolean(), errors: z.array(z.string()) });

router.register('POST', 'admin/policies/validate', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'policy.manage' }, async (_req, context) => {
    const body = await parseJsonBody(req, ValidatePolicyRequestSchema);
    const service = new PolicyAdminService(toServiceContext(context));
    try {
      service.validateRules(body.rules);
      return ok(parseResponse({ valid: true, errors: [] }, ValidatePolicyResponseSchema), context.requestId);
    } catch (error) {
      if (error instanceof ValidationError) {
        const rawIssues = error.details?.issues;
        const errors = Array.isArray(rawIssues)
          ? rawIssues.filter((issue): issue is string => typeof issue === 'string')
          : [error.message];
        return ok(parseResponse({ valid: false, errors }, ValidatePolicyResponseSchema), context.requestId);
      }
      throw error;
    }
  });
});

// ─── admin/roles ──────────────────────────────────────────────────────────────
const AdminRoleSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isSystem: z.boolean(),
  permissionCount: z.number().int().nonnegative(),
  permissions: z.array(z.string())
});

const CreateRoleRequestSchema = z.object({
  name: z.string().min(1).max(80),
  permissions: z.array(z.string().min(1)).min(1)
});

const CreateRoleResponseSchema = z.object({ roleId: z.string().uuid(), name: z.string() });

router.register('GET', 'admin/roles', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'admin.roles.read' }, async (_req, context) => {
    const adminService = new AdminService(toServiceContext(context));
    return ok(parseResponse(await adminService.listRoles(), z.array(AdminRoleSchema)), context.requestId);
  });
});

router.register('POST', 'admin/roles', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'admin.roles.manage' }, async (_req, context) => {
    const body = await parseJsonBody(req, CreateRoleRequestSchema);
    const adminService = new AdminService(toServiceContext(context));
    return ok(
      parseResponse(await adminService.createRole(body.name, body.permissions), CreateRoleResponseSchema),
      context.requestId,
      201
    );
  });
});

// ─── admin/users ──────────────────────────────────────────────────────────────
const AdminUserSchema = z.object({
  id: z.string().uuid(),
  name: z.string().nullable(),
  email: z.string().email(),
  role: z.string(),
  status: z.enum(['active', 'invited', 'revoked']),
  lastLogin: z.string().nullable(),
  mfaEnabled: z.boolean()
});

router.register('GET', 'admin/users', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'admin.users.read' }, async (_req, context) => {
    const adminService = new AdminService(toServiceContext(context));
    return ok(parseResponse(await adminService.listUsers(), z.array(AdminUserSchema)), context.requestId);
  });
});

// ─── admin/users/invite ───────────────────────────────────────────────────────
const InviteUserRequestSchema = z.object({
  email: z.string().email(),
  role: z.string().min(1).max(80)
});

const InviteUserResponseSchema = z.object({
  status: z.literal('queued'),
  email: z.string().email(),
  role: z.string(),
  message: z.string()
});

router.register('POST', 'admin/users/invite', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'admin.users.manage' }, async (_req, context) => {
    const body = await parseJsonBody(req, InviteUserRequestSchema);
    return ok(
      parseResponse(
        { status: 'queued', email: body.email, role: body.role, message: 'User invitation stub accepted for future implementation.' },
        InviteUserResponseSchema
      ),
      context.requestId,
      202
    );
  });
});

// ─── admin/users/:userId/revoke ───────────────────────────────────────────────
const RevokeUserResponseSchema = z.object({ userId: z.string().uuid(), status: z.literal('revoked') });

router.register('POST', 'admin/users/:userId/revoke', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'admin.users.manage' }, async (_req, context) => {
    const adminService = new AdminService(toServiceContext(context));
    return ok(parseResponse(await adminService.revokeUser(pathParams.userId!), RevokeUserResponseSchema), context.requestId);
  });
});

// ─── approvals/pending ────────────────────────────────────────────────────────
const PendingApprovalSchema = z.object({
  paymentId: z.string().uuid(),
  paymentReference: z.string(),
  amount: z.union([z.string(), z.number()]).transform(String),
  currencyCode: z.string().length(3),
  valueDate: z.string(),
  createdAt: z.string(),
  rowVersionToken: z.string().regex(/^\d+$/)
});

router.register('GET', 'approvals/pending', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const list = await services.approvals.listPending(context.user!.id);
    return ok(parseResponse(list, z.array(PendingApprovalSchema)), context.requestId);
  });
});

// ─── approvals/:paymentId/approve ────────────────────────────────────────────
const ApprovalResultSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(PAYMENT_STATUSES),
  version: z.number().int().positive()
}).passthrough();

router.register('POST', 'approvals/:paymentId/approve', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'payments.approve', rateLimit: 'api.sensitive' }, async (_req, context) => {
    const body = await parseJsonBody(req, ApprovalDecisionBodySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.approvals.approve(
      { paymentId: pathParams.paymentId!, rowVersionToken: body.rowVersionToken, comment: body.comment },
      context.user!.id
    );
    return ok(parseResponse(result, ApprovalResultSchema), context.requestId);
  });
});

// ─── approvals/:paymentId/reject ─────────────────────────────────────────────
const RejectionResultSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(PAYMENT_STATUSES),
  version: z.number().int().positive()
}).passthrough();

router.register('POST', 'approvals/:paymentId/reject', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'payments.approve', rateLimit: 'api.sensitive' }, async (_req, context) => {
    const body = await parseJsonBody(req, RejectDecisionBodySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.approvals.reject(
      { paymentId: pathParams.paymentId!, rowVersionToken: body.rowVersionToken, comment: body.reason },
      context.user!.id
    );
    return ok(parseResponse(result, RejectionResultSchema), context.requestId);
  });
});

// ─── auth/login ───────────────────────────────────────────────────────────────
const LoginRequestSchema = z.object({ email: z.string().email(), password: z.string().min(8) });
const LoginResponseSchema = z.object({
  user: z.object({ id: z.string().uuid(), email: z.string().email() }),
  session: z.object({ accessToken: z.string(), expiresIn: z.number().int().positive() })
});

router.register('POST', 'auth/login', async (req, _pathParams) => {
  return executeRoute(req, { requiresAuth: false, requiresOrganization: false, rateLimit: 'auth.login' }, async (_req, context) => {
    const body = await parseJsonBody(req, LoginRequestSchema);
    const authService = new AuthService();
    return ok(parseResponse(await authService.login(body.email, body.password), LoginResponseSchema), context.requestId);
  });
});

// ─── auth/logout ──────────────────────────────────────────────────────────────
const LogoutResponseSchema = z.object({ success: z.literal(true) });

router.register('POST', 'auth/logout', async (req, _pathParams) => {
  return executeRoute(req, { requiresOrganization: false }, async (_req, context) => {
    const authService = new AuthService();
    return ok(parseResponse(authService.logout(), LogoutResponseSchema), context.requestId);
  });
});

// ─── auth/me ─────────────────────────────────────────────────────────────────
const MeResponseSchema = z.object({
  user: z.object({ id: z.string().uuid(), email: z.string().email() }),
  memberships: z.array(z.object({ organizationId: z.string().uuid(), roleId: z.string().uuid(), status: z.string() })),
  permissions: z.record(z.array(z.string()))
});

router.register('GET', 'auth/me', async (req, _pathParams) => {
  return executeRoute(req, { requiresOrganization: false }, async (_req, context) => {
    const authService = new AuthService();
    const response = await authService.getProfile({ id: context.user!.id, email: context.user!.email });
    return ok(parseResponse(response, MeResponseSchema), context.requestId);
  });
});

// ─── cash-positions/latest ───────────────────────────────────────────────────
const CashPositionSummarySchema = z.object({
  totalCash: z.string(),
  availableLiquidity: z.string(),
  pendingPayments: z.object({
    amount: z.union([z.string(), z.number()]).transform(String),
    count: z.number().int().nonnegative()
  }),
  riskLimitsInWatch: z.number().int().nonnegative(),
  baseCurrency: z.string().length(3),
  asOf: z.string(),
  byRegion: z.array(z.object({ region: z.string(), operating: z.string(), reserve: z.string(), trapped: z.string() })),
  trend: z.array(z.object({ label: z.string(), value: z.string(), projected: z.string(), buffer: z.string() })),
  paymentVolume: z.array(z.object({ label: z.string(), urgent: z.number().int().nonnegative(), scheduled: z.number().int().nonnegative() }))
});

router.register('GET', 'cash-positions/latest', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = await services.cashPositions.getLatest();
    return ok(parseResponse(result, CashPositionSummarySchema), context.requestId);
  });
});

// ─── cash-positions/history ──────────────────────────────────────────────────
const CashTrendPointSchema = z.object({
  date: z.string(),
  label: z.string(),
  value: z.string(),
  projected: z.string(),
  buffer: z.string()
});

router.register('GET', 'cash-positions/history', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const query = parseQuery(req, CashPositionHistoryQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.cashPositions.getHistory({ days: query.days ?? 30, granularity: query.granularity ?? 'daily' });
    return ok(parseResponse(result, z.array(CashTrendPointSchema)), context.requestId);
  });
});

// ─── copilot/chat ─────────────────────────────────────────────────────────────
const CopilotChatRequestSchema = z.object({
  message: z.string().trim().min(1).max(8_000),
  sessionId: z.string().uuid().optional(),
  messageId: z.string().min(1).max(128).optional()
});

function encodeEvent(payload: Record<string, unknown>) {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

router.register('POST', 'copilot/chat', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'copilot.access', rateLimit: 'copilot.chat' }, async (_req, context) => {
    const body = await parseJsonBody(req, CopilotChatRequestSchema);
    const copilotService = new TreasuryCopilotService();
    const prepared = await copilotService.prepareSession({
      organizationId: context.organizationId!,
      userId: context.user!.id,
      sessionId: body.sessionId,
      message: body.message,
      messageId: body.messageId
    });
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        void (async () => {
          try {
            if (prepared.replayMessage) {
              for (const chunk of copilotService.replayAssistantMessage(prepared.replayMessage)) {
                controller.enqueue(encoder.encode(encodeEvent({ ...chunk, sessionId: prepared.session.id })));
              }
            } else {
              const responseStream = await copilotService.chat(
                context.organizationId!,
                context.user!.id,
                prepared.session.messages,
                prepared.session.id
              );
              for await (const chunk of responseStream) {
                controller.enqueue(encoder.encode(encodeEvent({ ...chunk, sessionId: prepared.session.id })));
              }
            }
            controller.enqueue(encoder.encode(encodeEvent({ type: 'done', sessionId: prepared.session.id })));
          } catch (error) {
            controller.enqueue(encoder.encode(encodeEvent({
              type: 'error',
              message: error instanceof Error ? error.message : 'Copilot stream failed',
              sessionId: prepared.session.id
            })));
          } finally {
            controller.close();
          }
        })();
      }
    });
    return new NextResponse(stream, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' }
    });
  });
});

// ─── copilot/sessions ─────────────────────────────────────────────────────────
const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationInputTokens: z.number().int().nonnegative(),
  cacheReadInputTokens: z.number().int().nonnegative(),
  estimatedCostUsd: z.string()
});

const SessionSummarySchema = z.object({
  id: z.string().uuid(),
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  lastMessagePreview: z.string().nullable(),
  tokenUsage: TokenUsageSchema
});

router.register('GET', 'copilot/sessions', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'copilot.access' }, async (_req, context) => {
    const copilotService = new TreasuryCopilotService();
    const sessions = await copilotService.listSessions(context.organizationId!, context.user!.id);
    return ok(parseResponse(sessions, z.array(SessionSummarySchema)), context.requestId);
  });
});

// ─── copilot/sessions/:sessionId ─────────────────────────────────────────────
const ToolAuditSchema = z.object({
  tool: z.enum([
    'get_cash_position', 'get_fx_rates', 'list_pending_approvals', 'get_risk_summary',
    'get_liquidity_forecast', 'get_account_transactions', 'get_investment_summary', 'get_debt_summary'
  ]),
  input: z.record(z.string(), z.unknown()),
  executedAt: z.string(),
  source: z.string(),
  timestamp: z.string().nullable()
});

const CopilotMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  createdAt: z.string(),
  metadata: z.object({
    inReplyToId: z.string().optional(),
    toolCalls: z.array(ToolAuditSchema).optional(),
    usage: TokenUsageSchema.optional()
  }).optional()
});

const SessionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  userId: z.string().uuid(),
  title: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  tokenUsage: TokenUsageSchema,
  messages: z.array(CopilotMessageSchema)
});

router.register('GET', 'copilot/sessions/:sessionId', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'copilot.access' }, async (_req, context) => {
    const copilotService = new TreasuryCopilotService();
    const session = await copilotService.getSession(context.organizationId!, context.user!.id, pathParams.sessionId!);
    return ok(parseResponse(session, SessionSchema), context.requestId);
  });
});

// ─── counterparties ───────────────────────────────────────────────────────────
const CounterpartySchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string(),
  type: z.enum(['customer', 'vendor', 'bank', 'affiliate', 'other']),
  country_code: z.string().nullable(),
  risk_rating: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

const ListCounterpartiesResponseSchema = z.object({
  items: z.array(CounterpartySchema),
  nextCursor: z.string().nullable()
});

router.register('GET', 'counterparties', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const query = parseQuery(req, ListCounterpartiesQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.counterparties.list({ type: query.type, search: query.search }, { cursor: query.cursor, limit: query.limit });
    return ok(parseResponse(result, ListCounterpartiesResponseSchema), context.requestId);
  });
});

// ─── debt/facilities ─────────────────────────────────────────────────────────
const DebtFacilitySchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  facility_name: z.string(),
  facility_type: z.enum(['revolver', 'term_loan', 'overdraft']),
  limit_amount: z.union([z.string(), z.number()]).transform(String),
  utilized_amount: z.union([z.string(), z.number()]).transform(String),
  currency_code: z.string().length(3),
  status: z.enum(['active', 'suspended', 'closed'])
});

const DebtFacilitiesListSchema = z.object({ items: z.array(DebtFacilitySchema), nextCursor: z.string().nullable() });

router.register('GET', 'debt/facilities', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const query = parseQuery(req, ListDebtFacilitiesQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.debt.listFacilities({ status: query.status }, { cursor: query.cursor, limit: query.limit });
    return ok(parseResponse(result, DebtFacilitiesListSchema), context.requestId);
  });
});

router.register('POST', 'debt/facilities', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'debt.create' }, async (_req, context) => {
    const body = await parseJsonBody(req, CreateDebtFacilityRequestSchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.debt.createFacility(body);
    return ok(parseResponse(result, DebtFacilitySchema), context.requestId, 201);
  });
});

// ─── debt/facilities/:facilityId/schedule ────────────────────────────────────
const ScheduleLineSchema = z.object({
  id: z.string().uuid(),
  debt_facility_id: z.string().uuid(),
  due_date: z.string(),
  principal_due: z.string(),
  interest_due: z.string(),
  status: z.enum(['scheduled', 'paid', 'overdue'])
});

router.register('GET', 'debt/facilities/:facilityId/schedule', async (req, pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = await services.debt.getSchedule(pathParams.facilityId!);
    return ok(parseResponse(result, z.array(ScheduleLineSchema)), context.requestId);
  });
});

// ─── forecasts ────────────────────────────────────────────────────────────────
const ForecastSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string(),
  forecast_type: z.enum(['short_term', 'long_term']),
  start_date: z.string(),
  end_date: z.string(),
  horizon_days: z.number().int().nullable(),
  currency_code: z.string().length(3),
  model_type: z.enum(['statistical', 'ai_hybrid']),
  model_version: z.string(),
  confidence_score: z.string().nullable(),
  status: z.enum(['draft', 'published', 'superseded']),
  scenario_name: z.string(),
  notes: z.string().nullable(),
  generation_status: z.enum(['queued', 'running', 'completed', 'failed']),
  estimated_time_seconds: z.number().int().nullable(),
  accuracy_score: z.string().nullable(),
  accuracy_details: z.record(z.unknown()),
  created_at: z.string(),
  updated_at: z.string()
});

const ListForecastsResponseSchema = z.object({ items: z.array(ForecastSchema), nextCursor: z.string().nullable() });

const ForecastGenerationResponseSchema = z.object({
  forecastId: z.string().uuid(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  estimatedTimeSeconds: z.number().int().positive()
});

router.register('GET', 'forecasts', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const query = parseQuery(req, ListForecastsQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.forecasts.list(
      { type: query.type, status: query.status, generationStatus: query.generationStatus, fromDate: query.fromDate, toDate: query.toDate },
      { cursor: query.cursor, limit: query.limit }
    );
    return ok(parseResponse(result, ListForecastsResponseSchema), context.requestId);
  });
});

router.register('POST', 'forecasts', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'forecasts.create', useIdempotency: true, rateLimit: 'api.sensitive' }, async (_req, context) => {
    const body = await parseJsonBody(req, CreateForecastRequestSchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.forecasts.create(body, context.idempotencyKey!);
    const statusCode = result.status === 'queued' ? 202 : 201;
    return ok(parseResponse(result, ForecastGenerationResponseSchema), context.requestId, statusCode);
  });
});

// ─── forecasts/:forecastId ────────────────────────────────────────────────────
const ForecastLineSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  forecast_id: z.string().uuid(),
  forecast_date: z.string(),
  projected_inflow: z.string(),
  projected_outflow: z.string(),
  projected_net: z.string(),
  cumulative_balance: z.string().nullable(),
  confidence_score: z.string().nullable(),
  key_drivers: z.array(z.string()),
  balance_low: z.string().nullable(),
  balance_high: z.string().nullable(),
  scenario: z.string(),
  created_at: z.string(),
  updated_at: z.string()
});

const ForecastDetailSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string(),
  forecast_type: z.enum(['short_term', 'long_term']),
  start_date: z.string(),
  end_date: z.string(),
  horizon_days: z.number().int().nullable(),
  currency_code: z.string().length(3),
  model_type: z.enum(['statistical', 'ai_hybrid']),
  model_version: z.string(),
  confidence_score: z.string().nullable(),
  status: z.enum(['draft', 'published', 'superseded']),
  scenario_name: z.string(),
  notes: z.string().nullable(),
  base_forecast_id: z.string().uuid().nullable(),
  scenario_parameters: z.record(z.unknown()),
  generation_status: z.enum(['queued', 'running', 'completed', 'failed']),
  generation_job_id: z.string().uuid().nullable(),
  generation_error: z.string().nullable(),
  estimated_time_seconds: z.number().int().nullable(),
  generated_at: z.string().nullable(),
  ai_summary: z.string().nullable(),
  key_risks: z.array(z.string()),
  recommended_actions: z.array(z.string()),
  prompt_context: z.record(z.unknown()),
  few_shot_examples: z.array(z.unknown()),
  accuracy_score: z.string().nullable(),
  accuracy_details: z.record(z.unknown()),
  published_at: z.string().nullable(),
  published_by: z.string().uuid().nullable(),
  created_by: z.string().uuid(),
  created_at: z.string(),
  updated_at: z.string(),
  lines: z.array(ForecastLineSchema)
});

router.register('GET', 'forecasts/:forecastId', async (req, pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const forecast = await services.forecasts.getById(pathParams.forecastId!);
    return ok(parseResponse(forecast, ForecastDetailSchema), context.requestId);
  });
});

// ─── forecasts/:forecastId/publish ────────────────────────────────────────────
const ForecastPublishSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['draft', 'published', 'superseded']),
  generation_status: z.enum(['queued', 'running', 'completed', 'failed']),
  published_at: z.string().nullable()
}).passthrough();

router.register('POST', 'forecasts/:forecastId/publish', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'forecasts.publish' }, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const forecast = await services.forecasts.publish(pathParams.forecastId!);
    return ok(parseResponse(forecast, ForecastPublishSchema), context.requestId);
  });
});

// ─── forecasts/:forecastId/scenario ──────────────────────────────────────────
const ScenarioGenerationResponseSchema = z.object({
  forecastId: z.string().uuid(),
  status: z.enum(['queued', 'running', 'completed', 'failed']),
  estimatedTimeSeconds: z.number().int().positive()
});

router.register('POST', 'forecasts/:forecastId/scenario', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'forecasts.create', useIdempotency: true, rateLimit: 'api.sensitive' }, async (_req, context) => {
    const body = await parseJsonBody(req, GenerateForecastScenarioRequestSchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.forecasts.generateScenario(pathParams.forecastId!, body, context.idempotencyKey!);
    return ok(parseResponse(result, ScenarioGenerationResponseSchema), context.requestId, 201);
  });
});

// ─── fx/exposure ──────────────────────────────────────────────────────────────
const FxExposureResponseSchema = z.object({
  baseCurrency: CurrencyCodeSchema,
  totalExposure: z.string(),
  totalHedgedAmount: z.string(),
  hedgeCoveragePercent: z.string(),
  uncoveredAmount: z.string(),
  currencyBreakdown: z.array(z.object({
    currencyCode: CurrencyCodeSchema,
    exposureAmount: z.string(),
    exposureAmountInBaseCurrency: z.string(),
    hedgedAmountInBaseCurrency: z.string(),
    uncoveredAmountInBaseCurrency: z.string(),
    status: z.enum(['normal', 'warning', 'breached'])
  }))
});

router.register('GET', 'fx/exposure', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = parseResponse(await services.fx.getExposureSummary(), FxExposureResponseSchema);
    return ok(result, context.requestId);
  });
});

// ─── fx/hedges/recommend ─────────────────────────────────────────────────────
const RecommendationRequestSchema = z.object({ exposureId: z.string().uuid() });
const RecommendationSchema = z.object({
  generatedAt: z.string(),
  recommendations: z.array(z.object({
    exposureId: z.string().uuid(),
    instrumentType: z.enum(['forward', 'swap']),
    baseCurrency: CurrencyCodeSchema,
    quoteCurrency: CurrencyCodeSchema,
    recommendedNotional: z.string(),
    currentCoveragePercent: z.string(),
    targetCoveragePercent: z.string(),
    projectedCoveragePercent: z.string(),
    maturityDate: z.string().date(),
    rationale: z.string()
  }))
});

router.register('POST', 'fx/hedges/recommend', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'risk.hedging.recommend' }, async (_req, context) => {
    const body = await parseJsonBody(req, RecommendationRequestSchema);
    const services = buildServices(toServiceContext(context));
    const result = parseResponse(
      { generatedAt: new Date().toISOString(), recommendations: await services.fx.recommendHedges(body.exposureId) },
      RecommendationSchema
    );
    return ok(result, context.requestId);
  });
});

// ─── fx/rates ─────────────────────────────────────────────────────────────────
const RateQuerySchema = z.object({
  base: CurrencyCodeSchema,
  quote: CurrencyCodeSchema.optional(),
  currencies: z.string().optional(),
  asOf: z.string().date().optional()
});

const RateItemSchema = z.object({ quoteCurrency: CurrencyCodeSchema, rate: z.string(), timestamp: z.string(), source: z.string() });
const RateResponseSchema = z.object({ baseCurrency: CurrencyCodeSchema, rates: z.array(RateItemSchema) });

router.register('GET', 'fx/rates', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const query = parseQuery(req, RateQuerySchema);
    const requestedCurrencies = query.currencies
      ? query.currencies.split(',').map((currencyCode) => CurrencyCodeSchema.parse(currencyCode))
      : query.quote
        ? [query.quote]
        : null;
    const services = buildServices(toServiceContext(context));
    const selectedRates = query.asOf && requestedCurrencies
      ? await Promise.all(
          requestedCurrencies.map(async (quoteCurrency) => {
            const rate = await services.fx.getRate({ base: query.base, quote: quoteCurrency, asOf: query.asOf });
            return { quoteCurrency, rate: rate.rate.toFixed(8), timestamp: rate.timestamp, source: rate.source };
          })
        )
      : Object.values(await services.fx.getRates(query.base))
          .filter((rate) => (requestedCurrencies ? requestedCurrencies.includes(rate.quoteCurrency) : true))
          .sort((left, right) => left.quoteCurrency.localeCompare(right.quoteCurrency))
          .map((rate) => ({ quoteCurrency: rate.quoteCurrency, rate: rate.rate.toFixed(8), timestamp: rate.timestamp, source: rate.source }));

    if (requestedCurrencies) {
      const missingCurrencies = requestedCurrencies.filter(
        (currencyCode) => !selectedRates.some((rate) => rate.quoteCurrency === currencyCode)
      );
      if (missingCurrencies.length > 0) {
        throw new z.ZodError([{
          code: z.ZodIssueCode.custom,
          message: `Unsupported quote currencies requested: ${missingCurrencies.join(', ')}`,
          path: ['currencies']
        }]);
      }
    }

    const response = parseResponse({ baseCurrency: query.base, rates: selectedRates }, RateResponseSchema);
    const successResponse = ok(response, context.requestId);
    successResponse.headers.set('Cache-Control', 'public, max-age=3600');
    return successResponse;
  });
});

// ─── integrations/banks ───────────────────────────────────────────────────────
const BankIntegrationSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  provider: z.string(),
  connection_type: z.enum(['open_banking', 'sftp', 'manual_file']),
  status: z.enum(['active', 'degraded', 'disconnected']),
  last_sync_at: z.string().nullable()
});

router.register('GET', 'integrations/banks', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = await services.integrations.listBanks();
    return ok(parseResponse(result, z.array(BankIntegrationSchema)), context.requestId);
  });
});

router.register('POST', 'integrations/banks', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'integrations.manage' }, async (_req, context) => {
    const body = await parseJsonBody(req, CreateBankIntegrationRequestSchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.integrations.createBank(body);
    return ok(parseResponse(result, BankIntegrationSchema), context.requestId, 201);
  });
});

// ─── integrations/banks/:connectionId/sync ───────────────────────────────────
const SyncResponseSchema = z.object({ syncJobId: z.string().uuid() });

router.register('POST', 'integrations/banks/:connectionId/sync', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'integrations.sync' }, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = await services.integrations.triggerBankSync(pathParams.connectionId!);
    return ok(parseResponse(result, SyncResponseSchema), context.requestId, 202);
  });
});

// ─── integrations/sync-jobs ──────────────────────────────────────────────────
const SyncJobSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  integration_type: z.string(),
  direction: z.enum(['import', 'export']),
  status: z.enum(['queued', 'running', 'completed', 'failed', 'partial']),
  created_at: z.string()
});

router.register('GET', 'integrations/sync-jobs', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = await services.integrations.listSyncJobs();
    return ok(parseResponse(result, z.array(SyncJobSchema)), context.requestId);
  });
});

// ─── investments ──────────────────────────────────────────────────────────────
const InvestmentSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  instrument_name: z.string(),
  instrument_type: z.string(),
  principal_amount: z.union([z.string(), z.number()]).transform(String),
  currency_code: z.string().length(3),
  maturity_date: z.string(),
  status: z.enum(['active', 'matured', 'redeemed'])
});

const ListInvestmentsResponseSchema = z.object({ items: z.array(InvestmentSchema), nextCursor: z.string().nullable() });

router.register('GET', 'investments', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const query = parseQuery(req, ListInvestmentsQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.investments.list(
      { status: query.status, maturityFrom: query.maturityFrom, maturityTo: query.maturityTo, instrumentType: query.instrumentType },
      { cursor: query.cursor, limit: query.limit }
    );
    return ok(parseResponse(result, ListInvestmentsResponseSchema), context.requestId);
  });
});

router.register('POST', 'investments', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'investments.create' }, async (_req, context) => {
    const body = await parseJsonBody(req, CreateInvestmentRequestSchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.investments.create(body);
    return ok(parseResponse(result, InvestmentSchema), context.requestId, 201);
  });
});

router.register('GET', 'investments/:investmentId', async (req, pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = await services.investments.getById(pathParams.investmentId!);
    return ok(parseResponse(result, InvestmentSchema), context.requestId);
  });
});

// ─── jobs ─────────────────────────────────────────────────────────────────────
const JobStatusSchema = z.enum(['queued', 'running', 'completed', 'failed', 'retrying']);
const JobSchema = z.object({
  id: z.string().uuid(),
  type: z.string(),
  payload: z.unknown(),
  status: JobStatusSchema,
  attempts: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  lastError: z.string().nullable(),
  scheduledFor: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  organizationId: z.string().uuid(),
  createdAt: z.string()
});

const JobsQuerySchema = z.object({ status: JobStatusSchema.optional(), type: z.string().optional() });

router.register('GET', 'jobs', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'admin.roles.manage' }, async (_req, context) => {
    const query = parseQuery(req, JobsQuerySchema);
    const queue = new JobQueue();
    const jobs = await queue.listJobs(context.organizationId!, query);
    return ok(parseResponse(jobs, z.array(JobSchema)), context.requestId);
  });
});

router.register('GET', 'jobs/:jobId', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'admin.roles.manage' }, async (_req, context) => {
    const queue = new JobQueue();
    const job = await queue.getStatus(pathParams.jobId!);
    if (job.organizationId !== context.organizationId) {
      throw new NotFoundError('Job not found');
    }
    return ok(JobSchema.parse(job), context.requestId);
  });
});

// ─── liquidity/intercompany ───────────────────────────────────────────────────
const ListIntercompanyQuerySchema = z.object({
  status: z.enum(['proposed', 'active', 'settled', 'cancelled']).optional()
});

const IntercompanyLoanSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  lender_entity_id: z.string().uuid(),
  borrower_entity_id: z.string().uuid(),
  amount: z.union([z.string(), z.number()]).transform(String),
  currency_code: z.string().length(3),
  interest_rate: z.string().nullable(),
  status: z.enum(['proposed', 'active', 'settled', 'cancelled']),
  maturity_date: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
  display_status: z.enum(['proposed', 'active', 'settled', 'cancelled', 'overdue']).optional(),
  approval_state: z.enum(['pending_bilateral_approval', 'approved']).optional()
});

router.register('GET', 'liquidity/intercompany', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'liquidity.read' }, async (_req, context) => {
    const query = parseQuery(req, ListIntercompanyQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.listLoans(query.status);
    return ok(parseResponse(result, z.array(IntercompanyLoanSchema)), context.requestId);
  });
});

router.register('POST', 'liquidity/intercompany', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'liquidity.write' }, async (_req, context) => {
    const body = await parseJsonBody(req, CreateIntercompanyLoanInputSchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.createIntercompanyLoan(body);
    return ok(parseResponse(result, IntercompanyLoanSchema), context.requestId, 201);
  });
});

// ─── liquidity/pools ──────────────────────────────────────────────────────────
const PoolSummarySchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string(),
  pool_type: z.enum(['physical', 'notional']),
  base_currency: z.string().length(3),
  created_at: z.string(),
  updated_at: z.string(),
  account_count: z.number().int().nonnegative(),
  active_rule_count: z.number().int().nonnegative(),
  total_balance: z.string(),
  available_balance: z.string(),
  trapped_cash: z.string(),
  last_sweep_at: z.string().nullable()
});

const PoolAccountSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  liquidity_pool_id: z.string().uuid(),
  bank_account_id: z.string().uuid(),
  priority: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
  account_name: z.string().optional(),
  account_number_masked: z.string().optional(),
  currency_code: z.string().optional(),
  country_code: z.string().nullable().optional(),
  status: z.enum(['active', 'dormant', 'closed']).optional(),
  available_balance: z.string().optional(),
  current_balance: z.string().optional(),
  as_of_at: z.string().nullable().optional()
});

const PoolRuleSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  liquidity_pool_id: z.string().uuid(),
  rule_name: z.string(),
  source_account_id: z.string().uuid(),
  target_account_id: z.string().uuid(),
  min_balance: z.string(),
  target_balance: z.string(),
  max_transfer: z.string().nullable(),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  last_executed_at: z.string().nullable().optional()
});

const PoolDetailSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string(),
  pool_type: z.enum(['physical', 'notional']),
  base_currency: z.string().length(3),
  created_at: z.string(),
  updated_at: z.string(),
  accounts: z.array(PoolAccountSchema),
  rules: z.array(PoolRuleSchema),
  summary: PoolSummarySchema
});

router.register('GET', 'liquidity/pools', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'liquidity.read' }, async (_req, context) => {
    const query = parseQuery(req, ListPoolsQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.listPools(query);
    return ok(parseResponse(result, z.array(PoolSummarySchema)), context.requestId);
  });
});

router.register('POST', 'liquidity/pools', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'liquidity.write' }, async (_req, context) => {
    const body = await parseJsonBody(req, CreatePoolInputSchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.createPool(body);
    return ok(parseResponse(result, PoolDetailSchema), context.requestId, 201);
  });
});

router.register('GET', 'liquidity/pools/:poolId', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'liquidity.read' }, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.getPool(pathParams.poolId!);
    return ok(parseResponse(result, PoolDetailSchema), context.requestId);
  });
});

router.register('PATCH', 'liquidity/pools/:poolId', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'liquidity.write' }, async (_req, context) => {
    const body = await parseJsonBody(req, UpdatePoolInputSchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.updatePool(pathParams.poolId!, body);
    return ok(parseResponse(result, PoolDetailSchema), context.requestId);
  });
});

// ─── liquidity/pools/:poolId/sweep ────────────────────────────────────────────
const SweepExecutionResultSchema = z.object({
  rule_id: z.string().uuid(),
  pool_id: z.string().uuid(),
  status: z.enum(['executed', 'skipped']),
  reason: z.string().optional(),
  transfer_amount: z.union([z.string(), z.number()]).transform(String).nullable(),
  source_account_id: z.string().uuid(),
  target_account_id: z.string().uuid(),
  executed_at: z.string()
});

router.register('POST', 'liquidity/pools/:poolId/sweep', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'liquidity.write' }, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.executePoolSweep(pathParams.poolId!);
    return ok(parseResponse(result, z.array(SweepExecutionResultSchema)), context.requestId);
  });
});

// ─── liquidity/position ───────────────────────────────────────────────────────
const ConcentrationBucketSchema = z.object({
  key: z.string(),
  label: z.string(),
  total_balance: z.string(),
  available_balance: z.string().optional(),
  trapped_cash: z.string().optional(),
  operating_cash: z.string().optional(),
  reserve_cash: z.string().optional(),
  concentration_pct: z.string().optional(),
  limit_pct: z.string().optional(),
  breached: z.boolean().optional()
});

const LiquidityPositionSchema = z.object({
  pool_id: z.string().uuid(),
  pool_name: z.string(),
  pool_type: z.enum(['physical', 'notional']),
  base_currency: z.string().length(3),
  total_balance: z.string(),
  available_balance: z.string(),
  trapped_cash: z.string(),
  operating_cash: z.string(),
  reserve_cash: z.string(),
  account_count: z.number().int().nonnegative(),
  active_rule_count: z.number().int().nonnegative(),
  last_sweep_at: z.string().nullable(),
  regions: z.array(z.string())
});

const PositionResponseSchema = z.object({
  generated_at: z.string(),
  total_balance: z.string(),
  available_balance: z.string(),
  trapped_cash: z.string(),
  runway_days: z.number().int().nullable(),
  pools: z.array(LiquidityPositionSchema),
  concentration_analysis: z.object({
    by_region: z.array(ConcentrationBucketSchema),
    by_currency: z.array(ConcentrationBucketSchema),
    by_entity_type: z.array(ConcentrationBucketSchema)
  })
});

router.register('GET', 'liquidity/position', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'liquidity.read' }, async (_req, context) => {
    const query = parseQuery(req, LiquidityPositionQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.getLiquidityPosition(query);
    return ok(parseResponse(result, PositionResponseSchema), context.requestId);
  });
});

// ─── liquidity/rules ──────────────────────────────────────────────────────────
const ListRulesQuerySchema = z.object({ poolId: z.string().uuid().optional() });

const RuleSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  liquidity_pool_id: z.string().uuid(),
  rule_name: z.string(),
  source_account_id: z.string().uuid(),
  target_account_id: z.string().uuid(),
  min_balance: z.string(),
  target_balance: z.string(),
  max_transfer: z.string().nullable(),
  frequency: z.enum(['daily', 'weekly', 'monthly']),
  is_active: z.boolean(),
  created_at: z.string(),
  updated_at: z.string(),
  last_executed_at: z.string().nullable().optional()
});

router.register('GET', 'liquidity/rules', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'liquidity.read' }, async (_req, context) => {
    const query = parseQuery(req, ListRulesQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.listSweepingRules(query.poolId);
    return ok(parseResponse(result, z.array(RuleSchema)), context.requestId);
  });
});

router.register('POST', 'liquidity/rules', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'liquidity.write' }, async (_req, context) => {
    const body = await parseJsonBody(req, CreateSweepingRuleInputSchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.liquidity.createRule(body);
    return ok(parseResponse(result, RuleSchema), context.requestId, 201);
  });
});

// ─── notifications ────────────────────────────────────────────────────────────
router.register('GET', 'notifications', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const query = parseQuery(req, ListNotificationsQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.notifications.list({ isRead: query.isRead, limit: query.limit, cursor: query.cursor });
    return ok(parseResponse(result, NotificationListResponseSchema), context.requestId);
  });
});

router.register('GET', 'notifications/count', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = await services.notifications.getUnreadCount();
    return ok(parseResponse(result, NotificationCountSchema), context.requestId);
  });
});

router.register('POST', 'notifications/read-all', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = await services.notifications.markAllRead();
    return ok(parseResponse(result, NotificationMarkAllReadSchema), context.requestId);
  });
});

router.register('POST', 'notifications/:notificationId/read', async (req, pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = await services.notifications.markRead(pathParams.notificationId!);
    return ok(parseResponse(result, NotificationReadSchema), context.requestId);
  });
});

router.register('POST', 'notifications/:notificationId/unread', async (req, pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const result = await services.notifications.markUnread(pathParams.notificationId!);
    return ok(parseResponse(result, NotificationReadSchema), context.requestId);
  });
});

// ─── payments ─────────────────────────────────────────────────────────────────
const PolicyWarningSchema = z.object({
  policyId: z.string().uuid(),
  policyName: z.string(),
  ruleId: z.string(),
  ruleName: z.string(),
  action: z.enum(['warn', 'require_approval', 'auto_approve']),
  message: z.string()
});

const PaymentListSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  payment_reference: z.string(),
  source_account_id: z.string().uuid(),
  beneficiary_counterparty_id: z.string().uuid(),
  amount: z.union([z.string(), z.number()]).transform(String),
  currency_code: z.string().length(3),
  value_date: z.string(),
  purpose: z.string().nullable(),
  notes: z.string().nullable().optional(),
  status: z.enum(PAYMENT_STATUSES),
  idempotency_key: z.string(),
  request_id: z.string().nullable(),
  created_by: z.string().uuid(),
  approval_workflow_id: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  executed_at: z.string().nullable(),
  failure_reason: z.string().nullable(),
  policy_warnings: z.array(PolicyWarningSchema).optional(),
  version: z.number().int().positive(),
  updated_at: z.string(),
  created_at: z.string()
});

const ListPaymentsResponseSchema = z.object({ items: z.array(PaymentListSchema), nextCursor: z.string().nullable() });

router.register('GET', 'payments', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const query = parseQuery(req, ListPaymentsQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.payments.list(
      { status: query.status, fromDate: query.fromDate, toDate: query.toDate, accountId: query.accountId, minAmount: query.minAmount, maxAmount: query.maxAmount, beneficiaryId: query.beneficiaryId },
      { cursor: query.cursor, limit: query.limit }
    );
    return ok(parseResponse(result, ListPaymentsResponseSchema), context.requestId);
  });
});

router.register('POST', 'payments', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'payments.create', useIdempotency: true, rateLimit: 'api.sensitive' }, async (_req, context) => {
    const body = await parseJsonBody(req, CreatePaymentRequestSchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.payments.create(body, context.user!.id, context.idempotencyKey!);
    return ok(parseResponse(result, PaymentListSchema), context.requestId, 201);
  });
});

// ─── payments/:paymentId ──────────────────────────────────────────────────────
const PaymentApprovalDecisionSchema = z.object({
  approvalStepId: z.string().uuid(),
  approverUserId: z.string().uuid(),
  decision: z.enum(['approved', 'rejected']),
  comment: z.string().nullable(),
  decidedAt: z.string(),
  approver: z.object({ id: z.string().uuid(), displayName: z.string().nullable(), email: z.string().email().nullable().optional() }).nullable()
});

const PaymentApprovalStepSchema = z.object({
  id: z.string().uuid(),
  roleId: z.string().uuid(),
  roleName: z.string(),
  stepOrder: z.number().int().positive(),
  minApprovals: z.number().int().positive(),
  approvalsReceived: z.number().int().nonnegative(),
  status: z.enum(['completed', 'current', 'pending', 'rejected']),
  decisions: z.array(PaymentApprovalDecisionSchema)
});

const PaymentDetailSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  payment_reference: z.string(),
  source_account_id: z.string().uuid(),
  beneficiary_counterparty_id: z.string().uuid(),
  amount: z.union([z.string(), z.number()]).transform(String),
  currency_code: z.string().length(3),
  value_date: z.string(),
  purpose: z.string().nullable(),
  notes: z.string().nullable().optional(),
  status: z.enum(PAYMENT_STATUSES),
  idempotency_key: z.string(),
  request_id: z.string().nullable(),
  created_by: z.string().uuid(),
  approval_workflow_id: z.string().uuid().nullable(),
  approved_at: z.string().nullable(),
  executed_at: z.string().nullable(),
  failure_reason: z.string().nullable(),
  policy_warnings: z.array(PolicyWarningSchema).optional(),
  version: z.number().int().positive(),
  updated_at: z.string(),
  created_at: z.string(),
  beneficiary: z.object({ id: z.string().uuid(), name: z.string(), type: z.enum(['customer', 'vendor', 'bank', 'affiliate', 'other']), countryCode: z.string().nullable(), riskRating: z.string().nullable() }).nullable(),
  submitter: z.object({ id: z.string().uuid(), displayName: z.string().nullable(), email: z.string().email().nullable().optional() }).nullable(),
  approval_chain: z.object({ workflowId: z.string().uuid().nullable(), currentStepId: z.string().uuid().nullable(), alreadyApprovedByCurrentUser: z.boolean(), steps: z.array(PaymentApprovalStepSchema) })
});

router.register('GET', 'payments/:paymentId', async (req, pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const payment = await services.payments.getDetail(pathParams.paymentId!, context.user!.id);
    return ok(parseResponse(payment, PaymentDetailSchema), context.requestId);
  });
});

// ─── payments/:paymentId/cancel ───────────────────────────────────────────────
const PaymentActionSchema = z.object({ id: z.string().uuid(), status: z.enum(PAYMENT_STATUSES), version: z.number().int().positive() }).passthrough();

router.register('POST', 'payments/:paymentId/cancel', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'payments.cancel' }, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const payment = await services.payments.cancel(pathParams.paymentId!);
    return ok(parseResponse(payment, PaymentActionSchema), context.requestId);
  });
});

// ─── payments/:paymentId/retry ────────────────────────────────────────────────
router.register('POST', 'payments/:paymentId/retry', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'payments.retry', useIdempotency: true, rateLimit: 'api.sensitive' }, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const payment = await services.payments.retry(pathParams.paymentId!, context.idempotencyKey!);
    return ok(parseResponse(payment, PaymentActionSchema), context.requestId);
  });
});

// ─── reports/cash-summary ─────────────────────────────────────────────────────
const CashSummaryResponseSchema = z.object({
  generatedAt: z.string(),
  periodStart: z.string(),
  periodEnd: z.string(),
  accounts: z.array(z.object({
    accountId: z.string().uuid(),
    accountName: z.string(),
    accountNumberMasked: z.string(),
    currencyCode: z.string().length(3),
    countryCode: z.string().nullable(),
    openingBalance: z.string(),
    closingBalance: z.string(),
    openingAvailableBalance: z.string(),
    closingAvailableBalance: z.string(),
    netMovement: z.string()
  })),
  netCashFlowByCurrency: z.array(z.object({ currencyCode: z.string().length(3), inflows: z.string(), outflows: z.string(), netCashFlow: z.string() })),
  transactionStatistics: z.array(z.object({ currencyCode: z.string().length(3), transactionCount: z.number().int().nonnegative(), averageTransactionSize: z.string() })),
  topCounterparties: z.array(z.object({
    counterpartyId: z.string(),
    counterpartyName: z.string(),
    rankedVolume: z.string(),
    transactionCount: z.number().int().nonnegative(),
    currencyBreakdown: z.array(z.object({ currencyCode: z.string().length(3), totalVolume: z.string(), transactionCount: z.number().int().nonnegative() }))
  }))
});

router.register('GET', 'reports/cash-summary', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'reports.read' }, async (_req, context) => {
    const query = parseQuery(req, CashSummaryQuerySchema);
    const services = buildServices(toServiceContext(context));
    const report = parseResponse(
      await services.reports.generateCashSummary(context.organizationId!, query.periodStart, query.periodEnd),
      CashSummaryResponseSchema
    );
    await services.reports.logReportDownload({
      action: 'report.cash_summary.view',
      entityType: 'report',
      metadata: { format: query.format, periodStart: query.periodStart, periodEnd: query.periodEnd }
    });
    if (query.format === 'csv') {
      const rows = [
        ...report.accounts.map((account) => ({
          section: 'account_balance', primaryLabel: account.accountName, secondaryLabel: account.accountNumberMasked,
          currencyCode: account.currencyCode, valueA: account.openingBalance, valueB: account.closingBalance,
          valueC: account.netMovement, detail: account.countryCode ?? ''
        })),
        ...report.netCashFlowByCurrency.map((item) => ({
          section: 'net_cash_flow', primaryLabel: item.currencyCode, secondaryLabel: '',
          currencyCode: item.currencyCode, valueA: item.inflows, valueB: item.outflows, valueC: item.netCashFlow, detail: ''
        })),
        ...report.transactionStatistics.map((item) => ({
          section: 'transaction_statistic', primaryLabel: item.currencyCode, secondaryLabel: '',
          currencyCode: item.currencyCode, valueA: String(item.transactionCount), valueB: item.averageTransactionSize, valueC: '', detail: ''
        })),
        ...report.topCounterparties.map((item) => ({
          section: 'top_counterparty', primaryLabel: item.counterpartyName, secondaryLabel: item.counterpartyId,
          currencyCode: item.currencyBreakdown.map((entry) => entry.currencyCode).join('; '),
          valueA: item.rankedVolume, valueB: String(item.transactionCount), valueC: '', detail: JSON.stringify(item.currencyBreakdown)
        }))
      ];
      const columns: ColumnDef[] = [
        { key: 'section', header: 'Section' }, { key: 'primaryLabel', header: 'Primary Label' },
        { key: 'secondaryLabel', header: 'Secondary Label' }, { key: 'currencyCode', header: 'Currency Code' },
        { key: 'valueA', header: 'Value A' }, { key: 'valueB', header: 'Value B' },
        { key: 'valueC', header: 'Value C' }, { key: 'detail', header: 'Detail', type: 'json' }
      ];
      return streamCsv(`cash-summary-${query.periodStart}-${query.periodEnd}.csv`, csvFormatter.format(rows, columns));
    }
    return ok(report, context.requestId);
  });
});

// ─── reports/compliance ───────────────────────────────────────────────────────
const ComplianceReportResponseSchema = z.object({
  reportId: z.string().uuid(),
  jobId: z.string().uuid(),
  reportType: z.enum(['sox_404', 'regulatory', 'audit']),
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.literal('queued'),
  downloadUrl: z.string()
});

const ComplianceReportRecordSchema = z.object({
  id: z.string().uuid(),
  reportType: z.enum(['sox_404', 'regulatory', 'audit']),
  periodStart: z.string(),
  periodEnd: z.string(),
  status: z.enum(['draft', 'generated', 'approved', 'filed']),
  artifactUri: z.string().nullable(),
  downloadUrl: z.string(),
  createdAt: z.string(),
  updatedAt: z.string()
});

router.register('POST', 'reports/compliance', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'reports.generate' }, async (_req, context) => {
    const body = await parseJsonBody(req, GenerateComplianceReportRequestSchema);
    const services = buildServices(toServiceContext(context));
    const result = parseResponse(
      await services.reports.generateComplianceReport(context.organizationId!, body.periodStart, body.periodEnd, body.reportType, body.format),
      ComplianceReportResponseSchema
    );
    return ok(result, context.requestId, 202);
  });
});

router.register('GET', 'reports/compliance', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'reports.read' }, async (_req, context) => {
    const query = parseQuery(req, ComplianceReportListQuerySchema);
    const services = buildServices(toServiceContext(context));
    if (query.downloadId) {
      const report = await services.reports.getComplianceReportDownload(query.downloadId);
      await services.reports.logReportDownload({
        action: 'report.compliance.download',
        entityType: 'compliance_report',
        entityId: query.downloadId,
        metadata: { reportType: report.record.reportType, periodStart: report.record.periodStart, periodEnd: report.record.periodEnd }
      });
      return new NextResponse(JSON.stringify({ data: report.payload }, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="compliance-${report.record.reportType}-${report.record.periodStart}-${report.record.periodEnd}.json"`
        }
      });
    }
    const reports = parseResponse(await services.reports.listComplianceReports(), z.array(ComplianceReportRecordSchema));
    return ok(reports, context.requestId);
  });
});

// ─── reports/liquidity ────────────────────────────────────────────────────────
const LiquidityReportResponseSchema = z.object({
  generatedAt: z.string(),
  asOf: z.string(),
  availableLiquidityByAccount: z.array(z.object({
    accountId: z.string().uuid(), accountName: z.string(), accountNumberMasked: z.string(),
    currencyCode: z.string().length(3), countryCode: z.string().nullable(), region: z.string(),
    availableBalance: z.string(), currentBalance: z.string(), positionTimestamp: z.string().nullable()
  })),
  liquidityPools: z.array(z.object({
    poolId: z.string().uuid(), name: z.string(), poolType: z.string(), baseCurrency: z.string().length(3),
    accountCount: z.number().int().nonnegative(), totalAvailableBalance: z.string(), totalCurrentBalance: z.string(),
    composition: z.array(z.object({ accountId: z.string().uuid(), accountName: z.string(), currencyCode: z.string().length(3), availableBalance: z.string(), currentBalance: z.string() }))
  })),
  runway: z.object({ baseCurrency: z.string().length(3), availableBalance: z.string(), dailyBurnRate: z.string(), daysOfRunway: z.number().nullable() }),
  trappedCashByRegion: z.array(z.object({ region: z.string(), currencyCode: z.string().length(3), reason: z.string(), trappedBalance: z.string() }))
});

router.register('GET', 'reports/liquidity', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'reports.read' }, async (_req, context) => {
    const query = parseQuery(req, LiquidityReportQuerySchema);
    const services = buildServices(toServiceContext(context));
    const report = parseResponse(
      await services.reports.generateLiquidityReport(context.organizationId!, query.asOf),
      LiquidityReportResponseSchema
    );
    await services.reports.logReportDownload({
      action: 'report.liquidity.view', entityType: 'report',
      metadata: { format: query.format, asOf: query.asOf }
    });
    if (query.format === 'csv') {
      const rows = [
        ...report.availableLiquidityByAccount.map((account) => ({
          section: 'available_liquidity', primaryLabel: account.accountName, secondaryLabel: account.accountNumberMasked,
          currencyCode: account.currencyCode, valueA: account.availableBalance, valueB: account.currentBalance,
          valueC: account.region, detail: account.countryCode ?? ''
        })),
        ...report.liquidityPools.map((pool) => ({
          section: 'liquidity_pool', primaryLabel: pool.name, secondaryLabel: pool.poolType,
          currencyCode: pool.baseCurrency, valueA: pool.totalAvailableBalance, valueB: pool.totalCurrentBalance,
          valueC: String(pool.accountCount), detail: JSON.stringify(pool.composition)
        })),
        {
          section: 'runway', primaryLabel: report.runway.baseCurrency, secondaryLabel: 'days_of_runway',
          currencyCode: report.runway.baseCurrency, valueA: report.runway.availableBalance, valueB: report.runway.dailyBurnRate,
          valueC: report.runway.daysOfRunway === null ? '' : String(report.runway.daysOfRunway), detail: ''
        },
        ...report.trappedCashByRegion.map((item) => ({
          section: 'trapped_cash', primaryLabel: item.region, secondaryLabel: item.reason,
          currencyCode: item.currencyCode, valueA: item.trappedBalance, valueB: '', valueC: '', detail: ''
        }))
      ];
      const columns: ColumnDef[] = [
        { key: 'section', header: 'Section' }, { key: 'primaryLabel', header: 'Primary Label' },
        { key: 'secondaryLabel', header: 'Secondary Label' }, { key: 'currencyCode', header: 'Currency Code' },
        { key: 'valueA', header: 'Value A' }, { key: 'valueB', header: 'Value B' },
        { key: 'valueC', header: 'Value C' }, { key: 'detail', header: 'Detail' }
      ];
      return streamCsv(`liquidity-report-${query.asOf}.csv`, csvFormatter.format(rows, columns));
    }
    return ok(report, context.requestId);
  });
});

// ─── risk/alerts ──────────────────────────────────────────────────────────────
const RiskAlertSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  risk_type: z.string(),
  severity: z.enum(['info', 'warning', 'critical']),
  title: z.string(),
  message: z.string(),
  related_entity_type: z.string().nullable(),
  related_entity_id: z.string().uuid().nullable(),
  status: z.enum(['open', 'acknowledged', 'resolved']),
  resolved_at: z.string().nullable(),
  resolved_by: z.string().uuid().nullable(),
  resolution_note: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string()
});

router.register('GET', 'risk/alerts', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const query = parseQuery(req, ListRiskAlertsQuerySchema);
    const services = buildServices(toServiceContext(context));
    const alerts = await services.risk.listAlerts({ status: query.status, severity: query.severity, riskType: query.riskType });
    return ok(parseResponse(alerts, z.array(RiskAlertSchema)), context.requestId);
  });
});

router.register('PATCH', 'risk/alerts/:alertId', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'risk.calculate' }, async (_req, context) => {
    const body = await parseJsonBody(req, UpdateRiskAlertRequestSchema);
    const services = buildServices(toServiceContext(context));
    const alert = body.action === 'acknowledge'
      ? await services.risk.acknowledgeAlert(pathParams.alertId!, body.note)
      : await services.risk.resolveAlert(pathParams.alertId!, body.note);
    return ok(parseResponse(alert, RiskAlertSchema), context.requestId);
  });
});

// ─── risk/exposures ───────────────────────────────────────────────────────────
const RiskStatusSchema = z.enum(['normal', 'warning', 'breached']);
const DecimalSchema = z.string();

const MatrixRowSchema = z.object({
  riskType: z.enum(['fx', 'interest_rate', 'credit', 'liquidity']),
  title: z.string(),
  exposureAmount: DecimalSchema,
  limitAmount: DecimalSchema.nullable(),
  coverageRatio: DecimalSchema.nullable(),
  status: RiskStatusSchema,
  details: z.record(z.string(), z.unknown())
});

const FxExposureDetailSchema = z.object({
  riskType: z.literal('fx'),
  currencyPair: z.string(),
  foreignCurrency: z.string().length(3),
  baseCurrency: z.string().length(3),
  valuationDate: z.string(),
  grossExposureAmount: DecimalSchema,
  netExposureAmount: DecimalSchema,
  hedgedAmount: DecimalSchema,
  unhedgedAmount: DecimalSchema,
  hedgeCoverageRatio: DecimalSchema,
  limitAmount: DecimalSchema.nullable(),
  minimumCoverageRatio: DecimalSchema.nullable(),
  warningThresholdRatio: DecimalSchema,
  status: RiskStatusSchema,
  fxRate: DecimalSchema
});

const ShockScenarioSchema = z.object({
  name: z.enum(['up_100bps', 'up_200bps']),
  rateBps: z.number().int(),
  projectedAnnualImpact: DecimalSchema
});

const InterestRateSchema = z.object({
  riskType: z.literal('interest_rate'),
  valuationDate: z.string(),
  baseCurrency: z.string().length(3),
  floatingDebtAmount: DecimalSchema,
  floatingInvestmentAmount: DecimalSchema,
  netFloatingRateExposure: DecimalSchema,
  limitAmount: DecimalSchema.nullable(),
  warningThresholdRatio: DecimalSchema,
  shockScenarios: z.array(ShockScenarioSchema),
  status: RiskStatusSchema
});

const ConcentrationSchema = z.object({
  riskType: z.literal('credit'),
  counterpartyId: z.string().uuid().nullable(),
  counterpartyName: z.string(),
  valuationDate: z.string(),
  baseCurrency: z.string().length(3),
  exposureAmount: DecimalSchema,
  totalExposureAmount: DecimalSchema,
  concentrationRatio: DecimalSchema,
  limitRatio: DecimalSchema,
  warningThresholdRatio: DecimalSchema,
  status: RiskStatusSchema
});

const LiquidityRiskSchema = z.object({
  riskType: z.literal('liquidity'),
  valuationDate: z.string(),
  baseCurrency: z.string().length(3),
  currentCashBuffer: DecimalSchema,
  baselineMinimumCashBuffer: DecimalSchema,
  stressedMinimumCashBuffer: DecimalSchema,
  minimumPolicyBuffer: DecimalSchema.nullable(),
  inflowStressRatio: DecimalSchema,
  outflowStressRatio: DecimalSchema,
  forecastWindowDays: z.number().int(),
  status: RiskStatusSchema
});

const RiskExposureSnapshotSchema = z.object({
  baseCurrency: z.string().length(3),
  valuationDate: z.string().nullable(),
  lastCalculatedAt: z.string().nullable(),
  summary: z.object({ breached: z.number().int().nonnegative(), warning: z.number().int().nonnegative(), normal: z.number().int().nonnegative() }),
  matrix: z.array(MatrixRowSchema),
  fx: z.array(FxExposureDetailSchema),
  interestRate: InterestRateSchema.nullable(),
  concentration: z.array(ConcentrationSchema),
  liquidity: LiquidityRiskSchema.nullable()
});

router.register('GET', 'risk/exposures', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const query = parseQuery(req, ListRiskExposureQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.risk.listExposures({ riskType: query.riskType, date: query.date, currency: query.currency });
    return ok(parseResponse(result, RiskExposureSnapshotSchema), context.requestId);
  });
});

// ─── risk/exposures/recalculate ───────────────────────────────────────────────
const RecalculateResponseSchema = z.object({ jobId: z.string().uuid() });

router.register('POST', 'risk/exposures/recalculate', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'risk.calculate' }, async (_req, context) => {
    const rawBody = await req.text();
    const parsedBody = rawBody.trim().length > 0 ? JSON.parse(rawBody) : {};
    const body = RecalculateRiskExposureRequestSchema.parse(parsedBody);
    const services = buildServices(toServiceContext(context));
    const result = await services.risk.recalculate(body.referenceDate);
    return ok(parseResponse(result, RecalculateResponseSchema), context.requestId, 202);
  });
});

// ─── transactions ─────────────────────────────────────────────────────────────
const TransactionSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  bank_account_id: z.string().uuid(),
  booking_date: z.string(),
  value_date: z.string().nullable(),
  amount: z.union([z.string(), z.number()]).transform(String),
  currency_code: z.string().length(3),
  direction: z.enum(['inflow', 'outflow']),
  description: z.string().nullable(),
  reconciliation_status: z.enum(['unreconciled', 'partially_reconciled', 'reconciled', 'exception']),
  dedupe_hash: z.string(),
  created_at: z.string(),
  updated_at: z.string()
});

const ListTransactionResponseSchema = z.object({ items: z.array(TransactionSchema), nextCursor: z.string().nullable() });

router.register('GET', 'transactions', async (req, _pathParams) => {
  return executeRoute(req, {}, async (_req, context) => {
    const query = parseQuery(req, ListTransactionsQuerySchema);
    const services = buildServices(toServiceContext(context));
    const result = await services.transactions.list(
      { accountId: query.accountId, direction: query.direction, reconciliationStatus: query.reconciliationStatus, fromDate: query.fromDate, toDate: query.toDate, minAmount: query.minAmount, maxAmount: query.maxAmount },
      { cursor: query.cursor, limit: query.limit }
    );
    return ok(parseResponse(result, ListTransactionResponseSchema), context.requestId);
  });
});

// ─── transactions/:transactionId/reconcile ────────────────────────────────────
router.register('POST', 'transactions/:transactionId/reconcile', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'transactions.reconcile' }, async (_req, context) => {
    await parseJsonBody(req, ReconcileTransactionRequestSchema);
    const services = buildServices(toServiceContext(context));
    const transaction = await services.transactions.reconcile(pathParams.transactionId!);
    return ok(parseResponse(transaction, TransactionSchema), context.requestId);
  });
});

// ─── transactions/import ──────────────────────────────────────────────────────
const ImportResponseSchema = z.object({
  jobId: z.string().uuid(),
  status: z.literal('queued'),
  format: z.enum(['mt940', 'csv', 'ofx'])
});

function parseOptionalJson(value: FormDataEntryValue | null): Record<string, string> | undefined {
  if (!value || typeof value !== 'string' || value.trim().length === 0) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value) as unknown;
  } catch {
    throw new ValidationError('csvColumnMapping must be valid JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ValidationError('csvColumnMapping must be a JSON object');
  }
  return Object.entries(parsed).reduce<Record<string, string>>((result, [key, entryValue]) => {
    if (typeof entryValue === 'string' && entryValue.trim().length > 0) result[key] = entryValue;
    return result;
  }, {});
}

router.register('POST', 'transactions/import', async (req, _pathParams) => {
  return executeRoute(req, { requiredPermission: 'transactions.import' }, async (_req, context) => {
    const formData = await req.formData();
    const file = formData.get('file');
    const bankAccountId = formData.get('bankAccountId');
    if (!(file instanceof File)) throw new ValidationError('A statement file is required');
    if (typeof bankAccountId !== 'string' || bankAccountId.trim().length === 0) throw new ValidationError('bankAccountId is required');
    if (file.size > 50 * 1024 * 1024) throw new ValidationError('Statement file must be 50MB or smaller');
    const fileContent = await file.text();
    const detectedFormat = detectStatementFormat(fileContent, file.name);
    const services = buildServices(toServiceContext(context));
    const account = await services.accounts.getById(bankAccountId);
    if (!account.bank_connection_id) throw new ValidationError('Selected bank account is not linked to a bank connection');
    const importJob = await services.transactions.queueImportUpload({ bankAccountId, sourceFilename: file.name, format: detectedFormat });
    const queue = new JobQueue();
    await queue.enqueue(
      'bank.sync',
      {
        connectionId: account.bank_connection_id,
        organizationId: context.organizationId!,
        importJobId: importJob.importJobId,
        sourceFilename: file.name,
        fileContent,
        format: detectedFormat,
        csvColumnMapping: parseOptionalJson(formData.get('csvColumnMapping')),
        initiatedByUserId: context.user!.id
      },
      { organizationId: context.organizationId!, maxAttempts: 4 }
    );
    return ok(
      parseResponse({ jobId: importJob.importJobId, status: 'queued', format: detectedFormat }, ImportResponseSchema),
      context.requestId,
      202
    );
  });
});

// ─── transactions/import/:jobId/status ────────────────────────────────────────
const ImportStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['queued', 'running', 'partial', 'completed', 'failed']),
  total: z.number().int().nonnegative(),
  imported: z.number().int().nonnegative(),
  duplicates: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  errorReport: z.unknown().optional()
});

router.register('GET', 'transactions/import/:jobId/status', async (req, pathParams) => {
  return executeRoute(req, { requiredPermission: 'transactions.import' }, async (_req, context) => {
    const services = buildServices(toServiceContext(context));
    const status = await services.transactions.getImportStatus(pathParams.jobId!);
    return ok(
      parseResponse(
        {
          id: status.id,
          status: status.status,
          total: Number(status.total_records ?? 0),
          imported: Number(status.imported_count ?? 0),
          duplicates: Number(status.duplicate_count ?? 0),
          errors: Number(status.error_count ?? 0),
          warnings: Number(status.warning_count ?? 0),
          errorReport: (status.result_summary as Record<string, unknown> | null) ?? undefined
        },
        ImportStatusSchema
      ),
      context.requestId
    );
  });
});

// ─── OPTIONS catch-all ────────────────────────────────────────────────────────
// Register OPTIONS for all routes by using the buildOptionsHandler factory
const optionsHandler = buildOptionsHandler();
router.register('OPTIONS', '*', async (req, _pathParams) => {
  return optionsHandler(req);
});

// Override dispatch to handle OPTIONS wildcard
const originalDispatch = router.dispatch.bind(router);
router.dispatch = async function(method: string, segments: string[], req: NextRequest): Promise<Response> {
  if (method === 'OPTIONS') {
    return optionsHandler(req);
  }
  return originalDispatch(method, segments, req);
};

export { router };
