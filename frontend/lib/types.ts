export interface ApiMeta {
  requestId: string;
  timestamp: string;
}

export interface ApiSuccess<T> {
  data: T;
  meta: ApiMeta;
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
  meta: ApiMeta;
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
}

export interface Account {
  id: string;
  organization_id: string;
  bank_connection_id: string | null;
  account_name: string;
  account_number_masked: string;
  currency_code: string;
  region: string | null;
  liquidity_type: 'operating' | 'reserve';
  withdrawal_restricted: boolean;
  current_balance?: string;
  available_balance?: string;
  restricted_balance?: string;
  reconciliation_status?: 'reconciled' | 'attention' | 'no_activity';
  status: 'active' | 'dormant' | 'closed';
  created_at: string;
  updated_at: string;
}

export interface Counterparty {
  id: string;
  organization_id: string;
  name: string;
  type: 'customer' | 'vendor' | 'bank' | 'affiliate' | 'other';
  country_code: string | null;
  risk_rating: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: string;
  organization_id: string;
  payment_reference: string;
  source_account_id: string;
  beneficiary_counterparty_id: string;
  amount: string;
  currency_code: string;
  value_date: string;
  purpose: string | null;
  notes?: string | null;
  status: 'draft' | 'pending_approval' | 'approved' | 'rejected' | 'sent' | 'settled' | 'failed' | 'cancelled';
  idempotency_key: string;
  request_id: string | null;
  created_by: string;
  approval_workflow_id: string | null;
  approved_at: string | null;
  executed_at: string | null;
  failure_reason: string | null;
  policy_warnings?: PolicyWarning[];
  version: number;
  updated_at: string;
  created_at: string;
}

export interface PaymentApprovalDecision {
  approvalStepId: string;
  approverUserId: string;
  decision: 'approved' | 'rejected';
  comment: string | null;
  decidedAt: string;
  approver: {
    id: string;
    displayName: string | null;
    email?: string | null;
  } | null;
}

export interface PaymentApprovalStep {
  id: string;
  roleId: string;
  roleName: string;
  stepOrder: number;
  minApprovals: number;
  approvalsReceived: number;
  status: 'completed' | 'current' | 'pending' | 'rejected';
  decisions: PaymentApprovalDecision[];
}

export interface PaymentDetail extends Payment {
  beneficiary: {
    id: string;
    name: string;
    type: Counterparty['type'];
    countryCode: string | null;
    riskRating: string | null;
  } | null;
  submitter: {
    id: string;
    displayName: string | null;
    email?: string | null;
  } | null;
  approval_chain: {
    workflowId: string | null;
    currentStepId: string | null;
    alreadyApprovedByCurrentUser: boolean;
    steps: PaymentApprovalStep[];
  };
}

export type PolicyDomain = 'payment' | 'investment' | 'forex' | 'liquidity';
export type PolicyAction = 'block' | 'warn' | 'require_approval' | 'auto_approve';

export type PolicyCondition =
  | { type: 'amount_exceeds'; threshold: string; currency: string }
  | { type: 'counterparty_concentration'; maxPercentage: number }
  | { type: 'payment_to_restricted_country'; countries: string[] }
  | { type: 'fx_exposure_exceeds'; percentage: number; currency: string }
  | { type: 'balance_below_minimum'; threshold: string; accountId?: string }
  | { type: 'covenant_ratio_breached'; facilityId: string; ratio: string }
  | { type: 'and'; conditions: PolicyCondition[] }
  | { type: 'or'; conditions: PolicyCondition[] };

export interface PolicyRule {
  id: string;
  name: string;
  condition: PolicyCondition;
  action: PolicyAction;
  message: string;
}

export interface PolicyWarning {
  policyId: string;
  policyName: string;
  ruleId: string;
  ruleName: string;
  action: 'warn' | 'require_approval' | 'auto_approve';
  message: string;
}

export interface PolicyViolation {
  policyId: string;
  policyName: string;
  ruleId: string;
  ruleName: string;
  action: 'block';
  message: string;
}

export interface AdminPolicy {
  id: string;
  name: string;
  domain: PolicyDomain;
  version: number;
  rules: PolicyRule[];
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AuthProfile {
  user: {
    id: string;
    email: string;
  };
  memberships: Array<{
    organizationId: string;
    roleId: string;
    status: string;
  }>;
  permissions: Record<string, string[]>;
}

export interface Notification {
  id: string;
  organization_id: string;
  user_id: string | null;
  type: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  title: string;
  body: string;
  action_url: string | null;
  action_label: string | null;
  related_entity_type: string | null;
  related_entity_id: string | null;
  is_read: boolean;
  read_at: string | null;
  created_at: string;
}

export interface NotificationReadResult {
  notificationId: string;
  read: boolean;
}

export interface NotificationCount {
  unread: number;
}

export interface NotificationMarkAllReadResult {
  updated: number;
}

export type ComplianceReportType = 'sox_404' | 'regulatory' | 'audit';

export interface CashSummaryAccountBalance {
  accountId: string;
  accountName: string;
  accountNumberMasked: string;
  currencyCode: string;
  countryCode: string | null;
  openingBalance: string;
  closingBalance: string;
  openingAvailableBalance: string;
  closingAvailableBalance: string;
  netMovement: string;
}

export interface CashSummaryFlow {
  currencyCode: string;
  inflows: string;
  outflows: string;
  netCashFlow: string;
}

export interface CashSummaryStatistic {
  currencyCode: string;
  transactionCount: number;
  averageTransactionSize: string;
}

export interface CashSummaryCounterparty {
  counterpartyId: string;
  counterpartyName: string;
  rankedVolume: string;
  transactionCount: number;
  currencyBreakdown: Array<{
    currencyCode: string;
    totalVolume: string;
    transactionCount: number;
  }>;
}

export interface CashSummaryReport {
  generatedAt: string;
  periodStart: string;
  periodEnd: string;
  accounts: CashSummaryAccountBalance[];
  netCashFlowByCurrency: CashSummaryFlow[];
  transactionStatistics: CashSummaryStatistic[];
  topCounterparties: CashSummaryCounterparty[];
}

export interface LiquidityReport {
  generatedAt: string;
  asOf: string;
  availableLiquidityByAccount: Array<{
    accountId: string;
    accountName: string;
    accountNumberMasked: string;
    currencyCode: string;
    countryCode: string | null;
    region: string;
    availableBalance: string;
    currentBalance: string;
    positionTimestamp: string | null;
  }>;
  liquidityPools: Array<{
    poolId: string;
    name: string;
    poolType: string;
    baseCurrency: string;
    accountCount: number;
    totalAvailableBalance: string;
    totalCurrentBalance: string;
    composition: Array<{
      accountId: string;
      accountName: string;
      currencyCode: string;
      availableBalance: string;
      currentBalance: string;
    }>;
  }>;
  runway: {
    baseCurrency: string;
    availableBalance: string;
    dailyBurnRate: string;
    daysOfRunway: number | null;
  };
  trappedCashByRegion: Array<{
    region: string;
    currencyCode: string;
    reason: string;
    trappedBalance: string;
  }>;
}

export interface LiquidityPoolSummary {
  id: string;
  organization_id: string;
  name: string;
  pool_type: 'physical' | 'notional';
  base_currency: string;
  created_at: string;
  updated_at: string;
  account_count: number;
  active_rule_count: number;
  total_balance: string;
  available_balance: string;
  trapped_cash: string;
  last_sweep_at: string | null;
}

export interface LiquidityPoolAccount {
  id: string;
  organization_id: string;
  liquidity_pool_id: string;
  bank_account_id: string;
  priority: number;
  created_at: string;
  updated_at: string;
  account_name?: string;
  account_number_masked?: string;
  currency_code?: string;
  country_code?: string | null;
  status?: 'active' | 'dormant' | 'closed';
  available_balance?: string;
  current_balance?: string;
  as_of_at?: string | null;
}

export interface SweepingRule {
  id: string;
  organization_id: string;
  liquidity_pool_id: string;
  rule_name: string;
  source_account_id: string;
  target_account_id: string;
  min_balance: string;
  target_balance: string;
  max_transfer: string | null;
  frequency: 'daily' | 'weekly' | 'monthly';
  is_active: boolean;
  created_at: string;
  updated_at: string;
  last_executed_at?: string | null;
}

export interface LiquidityPoolDetail {
  id: string;
  organization_id: string;
  name: string;
  pool_type: 'physical' | 'notional';
  base_currency: string;
  created_at: string;
  updated_at: string;
  accounts: LiquidityPoolAccount[];
  rules: SweepingRule[];
  summary: LiquidityPoolSummary;
}

export interface LiquidityPosition {
  pool_id: string;
  pool_name: string;
  pool_type: 'physical' | 'notional';
  base_currency: string;
  total_balance: string;
  available_balance: string;
  trapped_cash: string;
  operating_cash: string;
  reserve_cash: string;
  account_count: number;
  active_rule_count: number;
  last_sweep_at: string | null;
  regions: string[];
}

export interface LiquidityConcentrationBucket {
  key: string;
  label: string;
  total_balance: string;
  available_balance?: string;
  trapped_cash?: string;
  operating_cash?: string;
  reserve_cash?: string;
  concentration_pct?: string;
  limit_pct?: string;
  breached?: boolean;
}

export interface LiquidityPositionResponse {
  generated_at: string;
  total_balance: string;
  available_balance: string;
  trapped_cash: string;
  runway_days: number | null;
  pools: LiquidityPosition[];
  concentration_analysis: {
    by_region: LiquidityConcentrationBucket[];
    by_currency: LiquidityConcentrationBucket[];
    by_entity_type: LiquidityConcentrationBucket[];
  };
}

export interface SweepExecutionResult {
  rule_id: string;
  pool_id: string;
  status: 'executed' | 'skipped';
  reason?: string;
  transfer_amount: string | null;
  source_account_id: string;
  target_account_id: string;
  executed_at: string;
}

export interface IntercompanyLoan {
  id: string;
  organization_id: string;
  lender_entity_id: string;
  borrower_entity_id: string;
  amount: string;
  currency_code: string;
  interest_rate: string | null;
  status: 'proposed' | 'active' | 'settled' | 'cancelled';
  maturity_date: string | null;
  created_at: string;
  updated_at: string;
  display_status?: 'proposed' | 'active' | 'settled' | 'cancelled' | 'overdue';
  approval_state?: 'pending_bilateral_approval' | 'approved';
}

export interface ComplianceReportArchiveItem {
  id: string;
  reportType: ComplianceReportType;
  periodStart: string;
  periodEnd: string;
  status: 'draft' | 'generated' | 'approved' | 'filed';
  artifactUri: string | null;
  downloadUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface ComplianceReportJobResponse {
  jobId: string;
}

export interface AuditLogRecord {
  id: string;
  userId: string | null;
  userEmail: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  previousState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  requestId: string | null;
  createdAt: string;
}

export interface AuditLogPage {
  items: AuditLogRecord[];
  nextCursor: string | null;
}

export interface AdminUser {
  id: string;
  name: string | null;
  email: string;
  role: string;
  status: 'active' | 'invited' | 'revoked';
  lastLogin: string | null;
  mfaEnabled: boolean;
}

export interface AdminRole {
  id: string;
  name: string;
  isSystem: boolean;
  permissionCount: number;
  permissions: string[];
}

export interface TreasuryPolicy {
  id: string;
  name: string;
  domain: PolicyDomain;
  version: number;
  rules: PolicyRule[];
  isActive: boolean;
  effectiveFrom: string;
  effectiveTo: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Transaction {
  id: string;
  organization_id: string;
  bank_account_id: string;
  booking_date: string;
  value_date: string | null;
  amount: string;
  currency_code: string;
  direction: 'inflow' | 'outflow';
  description: string | null;
  reconciliation_status: 'unreconciled' | 'partially_reconciled' | 'reconciled' | 'exception';
  dedupe_hash: string;
  created_at: string;
  updated_at: string;
}

export interface TransactionImportStartResponse {
  jobId: string;
  status: 'queued';
  format: 'mt940' | 'csv' | 'ofx';
}

export interface TransactionImportStatus {
  id: string;
  status: 'queued' | 'running' | 'partial' | 'completed' | 'failed';
  total: number;
  imported: number;
  duplicates: number;
  errors: number;
  warnings: number;
  errorReport?: Record<string, unknown>;
}

export interface CashTrendPoint {
  date?: string;
  label: string;
  value: string;
  projected: string;
  buffer: string;
}

export interface RegionalBreakdown {
  region: string;
  operating: string;
  reserve: string;
  trapped: string;
}

export interface PaymentVolumePoint {
  label: string;
  urgent: number;
  scheduled: number;
}

export interface CashPositionSummary {
  totalCash: string;
  availableLiquidity: string;
  pendingPayments: {
    amount: string;
    count: number;
  };
  riskLimitsInWatch: number;
  baseCurrency: string;
  asOf: string;
  byRegion: RegionalBreakdown[];
  trend: Array<Pick<CashTrendPoint, 'label' | 'value' | 'projected' | 'buffer'>>;
  paymentVolume: PaymentVolumePoint[];
}

export interface PendingApproval {
  id: string;
  counterparty: string;
  amount: string;
  currencyCode: string;
  dueInDays: number;
  approversRemaining: number;
}

export interface UpcomingPayment {
  id: string;
  paymentReference: string;
  counterparty: string;
  amount: string;
  currencyCode: string;
  valueDate: string;
  status: string;
}

export interface RiskExposureItem {
  label: string;
  amount: string;
  currencyCode: string;
  coverage: number;
  policy: string;
  severity: 'low' | 'moderate' | 'high';
}

export type RiskStatus = 'normal' | 'warning' | 'breached';
export type RiskAlertSeverity = 'info' | 'warning' | 'critical';
export type RiskAlertStatus = 'open' | 'acknowledged' | 'resolved';

export interface RiskExposureMatrixRow {
  riskType: 'fx' | 'interest_rate' | 'credit' | 'liquidity';
  title: string;
  exposureAmount: string;
  limitAmount: string | null;
  coverageRatio: string | null;
  status: RiskStatus;
  details: Record<string, unknown>;
}

export interface FxExposureSummary {
  riskType: 'fx';
  currencyPair: string;
  foreignCurrency: string;
  baseCurrency: string;
  valuationDate: string;
  grossExposureAmount: string;
  netExposureAmount: string;
  hedgedAmount: string;
  unhedgedAmount: string;
  hedgeCoverageRatio: string;
  limitAmount: string | null;
  minimumCoverageRatio: string | null;
  warningThresholdRatio: string;
  status: RiskStatus;
  fxRate: string;
}

export interface InterestRateShockScenario {
  name: 'up_100bps' | 'up_200bps';
  rateBps: number;
  projectedAnnualImpact: string;
}

export interface IrExposureSummary {
  riskType: 'interest_rate';
  valuationDate: string;
  baseCurrency: string;
  floatingDebtAmount: string;
  floatingInvestmentAmount: string;
  netFloatingRateExposure: string;
  limitAmount: string | null;
  warningThresholdRatio: string;
  shockScenarios: InterestRateShockScenario[];
  status: RiskStatus;
}

export interface ConcentrationRisk {
  riskType: 'credit';
  counterpartyId: string | null;
  counterpartyName: string;
  valuationDate: string;
  baseCurrency: string;
  exposureAmount: string;
  totalExposureAmount: string;
  concentrationRatio: string;
  limitRatio: string;
  warningThresholdRatio: string;
  status: RiskStatus;
}

export interface LiquidityStressResult {
  riskType: 'liquidity';
  valuationDate: string;
  baseCurrency: string;
  currentCashBuffer: string;
  baselineMinimumCashBuffer: string;
  stressedMinimumCashBuffer: string;
  minimumPolicyBuffer: string | null;
  inflowStressRatio: string;
  outflowStressRatio: string;
  forecastWindowDays: number;
  status: RiskStatus;
}

export interface RiskExposureSnapshot {
  baseCurrency: string;
  valuationDate: string | null;
  lastCalculatedAt: string | null;
  summary: {
    breached: number;
    warning: number;
    normal: number;
  };
  matrix: RiskExposureMatrixRow[];
  fx: FxExposureSummary[];
  interestRate: IrExposureSummary | null;
  concentration: ConcentrationRisk[];
  liquidity: LiquidityStressResult | null;
}

export interface RiskAlert {
  id: string;
  organization_id: string;
  risk_type: string;
  severity: RiskAlertSeverity;
  title: string;
  message: string;
  related_entity_type: string | null;
  related_entity_id: string | null;
  status: RiskAlertStatus;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
}

export interface ForecastScenario {
  name: string;
  confidence: string;
  runway: string;
  commentary: string;
}

export type ForecastGenerationStatus = 'queued' | 'running' | 'completed' | 'failed';

export interface ForecastListItem {
  id: string;
  organization_id: string;
  name: string;
  forecast_type: 'short_term' | 'long_term';
  start_date: string;
  end_date: string;
  horizon_days: number | null;
  currency_code: string;
  model_type: 'statistical' | 'ai_hybrid';
  model_version: string;
  confidence_score: string | null;
  status: 'draft' | 'published' | 'superseded';
  scenario_name: string;
  notes: string | null;
  generation_status: ForecastGenerationStatus;
  estimated_time_seconds: number | null;
  accuracy_score: string | null;
  accuracy_details: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface ForecastLine {
  id: string;
  organization_id: string;
  forecast_id: string;
  forecast_date: string;
  projected_inflow: string;
  projected_outflow: string;
  projected_net: string;
  cumulative_balance: string | null;
  confidence_score: string | null;
  key_drivers: string[];
  balance_low: string | null;
  balance_high: string | null;
  scenario: string;
  created_at: string;
  updated_at: string;
}

export interface ForecastDetail extends ForecastListItem {
  base_forecast_id: string | null;
  scenario_parameters: Record<string, unknown>;
  generation_job_id: string | null;
  generation_error: string | null;
  generated_at: string | null;
  ai_summary: string | null;
  key_risks: string[];
  recommended_actions: string[];
  prompt_context: Record<string, unknown>;
  few_shot_examples: unknown[];
  accuracy_details: Record<string, unknown>;
  published_at: string | null;
  published_by: string | null;
  created_by: string;
  lines: ForecastLine[];
}

export interface ForecastGenerationResponse {
  forecastId: string;
  status: ForecastGenerationStatus;
  estimatedTimeSeconds: number;
}

export interface ForecastCreateInput {
  forecastType: 'short_term' | 'long_term';
  horizon: number;
  currencyCode: string;
  scenarioName?: string;
  notes?: string;
  idempotencyKey: string;
}

export interface ForecastScenarioInput {
  inflow_change_pct: number;
  outflow_change_pct: number;
  scenario_name: string;
  idempotencyKey: string;
}

export interface ForecastAccuracyMetric {
  forecastId: string;
  forecastDate: string;
  horizonDays: number;
  scenarioName: string;
  forecastType: 'short_term' | 'long_term';
  accuracyScore: string | null;
  mapePct: string | null;
  generationStatus: ForecastGenerationStatus;
}

export interface InvestmentHolding {
  instrument: string;
  issuer: string;
  amount: string;
  currencyCode: string;
  maturityDate: string;
  yield: number;
}

export interface ReportItem {
  title: string;
  owner: string;
  updatedAt: string;
  cadence: string;
  status: string;
}

export interface CopilotTokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  estimatedCostUsd: string;
}

export interface CopilotToolAudit {
  tool:
    | 'get_cash_position'
    | 'get_fx_rates'
    | 'list_pending_approvals'
    | 'get_risk_summary'
    | 'get_liquidity_forecast'
    | 'get_account_transactions'
    | 'get_investment_summary'
    | 'get_debt_summary';
  input: Record<string, unknown>;
  executedAt: string;
  source: string;
  timestamp: string | null;
}

export interface CopilotMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  metadata?: {
    inReplyToId?: string;
    toolCalls?: CopilotToolAudit[];
    usage?: CopilotTokenUsage;
  };
}

export interface CopilotSessionSummary {
  id: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview: string | null;
  tokenUsage: CopilotTokenUsage;
}

export interface CopilotSession {
  id: string;
  organizationId: string;
  userId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
  tokenUsage: CopilotTokenUsage;
  messages: CopilotMessage[];
}
