import type { ServiceContext } from '@/services/context';
import { AccountsService } from '@/services/accounts/service';
import { TransactionsService } from '@/services/transactions/service';
import { CashPositionsService } from '@/services/cash_positions/service';
import { PaymentsService } from '@/services/payments/service';
import { ApprovalsService } from '@/services/approvals/service';
import { ForecastsService } from '@/services/forecasts/service';
import { RiskService } from '@/services/risk/service';
import { InvestmentsService } from '@/services/investments/service';
import { DebtService } from '@/services/debt/service';
import { ReportsService } from '@/services/reports/service';
import { IntegrationsService } from '@/services/integrations/service';
import { CounterpartiesService } from '@/services/counterparties/service';
import { FxService } from '@/services/fx/service';
import { LiquidityService } from '@/services/liquidity/service';
import { NotificationsService } from '@/services/notifications/service';

export interface ServiceFactory {
  accounts: AccountsService;
  transactions: TransactionsService;
  cashPositions: CashPositionsService;
  payments: PaymentsService;
  approvals: ApprovalsService;
  forecasts: ForecastsService;
  risk: RiskService;
  investments: InvestmentsService;
  debt: DebtService;
  reports: ReportsService;
  integrations: IntegrationsService;
  counterparties: CounterpartiesService;
  fx: FxService;
  liquidity: LiquidityService;
  notifications: NotificationsService;
}

export function buildServices(context: ServiceContext): ServiceFactory {
  let accounts: AccountsService | undefined;
  let transactions: TransactionsService | undefined;
  let cashPositions: CashPositionsService | undefined;
  let payments: PaymentsService | undefined;
  let approvals: ApprovalsService | undefined;
  let forecasts: ForecastsService | undefined;
  let risk: RiskService | undefined;
  let investments: InvestmentsService | undefined;
  let debt: DebtService | undefined;
  let reports: ReportsService | undefined;
  let integrations: IntegrationsService | undefined;
  let counterparties: CounterpartiesService | undefined;
  let fx: FxService | undefined;
  let liquidity: LiquidityService | undefined;
  let notifications: NotificationsService | undefined;

  return {
    get accounts() {
      accounts ??= new AccountsService(context);
      return accounts;
    },
    get transactions() {
      transactions ??= new TransactionsService(context);
      return transactions;
    },
    get cashPositions() {
      cashPositions ??= new CashPositionsService(context);
      return cashPositions;
    },
    get payments() {
      payments ??= new PaymentsService(context);
      return payments;
    },
    get approvals() {
      approvals ??= new ApprovalsService(context);
      return approvals;
    },
    get forecasts() {
      forecasts ??= new ForecastsService(context);
      return forecasts;
    },
    get risk() {
      risk ??= new RiskService(context);
      return risk;
    },
    get investments() {
      investments ??= new InvestmentsService(context);
      return investments;
    },
    get debt() {
      debt ??= new DebtService(context);
      return debt;
    },
    get reports() {
      reports ??= new ReportsService(context);
      return reports;
    },
    get integrations() {
      integrations ??= new IntegrationsService(context);
      return integrations;
    },
    get counterparties() {
      counterparties ??= new CounterpartiesService(context);
      return counterparties;
    },
    get fx() {
      fx ??= new FxService(context);
      return fx;
    },
    get liquidity() {
      liquidity ??= new LiquidityService(context);
      return liquidity;
    },
    get notifications() {
      notifications ??= new NotificationsService(context);
      return notifications;
    }
  };
}
