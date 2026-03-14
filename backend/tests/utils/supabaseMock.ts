type QueryResult = {
  data?: unknown;
  error?: { message: string; code?: string } | null;
  count?: number | null;
};

interface BuilderState {
  table: string;
  operations: Array<{ method: string; args: unknown[] }>;
  insertPayload?: unknown;
  updatePayload?: unknown;
  upsertPayload?: unknown;
}

class QueryBuilderMock {
  public readonly state: BuilderState;
  private readonly result: QueryResult;

  constructor(table: string, result: QueryResult) {
    this.state = {
      table,
      operations: []
    };
    this.result = {
      error: null,
      count: null,
      ...result
    };
  }

  select(...args: unknown[]) {
    this.state.operations.push({ method: 'select', args });
    return this;
  }

  insert(payload: unknown) {
    this.state.insertPayload = payload;
    this.state.operations.push({ method: 'insert', args: [payload] });
    return this;
  }

  update(payload: unknown) {
    this.state.updatePayload = payload;
    this.state.operations.push({ method: 'update', args: [payload] });
    return this;
  }

  delete(...args: unknown[]) {
    this.state.operations.push({ method: 'delete', args });
    return this;
  }

  upsert(payload: unknown, ...args: unknown[]) {
    this.state.upsertPayload = payload;
    this.state.operations.push({ method: 'upsert', args: [payload, ...args] });
    return this;
  }

  eq(...args: unknown[]) {
    this.state.operations.push({ method: 'eq', args });
    return this;
  }

  neq(...args: unknown[]) {
    this.state.operations.push({ method: 'neq', args });
    return this;
  }

  gte(...args: unknown[]) {
    this.state.operations.push({ method: 'gte', args });
    return this;
  }

  lte(...args: unknown[]) {
    this.state.operations.push({ method: 'lte', args });
    return this;
  }

  gt(...args: unknown[]) {
    this.state.operations.push({ method: 'gt', args });
    return this;
  }

  lt(...args: unknown[]) {
    this.state.operations.push({ method: 'lt', args });
    return this;
  }

  in(...args: unknown[]) {
    this.state.operations.push({ method: 'in', args });
    return this;
  }

  is(...args: unknown[]) {
    this.state.operations.push({ method: 'is', args });
    return this;
  }

  or(...args: unknown[]) {
    this.state.operations.push({ method: 'or', args });
    return this;
  }

  contains(...args: unknown[]) {
    this.state.operations.push({ method: 'contains', args });
    return this;
  }

  order(...args: unknown[]) {
    this.state.operations.push({ method: 'order', args });
    return this;
  }

  limit(...args: unknown[]) {
    this.state.operations.push({ method: 'limit', args });
    return this;
  }

  single() {
    this.state.operations.push({ method: 'single', args: [] });
    return Promise.resolve(this.result);
  }

  maybeSingle() {
    this.state.operations.push({ method: 'maybeSingle', args: [] });
    return Promise.resolve(this.result);
  }

  then<TResult1 = QueryResult, TResult2 = never>(
    onfulfilled?: ((value: QueryResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve(this.result).then(onfulfilled, onrejected);
  }
}

export function createSupabaseClientMock(results: Record<string, QueryResult>) {
  const builders = new Map<string, QueryBuilderMock[]>();
  const rpcCalls = new Map<string, Array<{ args: unknown }>>();

  return {
    client: {
      from(table: string) {
        const builder = new QueryBuilderMock(table, results[table] ?? {});
        const existing = builders.get(table) ?? [];
        existing.push(builder);
        builders.set(table, existing);
        return builder;
      },
      rpc(name: string, args?: unknown) {
        const existing = rpcCalls.get(name) ?? [];
        existing.push({ args });
        rpcCalls.set(name, existing);
        return Promise.resolve({
          error: null,
          count: null,
          ...(results[`rpc:${name}`] ?? {})
        });
      }
    },
    getLastBuilder(table: string): QueryBuilderMock {
      const existing = builders.get(table) ?? [];
      const last = existing.at(-1);
      if (!last) {
        throw new Error(`No builder recorded for table ${table}`);
      }
      return last;
    },
    getBuilders(table: string): QueryBuilderMock[] {
      return builders.get(table) ?? [];
    },
    getLastRpcCall(name: string): { args: unknown } {
      const existing = rpcCalls.get(name) ?? [];
      const last = existing.at(-1);
      if (!last) {
        throw new Error(`No rpc call recorded for ${name}`);
      }
      return last;
    }
  };
}
