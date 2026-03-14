export const PAYMENT_STATUSES = [
  'draft',
  'pending_approval',
  'approved',
  'rejected',
  'sent',
  'settled',
  'failed',
  'cancelled'
] as const;

export const RISK_TYPES = ['fx', 'interest_rate', 'credit', 'liquidity'] as const;

export const SCOPE_TYPES = ['account', 'entity', 'organization'] as const;

export const APPROVAL_DECISIONS = ['approved', 'rejected'] as const;
