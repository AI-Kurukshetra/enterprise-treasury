import type { PaginationInput } from '@/types/common';
import { ConflictError } from '@/errors/ConflictError';
import { NotFoundError } from '@/errors/NotFoundError';
import { ValidationError } from '@/errors/ValidationError';
import { withTransactionBoundary } from '@/lib/transaction';
import { AccountsRepository } from '@/repositories/accounts/repository';
import { TransactionsRepository } from '@/repositories/transactions/repository';
import type { CreateTransactionInput, TransactionFilters } from '@/types/transactions/types';
import { compareDecimalStrings } from '@/utils/money';
import type { ServiceContext } from '@/services/context';

export class TransactionsService {
  private readonly transactionsRepository: TransactionsRepository;
  private readonly accountsRepository: AccountsRepository;

  constructor(context: ServiceContext, transactionsRepository?: TransactionsRepository, accountsRepository?: AccountsRepository) {
    this.transactionsRepository =
      transactionsRepository ?? new TransactionsRepository({ organizationId: context.organizationId });
    this.accountsRepository = accountsRepository ?? new AccountsRepository({ organizationId: context.organizationId });
  }

  list(filters: TransactionFilters, pagination: PaginationInput) {
    return this.transactionsRepository.list(filters, pagination);
  }

  async create(input: CreateTransactionInput) {
    if (compareDecimalStrings(input.amount, '0') <= 0) {
      throw new ValidationError('Transaction amount must be positive');
    }

    const existing = await this.transactionsRepository.findByDedupeHash(input.dedupeHash);
    if (existing) {
      throw new ConflictError('Duplicate transaction detected', {
        transactionId: existing.id
      });
    }

    const account = await this.accountsRepository.getById(input.bankAccountId);
    if (!account) {
      throw new NotFoundError('Source account not found');
    }

    if (account.currency_code !== input.currencyCode) {
      throw new ValidationError('Currency mismatch between account and transaction', {
        accountCurrency: account.currency_code,
        transactionCurrency: input.currencyCode
      });
    }

    return withTransactionBoundary('transactions.create', async () => this.transactionsRepository.create(input));
  }

  queueImport(bankConnectionId: string, sourceFilename: string) {
    return withTransactionBoundary('transactions.import', async () =>
      this.transactionsRepository.queueImport({
        bankConnectionId,
        sourceFilename
      })
    );
  }

  async queueImportUpload(input: {
    bankAccountId: string;
    sourceFilename: string;
    format?: 'mt940' | 'csv' | 'ofx';
  }) {
    const account = await this.accountsRepository.getById(input.bankAccountId);
    if (!account) {
      throw new NotFoundError('Bank account not found');
    }

    const bankConnectionId = account.bank_connection_id;
    if (!bankConnectionId) {
      throw new ValidationError('Selected bank account is not linked to a bank connection');
    }

    return withTransactionBoundary('transactions.import.upload', async () =>
      this.transactionsRepository.queueImport({
        bankConnectionId,
        bankAccountId: input.bankAccountId,
        sourceFilename: input.sourceFilename,
        format: input.format
      })
    );
  }

  async getImportStatus(jobId: string) {
    const status = await this.transactionsRepository.getImportJobStatus(jobId);
    if (!status) {
      throw new NotFoundError('Import job not found');
    }
    return status;
  }

  async reconcile(transactionId: string) {
    return withTransactionBoundary('transactions.reconcile', async () => {
      const transaction = await this.transactionsRepository.reconcile(transactionId);
      if (!transaction) {
        throw new NotFoundError('Transaction not found');
      }
      return transaction;
    });
  }
}
