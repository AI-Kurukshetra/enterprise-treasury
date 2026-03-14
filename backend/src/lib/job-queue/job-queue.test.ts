import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobQueue } from '@/lib/job-queue/job-queue';

type QueryResult = {
  data?: unknown;
  error?: { message: string; code?: string } | null;
};

class QueryBuilderMock {
  public insertPayload?: unknown;
  public updatePayload?: unknown;
  private readonly result: QueryResult;

  constructor(result: QueryResult) {
    this.result = {
      error: null,
      ...result
    };
  }

  select() {
    return this;
  }

  insert(payload: unknown) {
    this.insertPayload = payload;
    return this;
  }

  update(payload: unknown) {
    this.updatePayload = payload;
    return this;
  }

  eq() {
    return this;
  }

  order() {
    return this;
  }

  limit() {
    return this;
  }

  maybeSingle() {
    return Promise.resolve(this.result);
  }

  single() {
    return Promise.resolve(this.result);
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

function createDbMock(config: {
  tables?: Record<string, QueryResult[]>;
  rpc?: Record<string, QueryResult>;
}) {
  const builders = new Map<string, QueryBuilderMock[]>();
  const remainingResults = new Map(
    Object.entries(config.tables ?? {}).map(([table, results]) => [table, [...results]])
  );

  return {
    client: {
      from(table: string) {
        const nextResult = remainingResults.get(table)?.shift() ?? {};
        const builder = new QueryBuilderMock(nextResult);
        const existing = builders.get(table) ?? [];
        existing.push(builder);
        builders.set(table, existing);
        return builder;
      },
      async rpc(name: string, _args?: unknown) {
        const result = config.rpc?.[name] ?? {};
        return {
          error: null,
          ...result
        };
      }
    },
    lastBuilder(table: string) {
      const builder = builders.get(table)?.at(-1);
      if (!builder) {
        throw new Error(`Missing builder for ${table}`);
      }
      return builder;
    }
  };
}

describe('JobQueue', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-14T12:00:00.000Z'));
  });

  it('enqueues jobs into the database-backed queue', async () => {
    const db = createDbMock({
      tables: {
        job_queue: [{ data: { id: 'job-1' } }]
      }
    });
    const queue = new JobQueue(db.client as never);

    const jobId = await queue.enqueue('report.generate', { organizationId: 'org-1', reportType: 'audit' }, { maxAttempts: 5 });

    expect(jobId).toBe('job-1');
    expect(db.lastBuilder('job_queue').insertPayload).toEqual({
      organization_id: 'org-1',
      type: 'report.generate',
      payload: {
        organizationId: 'org-1',
        reportType: 'audit'
      },
      max_attempts: 5,
      scheduled_for: '2026-03-14T12:00:00.000Z'
    });
  });

  it('maps dequeued RPC rows into Job objects', async () => {
    const queue = new JobQueue({
      rpc: async () => ({
        data: {
          id: 'job-2',
          type: 'bank.sync',
          payload: {
            organizationId: 'org-1',
            connectionId: 'conn-1'
          },
          status: 'running',
          attempts: 1,
          max_attempts: 4,
          last_error: null,
          scheduled_for: '2026-03-14T12:00:00.000Z',
          started_at: '2026-03-14T12:00:00.000Z',
          completed_at: null,
          organization_id: 'org-1',
          created_at: '2026-03-14T11:59:00.000Z'
        },
        error: null
      })
    } as never);

    const job = await queue.dequeue(['bank.sync']);

    expect(job).toEqual({
      id: 'job-2',
      type: 'bank.sync',
      payload: {
        organizationId: 'org-1',
        connectionId: 'conn-1'
      },
      status: 'running',
      attempts: 1,
      maxAttempts: 4,
      lastError: null,
      scheduledFor: '2026-03-14T12:00:00.000Z',
      startedAt: '2026-03-14T12:00:00.000Z',
      completedAt: null,
      organizationId: 'org-1',
      createdAt: '2026-03-14T11:59:00.000Z'
    });
  });

  it('moves failed retryable jobs back to retrying with backoff', async () => {
    const db = createDbMock({
      tables: {
        job_queue: [
          {
            data: {
              id: 'job-3',
              type: 'cash-position.recalculate',
              payload: { organizationId: 'org-1' },
              status: 'running',
              attempts: 1,
              max_attempts: 3,
              last_error: null,
              scheduled_for: '2026-03-14T12:00:00.000Z',
              started_at: '2026-03-14T12:00:00.000Z',
              completed_at: null,
              organization_id: 'org-1',
              created_at: '2026-03-14T11:59:00.000Z'
            }
          },
          {}
        ]
      }
    });
    const queue = new JobQueue(db.client as never);

    await queue.fail('job-3', new Error('temporary failure'), true);

    expect(db.lastBuilder('job_queue').updatePayload).toEqual({
      status: 'retrying',
      last_error: expect.stringContaining('temporary failure'),
      scheduled_for: '2026-03-14T12:00:30.000Z',
      started_at: null,
      completed_at: null
    });
  });
});
