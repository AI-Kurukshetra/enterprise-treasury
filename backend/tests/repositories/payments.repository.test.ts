import { describe, expect, it } from 'vitest';
import { PaymentsRepository } from '@/repositories/payments/repository';
import { paymentFixture } from '../fixtures/treasury';
import { createSupabaseClientMock } from '../utils/supabaseMock';

describe('PaymentsRepository', () => {
  it('applies payment search filters and paginates by created_at', async () => {
    const { client, getLastBuilder } = createSupabaseClientMock({
      payments: {
        data: [paymentFixture()]
      }
    });
    const repository = new PaymentsRepository({ organizationId: 'org-1' }, client as never);

    await repository.list(
      {
        status: 'pending_approval',
        accountId: 'acc-1',
        beneficiaryId: 'beneficiary-1',
        fromDate: '2026-03-01',
        toDate: '2026-03-31',
        minAmount: '10.000000',
        maxAmount: '1000.000000'
      },
      { limit: 5 }
    );

    const builder = getLastBuilder('payments');
    expect(builder.state.operations).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['organization_id', 'org-1'] },
        { method: 'eq', args: ['status', 'pending_approval'] },
        { method: 'eq', args: ['source_account_id', 'acc-1'] },
        { method: 'eq', args: ['beneficiary_counterparty_id', 'beneficiary-1'] },
        { method: 'gte', args: ['value_date', '2026-03-01'] },
        { method: 'lte', args: ['value_date', '2026-03-31'] },
        { method: 'gte', args: ['amount', '10.000000'] },
        { method: 'lte', args: ['amount', '1000.000000'] }
      ])
    );
  });

  it('adds approval and execution timestamps when updating payment status', async () => {
    const { client, getLastBuilder } = createSupabaseClientMock({
      payments: {
        data: paymentFixture({ status: 'approved', version: 2 })
      }
    });
    const repository = new PaymentsRepository({ organizationId: 'org-1' }, client as never);

    await repository.updateStatus('pay-1', 'approved', 1, 'bank error');

    const builder = getLastBuilder('payments');
    expect(builder.state.updatePayload).toEqual(
      expect.objectContaining({
        status: 'approved',
        approved_at: expect.any(String),
        failure_reason: 'bank error'
      })
    );
  });

  it('retrieves payments by id and idempotency key within the tenant boundary', async () => {
    const payment = paymentFixture();
    const { client, getLastBuilder } = createSupabaseClientMock({
      payments: {
        data: payment
      }
    });
    const repository = new PaymentsRepository({ organizationId: 'org-1' }, client as never);

    await expect(repository.findById(payment.id)).resolves.toEqual(payment);
    expect(getLastBuilder('payments').state.operations).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['organization_id', 'org-1'] },
        { method: 'eq', args: ['id', payment.id] },
        { method: 'maybeSingle', args: [] }
      ])
    );

    await expect(repository.findByIdempotencyKey(payment.idempotency_key)).resolves.toEqual(payment);
    expect(getLastBuilder('payments').state.operations).toEqual(
      expect.arrayContaining([
        { method: 'eq', args: ['organization_id', 'org-1'] },
        { method: 'eq', args: ['idempotency_key', payment.idempotency_key] },
        { method: 'maybeSingle', args: [] }
      ])
    );
  });

  it('creates pending-approval payments with request and workflow context', async () => {
    const created = paymentFixture({
      request_id: 'req-100',
      approval_workflow_id: '00000000-0000-4000-8000-000000000601'
    });
    const requestId = created.request_id as string;
    const approvalWorkflowId = created.approval_workflow_id as string;
    const { client, getLastBuilder } = createSupabaseClientMock({
      payments: {
        data: created
      }
    });
    const repository = new PaymentsRepository({ organizationId: 'org-1' }, client as never);

    await repository.create(
      {
        paymentReference: created.payment_reference,
        sourceAccountId: created.source_account_id,
        beneficiaryCounterpartyId: created.beneficiary_counterparty_id,
        amount: created.amount,
        currencyCode: created.currency_code,
        valueDate: created.value_date,
        purpose: created.purpose ?? undefined
      },
      created.created_by,
      created.idempotency_key,
      requestId,
      approvalWorkflowId
    );

    const builder = getLastBuilder('payments');
    expect(builder.state.insertPayload).toEqual({
      organization_id: 'org-1',
      payment_reference: created.payment_reference,
      source_account_id: created.source_account_id,
      beneficiary_counterparty_id: created.beneficiary_counterparty_id,
      amount: created.amount,
      currency_code: created.currency_code,
      value_date: created.value_date,
      purpose: created.purpose,
      status: 'pending_approval',
      notes: null,
      request_id: created.request_id,
      created_by: created.created_by,
      approval_workflow_id: created.approval_workflow_id,
      idempotency_key: created.idempotency_key
    });
  });

  it('adds execution timestamps when marking payments as sent', async () => {
    const { client, getLastBuilder } = createSupabaseClientMock({
      payments: {
        data: paymentFixture({ status: 'sent', version: 2 })
      }
    });
    const repository = new PaymentsRepository({ organizationId: 'org-1' }, client as never);

    await repository.updateStatus('pay-1', 'sent', 1);

    const builder = getLastBuilder('payments');
    expect(builder.state.updatePayload).toEqual(
      expect.objectContaining({
        status: 'sent',
        executed_at: expect.any(String)
      })
    );
  });
});
