import { describe, expect, it, vi } from 'vitest';
import { ForecastAccuracyTracker } from '@/services/forecasts/forecast-accuracy-tracker';
import { createServiceContext } from '../../../tests/utils/context';

function buildForecastDetail() {
  return {
    id: '00000000-0000-4000-8000-000000000901',
    organization_id: 'org-test-1',
    name: 'Base forecast',
    forecast_type: 'short_term' as const,
    start_date: '2026-03-10',
    end_date: '2026-03-11',
    horizon_days: 2,
    currency_code: 'USD',
    model_type: 'ai_hybrid' as const,
    model_version: 'claude-sonnet-4-5',
    confidence_score: '0.8600',
    status: 'draft' as const,
    scenario_name: 'base',
    notes: null,
    base_forecast_id: null,
    scenario_parameters: {},
    generation_status: 'completed' as const,
    generation_job_id: null,
    generation_error: null,
    estimated_time_seconds: 18,
    generated_at: '2026-03-09T00:00:00.000Z',
    ai_summary: 'Base case',
    key_risks: [],
    recommended_actions: [],
    prompt_context: {},
    few_shot_examples: [],
    accuracy_score: null,
    accuracy_details: {},
    published_at: null,
    published_by: null,
    created_by: 'user-test-1',
    created_at: '2026-03-09T00:00:00.000Z',
    updated_at: '2026-03-09T00:00:00.000Z',
    lines: [
      {
        id: 'line-1',
        organization_id: 'org-test-1',
        forecast_id: '00000000-0000-4000-8000-000000000901',
        forecast_date: '2026-03-10',
        projected_inflow: '10.000000',
        projected_outflow: '0.000000',
        projected_net: '10.000000',
        cumulative_balance: '1010.000000',
        confidence_score: '0.9000',
        key_drivers: ['Receipts'],
        balance_low: '1005.000000',
        balance_high: '1015.000000',
        scenario: 'base',
        created_at: '2026-03-09T00:00:00.000Z',
        updated_at: '2026-03-09T00:00:00.000Z'
      },
      {
        id: 'line-2',
        organization_id: 'org-test-1',
        forecast_id: '00000000-0000-4000-8000-000000000901',
        forecast_date: '2026-03-11',
        projected_inflow: '20.000000',
        projected_outflow: '0.000000',
        projected_net: '20.000000',
        cumulative_balance: '1030.000000',
        confidence_score: '0.8000',
        key_drivers: ['Collections'],
        balance_low: '1020.000000',
        balance_high: '1040.000000',
        scenario: 'base',
        created_at: '2026-03-09T00:00:00.000Z',
        updated_at: '2026-03-09T00:00:00.000Z'
      }
    ]
  };
}

describe('ForecastAccuracyTracker', () => {
  it('calculates per-day MAPE and stores overall accuracy on the forecast record', async () => {
    const repository = {
      getDetail: vi.fn(async () => buildForecastDetail()),
      listHistoricalTransactions: vi.fn(async () => [
        {
          booking_date: '2026-03-10',
          amount: '8.000000',
          currency_code: 'USD',
          direction: 'inflow'
        },
        {
          booking_date: '2026-03-11',
          amount: '10.000000',
          currency_code: 'USD',
          direction: 'inflow'
        }
      ]),
      updateForecast: vi.fn(async () => buildForecastDetail()),
      listPromptExamples: vi.fn(async () => [])
    };

    const tracker = new ForecastAccuracyTracker(createServiceContext(), repository as never, {
      convertAmount: vi.fn(async (value) => (typeof value === 'string' ? value : { amount: value.amount }))
    } as never, () => new Date('2026-03-14T00:00:00.000Z'));

    const result = await tracker.calculateForecastAccuracy('00000000-0000-4000-8000-000000000901');

    expect(result).toEqual({
      forecastId: '00000000-0000-4000-8000-000000000901',
      accuracyScore: '0.375000',
      overallMapePct: '62.500000',
      evaluatedDays: 2
    });
    expect(repository.updateForecast).toHaveBeenCalledWith(
      '00000000-0000-4000-8000-000000000901',
      expect.objectContaining({
        accuracy_score: '0.375000',
        accuracy_details: expect.objectContaining({
          overallMapePct: '62.500000',
          evaluatedDays: 2,
          dayMetrics: expect.arrayContaining([
            expect.objectContaining({ date: '2026-03-10', mapePct: '25.000000' }),
            expect.objectContaining({ date: '2026-03-11', mapePct: '100.000000' })
          ])
        })
      })
    );
  });
});
