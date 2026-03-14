import { describe, expect, it } from 'vitest';
import {
  buildPaymentVolumeSeries,
  calculateAccountPositions,
  rollupCurrencyPositions
} from '@/services/cash-positions/aggregation-service';

describe('cash position aggregation helpers', () => {
  it('calculates current, available, and restricted balances deterministically', () => {
    const positions = calculateAccountPositions(
      [
        {
          id: 'acct-1',
          currency_code: 'USD',
          region: 'Americas',
          liquidity_type: 'operating',
          withdrawal_restricted: false
        },
        {
          id: 'acct-2',
          currency_code: 'EUR',
          region: 'EMEA',
          liquidity_type: 'reserve',
          withdrawal_restricted: false
        }
      ],
      [
        { bank_account_id: 'acct-1', amount: '125.500000', direction: 'inflow', booking_date: '2026-03-14' },
        { bank_account_id: 'acct-1', amount: '25.000000', direction: 'outflow', booking_date: '2026-03-14' },
        { bank_account_id: 'acct-2', amount: '80.000000', direction: 'inflow', booking_date: '2026-03-14' }
      ],
      [
        {
          source_account_id: 'acct-1',
          amount: '10.500000',
          currency_code: 'USD',
          status: 'pending_approval',
          value_date: '2026-03-15',
          created_at: '2026-03-14T06:00:00Z'
        }
      ]
    );

    expect(positions).toEqual([
      {
        accountId: 'acct-1',
        currencyCode: 'USD',
        currentBalance: '100.500000',
        availableBalance: '90.000000',
        restrictedBalance: '10.500000'
      },
      {
        accountId: 'acct-2',
        currencyCode: 'EUR',
        currentBalance: '80.000000',
        availableBalance: '80.000000',
        restrictedBalance: '0.000000'
      }
    ]);
  });

  it('rolls account balances into organization currency buckets', () => {
    const totals = rollupCurrencyPositions([
      {
        accountId: 'acct-1',
        currencyCode: 'USD',
        currentBalance: '100.500000',
        availableBalance: '90.000000',
        restrictedBalance: '10.500000'
      },
      {
        accountId: 'acct-2',
        currencyCode: 'USD',
        currentBalance: '20.000000',
        availableBalance: '20.000000',
        restrictedBalance: '0.000000'
      },
      {
        accountId: 'acct-3',
        currencyCode: 'EUR',
        currentBalance: '80.000000',
        availableBalance: '80.000000',
        restrictedBalance: '0.000000'
      }
    ]);

    expect(totals).toEqual([
      {
        currencyCode: 'EUR',
        currentBalance: '80.000000',
        availableBalance: '80.000000',
        restrictedBalance: '0.000000'
      },
      {
        currencyCode: 'USD',
        currentBalance: '120.500000',
        availableBalance: '110.000000',
        restrictedBalance: '10.500000'
      }
    ]);
  });

  it('classifies near-dated payments as urgent in the chart series', () => {
    const series = buildPaymentVolumeSeries(
      [
        {
          source_account_id: 'acct-1',
          amount: '10.000000',
          currency_code: 'USD',
          status: 'pending_approval',
          value_date: '2026-03-14',
          created_at: '2026-03-13T06:00:00Z'
        },
        {
          source_account_id: 'acct-1',
          amount: '8.000000',
          currency_code: 'USD',
          status: 'approved',
          value_date: '2026-03-15',
          created_at: '2026-03-13T06:00:00Z'
        },
        {
          source_account_id: 'acct-1',
          amount: '22.000000',
          currency_code: 'USD',
          status: 'approved',
          value_date: '2026-03-17',
          created_at: '2026-03-13T06:00:00Z'
        }
      ],
      new Date('2026-03-14T12:00:00Z'),
      5
    );

    expect(series.map((point) => ({ label: point.label, urgent: point.urgent, scheduled: point.scheduled }))).toEqual([
      { label: 'Mar 14', urgent: 1, scheduled: 0 },
      { label: 'Mar 15', urgent: 1, scheduled: 0 },
      { label: 'Mar 16', urgent: 0, scheduled: 0 },
      { label: 'Mar 17', urgent: 0, scheduled: 1 },
      { label: 'Mar 18', urgent: 0, scheduled: 0 }
    ]);
  });
});
