import type { PaginationInput } from '@/types/common';
import { NotFoundError } from '@/errors/NotFoundError';
import { CounterpartiesRepository } from '@/repositories/counterparties/repository';
import type { CounterpartyFilters } from '@/types/counterparties/types';
import type { ServiceContext } from '@/services/context';

export class CounterpartiesService {
  private readonly repository: CounterpartiesRepository;

  constructor(context: ServiceContext, repository?: CounterpartiesRepository) {
    this.repository = repository ?? new CounterpartiesRepository({ organizationId: context.organizationId });
  }

  list(filters: CounterpartyFilters, pagination: PaginationInput) {
    return this.repository.list(filters, pagination);
  }

  async getById(counterpartyId: string) {
    const counterparty = await this.repository.findById(counterpartyId);
    if (!counterparty) {
      throw new NotFoundError('Counterparty not found');
    }
    return counterparty;
  }
}
