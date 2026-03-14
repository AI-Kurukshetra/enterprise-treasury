import type { UUID } from '@/types/common';

export interface DebtFacility {
  id: UUID;
  organization_id: UUID;
  facility_name: string;
  facility_type: 'revolver' | 'term_loan' | 'overdraft';
  limit_amount: string;
  utilized_amount: string;
  currency_code: string;
  status: 'active' | 'suspended' | 'closed';
}

export interface DebtScheduleLine {
  id: UUID;
  debt_facility_id: UUID;
  due_date: string;
  principal_due: string;
  interest_due: string;
  status: 'scheduled' | 'paid' | 'overdue';
}

export interface CreateDebtFacilityInput {
  facilityName: string;
  facilityType: DebtFacility['facility_type'];
  lenderCounterpartyId: UUID;
  limitAmount: string;
  currencyCode: string;
}
