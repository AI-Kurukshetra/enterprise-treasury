import { describe, expect, it, vi } from 'vitest';
import { ValidationError } from '@/errors/ValidationError';
import { ForecastEngine } from '@/services/forecasts/forecast-engine';
import { createServiceContext } from '../../../tests/utils/context';

function buildForecastRow() {
  return {
    id: '00000000-0000-4000-8000-000000000901',
    organization_id: 'org-test-1',
    name: 'Base forecast',
    forecast_type: 'short_term' as const,
    start_date: '2026-03-14',
    end_date: '2026-03-15',
    horizon_days: 2,
    currency_code: 'USD',
    model_type: 'ai_hybrid' as const,
    model_version: 'claude-sonnet-4-5',
    confidence_score: null,
    status: 'draft' as const,
    scenario_name: 'base',
    notes: null,
    base_forecast_id: null,
    scenario_parameters: {},
    generation_status: 'running' as const,
    generation_job_id: null,
    generation_error: null,
    estimated_time_seconds: 18,
    generated_at: null,
    ai_summary: null,
    key_risks: [],
    recommended_actions: [],
    prompt_context: {},
    few_shot_examples: [],
    accuracy_score: null,
    accuracy_details: {},
    published_at: null,
    published_by: null,
    created_by: 'user-test-1',
    created_at: '2026-03-14T00:00:00.000Z',
    updated_at: '2026-03-14T00:00:00.000Z'
  };
}

function buildRepositoryMock() {
  return {
    createGenerationRecord: vi.fn(async () => buildForecastRow()),
    updateForecast: vi.fn(async () => buildForecastRow()),
    replaceForecastLines: vi.fn(async () => undefined),
    listHistoricalTransactions: vi.fn(async () => [
      {
        booking_date: '2026-03-10',
        amount: '100.000000',
        currency_code: 'USD',
        direction: 'inflow',
        description: 'Customer receipts'
      }
    ]),
    listOpenPayments: vi.fn(async () => []),
    listUpcomingDebtSchedules: vi.fn(async () => []),
    listInvestmentMaturities: vi.fn(async () => []),
    listSweepingRules: vi.fn(async () => []),
    getCurrentCashPositions: vi.fn(async () => [
      {
        currency_code: 'USD',
        available_balance: '1000.000000',
        current_balance: '1000.000000',
        as_of_at: '2026-03-14T00:00:00.000Z'
      }
    ]),
    listTreasuryPolicies: vi.fn(async () => []),
    getDetail: vi.fn()
  };
}

describe('ForecastEngine', () => {
  it('parses Claude JSON and persists normalized forecast lines', async () => {
    const repository = buildRepositoryMock();
    const callClaude = vi.fn(async () => ({
      model: 'claude-sonnet-4-5',
      text: JSON.stringify({
        lines: [
          {
            date: '2026-03-14',
            projected_inflow: '120.000000',
            projected_outflow: '75.000000',
            projected_net: '999.000000',
            cumulative_balance: '1045.000000',
            confidence_score: 0.91,
            key_drivers: ['Collections batch']
          },
          {
            date: '2026-03-15',
            projected_inflow: '80.000000',
            projected_outflow: '95.000000',
            projected_net: '-15.000000',
            cumulative_balance: '1030.000000',
            confidence_score: 0.82,
            key_drivers: ['Payroll run']
          }
        ],
        scenario_summary: 'Collections remain stable while payroll creates a one-day outflow spike.',
        key_risks: ['Customer receipts could slip by one day'],
        recommended_actions: ['Hold the excess overnight buffer']
      }),
      usage: {
        inputTokens: 100,
        outputTokens: 200,
        totalTokens: 300
      }
    }));

    const engine = new ForecastEngine(createServiceContext(), {
      repository: repository as never,
      fxService: {
        convertAmount: vi.fn(async (value) => (typeof value === 'string' ? value : { amount: value.amount }))
      } as never,
      accuracyTracker: {
        buildFewShotExamples: vi.fn(async () => [])
      } as never,
      callClaude: callClaude as never,
      now: () => new Date('2026-03-14T00:00:00.000Z')
    });

    const result = await engine.generateForecast('org-test-1', {
      forecastType: 'short_term',
      horizon: 2,
      currencyCode: 'USD',
      scenarioName: 'base'
    });

    expect(result).toEqual({
      forecastId: '00000000-0000-4000-8000-000000000901',
      status: 'completed',
      estimatedTimeSeconds: 1
    });
    expect(repository.replaceForecastLines).toHaveBeenCalledTimes(1);
    expect(repository.replaceForecastLines).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000901',
      expect.arrayContaining([
        expect.objectContaining({
          forecast_date: '2026-03-14',
          projected_inflow: '120.000000',
          projected_outflow: '75.000000',
          projected_net: '45.000000',
          cumulative_balance: '1045.000000',
          scenario: 'base'
        }),
        expect.objectContaining({
          forecast_date: '2026-03-15',
          projected_net: '-15.000000',
          cumulative_balance: '1030.000000'
        })
      ])
    );
    expect(repository.updateForecast).toHaveBeenLastCalledWith(
      '00000000-0000-4000-8000-000000000901',
      expect.objectContaining({
        generation_status: 'completed',
        ai_summary: 'Collections remain stable while payroll creates a one-day outflow spike.',
        key_risks: ['Customer receipts could slip by one day'],
        recommended_actions: ['Hold the excess overnight buffer']
      })
    );
  });

  it('fails closed on malformed Claude payloads', async () => {
    const repository = buildRepositoryMock();
    const engine = new ForecastEngine(createServiceContext(), {
      repository: repository as never,
      fxService: {
        convertAmount: vi.fn(async (value) => (typeof value === 'string' ? value : { amount: value.amount }))
      } as never,
      accuracyTracker: {
        buildFewShotExamples: vi.fn(async () => [])
      } as never,
      callClaude: vi.fn(async () => ({
        model: 'claude-sonnet-4-5',
        text: '{"scenario_summary":"missing lines"}',
        usage: {
          inputTokens: 10,
          outputTokens: 10,
          totalTokens: 20
        }
      })) as never,
      now: () => new Date('2026-03-14T00:00:00.000Z')
    });

    await expect(
      engine.generateForecast('org-test-1', {
        forecastType: 'short_term',
        horizon: 2,
        currencyCode: 'USD',
        scenarioName: 'base'
      })
    ).rejects.toBeInstanceOf(ValidationError);

    expect(repository.updateForecast).toHaveBeenLastCalledWith(
      '00000000-0000-4000-8000-000000000901',
      expect.objectContaining({
        generation_status: 'failed'
      })
    );
  });
});
