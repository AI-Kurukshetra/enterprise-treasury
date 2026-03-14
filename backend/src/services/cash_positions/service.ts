import type { CashPositionHistoryQuery } from '@/types/cash_positions/types';
import type { ServiceContext } from '@/services/context';
import { CashPositionAggregationService } from '@/services/cash-positions/aggregation-service';

export class CashPositionsService {
  private readonly aggregationService: CashPositionAggregationService;
  private readonly organizationId: string;

  constructor(context: ServiceContext, aggregationService?: CashPositionAggregationService) {
    this.organizationId = context.organizationId;
    this.aggregationService = aggregationService ?? new CashPositionAggregationService(context.organizationId);
  }

  getLatest() {
    return this.aggregationService.getConsolidatedPosition(this.organizationId);
  }

  getHistory(query: CashPositionHistoryQuery) {
    return this.aggregationService.getCashTrend(this.organizationId, query.days);
  }

  getRegionalBreakdown() {
    return this.aggregationService.getRegionalBreakdown(this.organizationId);
  }

  recalculate(asOf?: Date) {
    return this.aggregationService.recalculate(this.organizationId, asOf);
  }
}
