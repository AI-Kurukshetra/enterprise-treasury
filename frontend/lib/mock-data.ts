import type {
  Account,
  CashTrendPoint,
  ForecastScenario,
  InvestmentHolding,
  PaginatedResponse,
  Payment,
  PaymentVolumePoint,
  PendingApproval,
  ReportItem,
  RiskExposureItem,
  Transaction,
  UpcomingPayment
} from '@/lib/types';

export const landingMetrics = [
  { label: 'Global cash visibility', value: '$14.8B' },
  { label: 'Connected bank accounts', value: '1,284' },
  { label: 'Daily payment volume', value: '$2.1B' },
  { label: 'Policy breaches auto-triaged', value: '96.4%' }
];

export const landingCapabilities = [
  {
    title: 'Unified treasury control plane',
    description:
      'Centralize balances, exposures, approvals, and liquidity actions across entities without forcing teams into spreadsheet reconciliation.'
  },
  {
    title: 'Liquidity orchestration',
    description:
      'Surface trapped cash, funding gaps, and pooling opportunities with region-aware rules built for operating treasuries, not generic BI.'
  },
  {
    title: 'Board-grade risk telemetry',
    description:
      'Track counterparty, FX, and short-term funding exposure with policy-linked narratives treasury leadership can act on immediately.'
  }
];

export const landingSections = {
  overview: [
    'Multi-entity visibility down to account and currency level.',
    'Operational drilldowns for cash concentration, intercompany movement, and payment approvals.',
    'Analytic surfaces tuned for treasury teams managing high-volume, high-value workflows.'
  ],
  treasuryCapabilities: [
    'Cash positioning and intraday balance surveillance',
    'Approval-aware payment operations',
    'Scenario-based forecasting and liquidity runway analysis',
    'Risk policy monitoring with exception queues'
  ],
  liquidityAnalytics: [
    'Working capital lockup by region',
    'Operating vs reserve cash segmentation',
    'Shortfall early-warning models'
  ],
  riskManagement: [
    'Counterparty concentration bands',
    'FX hedge coverage by reporting currency',
    'Interest-rate and covenant watchlists'
  ]
};

export const dashboardMetrics = [
  {
    title: 'Global cash position',
    value: '$14.82B',
    delta: '+3.4%',
    hint: 'versus prior close'
  },
  {
    title: 'Available liquidity',
    value: '$6.94B',
    delta: '+1.2%',
    hint: 'cash plus committed lines'
  },
  {
    title: 'Payments awaiting release',
    value: '$428M',
    delta: '37 items',
    hint: 'across 12 entities'
  },
  {
    title: 'Risk limits in watch state',
    value: '4',
    delta: '-2',
    hint: 'all within policy buffer'
  }
];

export const cashTrendData: Array<Pick<CashTrendPoint, 'label'> & { value: number; projected: number; buffer: number }> = [
  { label: 'Mon', value: 13.4, projected: 13.8, buffer: 12.6 },
  { label: 'Tue', value: 13.7, projected: 14.0, buffer: 12.7 },
  { label: 'Wed', value: 14.1, projected: 14.3, buffer: 12.8 },
  { label: 'Thu', value: 14.4, projected: 14.6, buffer: 12.9 },
  { label: 'Fri', value: 14.8, projected: 14.9, buffer: 13.1 },
  { label: 'Sat', value: 14.6, projected: 14.7, buffer: 13.1 },
  { label: 'Sun', value: 14.9, projected: 15.1, buffer: 13.2 }
];

export const liquidityMixData: Array<{ label: string; operating: number; reserve: number; trapped: number }> = [
  { label: 'Americas', operating: 2.8, reserve: 1.6, trapped: 0.3 },
  { label: 'EMEA', operating: 2.3, reserve: 1.1, trapped: 0.5 },
  { label: 'APAC', operating: 1.9, reserve: 0.8, trapped: 0.6 },
  { label: 'LATAM', operating: 0.6, reserve: 0.2, trapped: 0.2 }
];

export const paymentVolumeData: PaymentVolumePoint[] = [
  { label: 'Mon', urgent: 124, scheduled: 380 },
  { label: 'Tue', urgent: 118, scheduled: 392 },
  { label: 'Wed', urgent: 141, scheduled: 405 },
  { label: 'Thu', urgent: 155, scheduled: 421 },
  { label: 'Fri', urgent: 162, scheduled: 446 }
];

export const pendingApprovals: PendingApproval[] = [
  {
    id: 'apr-101',
    counterparty: 'Global Components GmbH',
    amount: '12500000',
    currencyCode: 'EUR',
    dueInDays: 0,
    approversRemaining: 1
  },
  {
    id: 'apr-102',
    counterparty: 'NorthSea Logistics',
    amount: '8400000',
    currencyCode: 'USD',
    dueInDays: 1,
    approversRemaining: 2
  },
  {
    id: 'apr-103',
    counterparty: 'Kyoto Precision Works',
    amount: '3900000',
    currencyCode: 'JPY',
    dueInDays: 2,
    approversRemaining: 1
  }
];

export const upcomingPayments: UpcomingPayment[] = [
  {
    id: 'pay-up-1',
    paymentReference: 'PAY-20491',
    counterparty: 'Sierra Semiconductors',
    amount: '18600000',
    currencyCode: 'USD',
    valueDate: '2026-03-16',
    status: 'Pending approval'
  },
  {
    id: 'pay-up-2',
    paymentReference: 'PAY-20477',
    counterparty: 'Atlantic Fuel Partners',
    amount: '9100000',
    currencyCode: 'GBP',
    valueDate: '2026-03-17',
    status: 'Queued'
  },
  {
    id: 'pay-up-3',
    paymentReference: 'PAY-20451',
    counterparty: 'Mendoza Packaging',
    amount: '6200000',
    currencyCode: 'USD',
    valueDate: '2026-03-19',
    status: 'Scheduled'
  }
];

export const riskExposureItems: RiskExposureItem[] = [
  {
    label: 'EUR translation exposure',
    amount: '278000000',
    currencyCode: 'USD',
    coverage: 0.72,
    policy: '75% target hedge',
    severity: 'moderate'
  },
  {
    label: 'JPY procurement exposure',
    amount: '118000000',
    currencyCode: 'USD',
    coverage: 0.61,
    policy: '60% minimum',
    severity: 'low'
  },
  {
    label: 'Counterparty concentration',
    amount: '342000000',
    currencyCode: 'USD',
    coverage: 0.42,
    policy: '40% unsecured cap',
    severity: 'high'
  }
];

export const forecastScenarios: ForecastScenario[] = [
  {
    name: 'Base operating view',
    confidence: '88%',
    runway: '142 days',
    commentary: 'Collections remain stable; EMEA tax outflow lands in week three.'
  },
  {
    name: 'Stressed receivables',
    confidence: '76%',
    runway: '111 days',
    commentary: 'Customer deferrals push minimum cash buffer close to policy floor.'
  },
  {
    name: 'Expansion case',
    confidence: '81%',
    runway: '134 days',
    commentary: 'Capex peaks in April but debt capacity remains comfortably open.'
  }
];

export const investmentHoldings: InvestmentHolding[] = [
  {
    instrument: 'AAA Institutional MMF',
    issuer: 'Harbor Treasury',
    amount: '480000000',
    currencyCode: 'USD',
    maturityDate: '2026-03-18',
    yield: 0.049
  },
  {
    instrument: 'Commercial Paper',
    issuer: 'Delta Utilities',
    amount: '220000000',
    currencyCode: 'USD',
    maturityDate: '2026-04-02',
    yield: 0.053
  },
  {
    instrument: 'Time Deposit',
    issuer: 'Northern Bank PLC',
    amount: '180000000',
    currencyCode: 'EUR',
    maturityDate: '2026-04-14',
    yield: 0.037
  }
];

export const reportItems: ReportItem[] = [
  {
    title: 'Daily cash concentration summary',
    owner: 'Treasury Operations',
    updatedAt: '2026-03-14',
    cadence: 'Daily',
    status: 'Ready'
  },
  {
    title: 'Liquidity committee pack',
    owner: 'Corporate Treasury',
    updatedAt: '2026-03-13',
    cadence: 'Weekly',
    status: 'In review'
  },
  {
    title: 'Counterparty risk certification',
    owner: 'Risk Control',
    updatedAt: '2026-03-12',
    cadence: 'Monthly',
    status: 'Draft'
  }
];

export const mockAccountsResponse: PaginatedResponse<Account> = {
  items: [
    {
      id: 'acc-usd-001',
      organization_id: 'org-001',
      bank_connection_id: 'bank-001',
      account_name: 'US Operating Master',
      account_number_masked: '****1184',
      currency_code: 'USD',
      region: 'Americas',
      liquidity_type: 'operating',
      withdrawal_restricted: false,
      status: 'active',
      created_at: '2026-01-01T09:00:00Z',
      updated_at: '2026-03-14T06:10:00Z'
    },
    {
      id: 'acc-eur-002',
      organization_id: 'org-001',
      bank_connection_id: 'bank-002',
      account_name: 'EMEA Collections Hub',
      account_number_masked: '****7715',
      currency_code: 'EUR',
      region: 'EMEA',
      liquidity_type: 'operating',
      withdrawal_restricted: false,
      status: 'active',
      created_at: '2026-01-03T09:00:00Z',
      updated_at: '2026-03-14T05:10:00Z'
    },
    {
      id: 'acc-jpy-003',
      organization_id: 'org-001',
      bank_connection_id: 'bank-003',
      account_name: 'APAC Supplier Clearing',
      account_number_masked: '****4402',
      currency_code: 'JPY',
      region: 'APAC',
      liquidity_type: 'operating',
      withdrawal_restricted: false,
      status: 'dormant',
      created_at: '2026-01-07T09:00:00Z',
      updated_at: '2026-03-12T03:10:00Z'
    },
    {
      id: 'acc-gbp-004',
      organization_id: 'org-001',
      bank_connection_id: 'bank-004',
      account_name: 'UK Payroll Reserve',
      account_number_masked: '****9017',
      currency_code: 'GBP',
      region: 'EMEA',
      liquidity_type: 'reserve',
      withdrawal_restricted: false,
      status: 'active',
      created_at: '2026-01-10T09:00:00Z',
      updated_at: '2026-03-13T10:10:00Z'
    }
  ],
  nextCursor: null
};

export const mockPaymentsResponse: PaginatedResponse<Payment> = {
  items: [
    {
      id: 'pay-001',
      organization_id: 'org-001',
      payment_reference: 'PAY-20491',
      source_account_id: 'acc-usd-001',
      beneficiary_counterparty_id: 'cp-001',
      amount: '18600000',
      currency_code: 'USD',
      value_date: '2026-03-16',
      purpose: 'Critical supplier remittance',
      status: 'pending_approval',
      idempotency_key: 'idem-001',
      request_id: 'req-001',
      created_by: 'usr-001',
      approval_workflow_id: 'wf-001',
      approved_at: null,
      executed_at: null,
      failure_reason: null,
      version: 3,
      updated_at: '2026-03-14T05:50:00Z',
      created_at: '2026-03-14T05:14:00Z'
    },
    {
      id: 'pay-002',
      organization_id: 'org-001',
      payment_reference: 'PAY-20477',
      source_account_id: 'acc-gbp-004',
      beneficiary_counterparty_id: 'cp-002',
      amount: '9100000',
      currency_code: 'GBP',
      value_date: '2026-03-17',
      purpose: 'Fuel hedge collateral top-up',
      status: 'approved',
      idempotency_key: 'idem-002',
      request_id: 'req-002',
      created_by: 'usr-002',
      approval_workflow_id: 'wf-002',
      approved_at: '2026-03-14T04:20:00Z',
      executed_at: null,
      failure_reason: null,
      version: 2,
      updated_at: '2026-03-14T04:20:00Z',
      created_at: '2026-03-13T18:14:00Z'
    },
    {
      id: 'pay-003',
      organization_id: 'org-001',
      payment_reference: 'PAY-20451',
      source_account_id: 'acc-eur-002',
      beneficiary_counterparty_id: 'cp-003',
      amount: '6200000',
      currency_code: 'EUR',
      value_date: '2026-03-19',
      purpose: 'Packaging vendor settlement',
      status: 'sent',
      idempotency_key: 'idem-003',
      request_id: 'req-003',
      created_by: 'usr-002',
      approval_workflow_id: 'wf-003',
      approved_at: '2026-03-13T08:20:00Z',
      executed_at: '2026-03-14T02:20:00Z',
      failure_reason: null,
      version: 4,
      updated_at: '2026-03-14T02:20:00Z',
      created_at: '2026-03-12T17:14:00Z'
    }
  ],
  nextCursor: null
};

export const mockTransactionsResponse: PaginatedResponse<Transaction> = {
  items: [
    {
      id: 'txn-001',
      organization_id: 'org-001',
      bank_account_id: 'acc-usd-001',
      booking_date: '2026-03-14',
      value_date: '2026-03-14',
      amount: '24500000',
      currency_code: 'USD',
      direction: 'inflow',
      description: 'North America collections sweep',
      reconciliation_status: 'reconciled',
      dedupe_hash: 'dedupe-001-collections',
      created_at: '2026-03-14T03:10:00Z',
      updated_at: '2026-03-14T03:10:00Z'
    },
    {
      id: 'txn-002',
      organization_id: 'org-001',
      bank_account_id: 'acc-eur-002',
      booking_date: '2026-03-14',
      value_date: '2026-03-15',
      amount: '11800000',
      currency_code: 'EUR',
      direction: 'outflow',
      description: 'VAT settlement',
      reconciliation_status: 'unreconciled',
      dedupe_hash: 'dedupe-002-vat',
      created_at: '2026-03-14T02:42:00Z',
      updated_at: '2026-03-14T02:42:00Z'
    },
    {
      id: 'txn-003',
      organization_id: 'org-001',
      bank_account_id: 'acc-gbp-004',
      booking_date: '2026-03-13',
      value_date: '2026-03-13',
      amount: '5400000',
      currency_code: 'GBP',
      direction: 'outflow',
      description: 'Payroll funding transfer',
      reconciliation_status: 'reconciled',
      dedupe_hash: 'dedupe-003-payroll',
      created_at: '2026-03-13T19:15:00Z',
      updated_at: '2026-03-13T19:15:00Z'
    },
    {
      id: 'txn-004',
      organization_id: 'org-001',
      bank_account_id: 'acc-usd-001',
      booking_date: '2026-03-13',
      value_date: '2026-03-14',
      amount: '8900000',
      currency_code: 'USD',
      direction: 'inflow',
      description: 'Intercompany concentration receipt',
      reconciliation_status: 'unreconciled',
      dedupe_hash: 'dedupe-004-ico',
      created_at: '2026-03-13T11:25:00Z',
      updated_at: '2026-03-13T11:25:00Z'
    }
  ],
  nextCursor: null
};
