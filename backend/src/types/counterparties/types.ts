import type { UUID } from '@/types/common';

export interface Counterparty {
  id: UUID;
  organization_id: UUID;
  name: string;
  type: 'customer' | 'vendor' | 'bank' | 'affiliate' | 'other';
  country_code: string | null;
  risk_rating: string | null;
  created_at: string;
  updated_at: string;
}

export interface CounterpartyFilters {
  type?: Counterparty['type'];
  search?: string;
}
