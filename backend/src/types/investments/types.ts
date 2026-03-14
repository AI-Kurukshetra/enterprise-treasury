import type { UUID } from '@/types/common';

export interface Investment {
  id: UUID;
  organization_id: UUID;
  instrument_name: string;
  instrument_type: string;
  principal_amount: string;
  currency_code: string;
  maturity_date: string;
  status: 'active' | 'matured' | 'redeemed';
}

export interface CreateInvestmentInput {
  instrumentName: string;
  instrumentType: string;
  principalAmount: string;
  currencyCode: string;
  startDate: string;
  maturityDate: string;
  rate?: string;
}
