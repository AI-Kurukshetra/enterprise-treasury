import type { PaginationInput } from '@/types/common';
import { NotFoundError } from '@/errors/NotFoundError';
import { InvestmentsRepository, type InvestmentFilters } from '@/repositories/investments/repository';
import type { CreateInvestmentInput } from '@/types/investments/types';
import type { ServiceContext } from '@/services/context';

export class InvestmentsService {
  private readonly repository: InvestmentsRepository;

  constructor(context: ServiceContext, repository?: InvestmentsRepository) {
    this.repository = repository ?? new InvestmentsRepository({ organizationId: context.organizationId });
  }

  list(filters: InvestmentFilters, pagination: PaginationInput) {
    return this.repository.list(filters, pagination);
  }

  create(input: CreateInvestmentInput) {
    return this.repository.create(input);
  }

  async getById(investmentId: string) {
    const investment = await this.repository.findById(investmentId);
    if (!investment) {
      throw new NotFoundError('Investment not found');
    }
    return investment;
  }
}
