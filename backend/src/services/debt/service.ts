import type { PaginationInput } from '@/types/common';
import { DebtRepository, type DebtFilters } from '@/repositories/debt/repository';
import type { CreateDebtFacilityInput } from '@/types/debt/types';
import type { ServiceContext } from '@/services/context';

export class DebtService {
  private readonly repository: DebtRepository;

  constructor(context: ServiceContext, repository?: DebtRepository) {
    this.repository = repository ?? new DebtRepository({ organizationId: context.organizationId });
  }

  listFacilities(filters: DebtFilters, pagination: PaginationInput) {
    return this.repository.listFacilities(filters, pagination);
  }

  createFacility(input: CreateDebtFacilityInput) {
    return this.repository.createFacility(input);
  }

  getSchedule(facilityId: string) {
    return this.repository.getSchedule(facilityId);
  }
}
