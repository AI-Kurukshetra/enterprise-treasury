import { describe, expect, it } from 'vitest';
import { applyCursorPagination, applyTenantFilter } from '@/repositories/base/query';

class FakeQueryBuilder {
  public operations: string[] = [];

  eq(column: string, value: string) {
    this.operations.push(`eq:${column}:${value}`);
    return this;
  }

  order(column: string, options: { ascending: boolean }) {
    this.operations.push(`order:${column}:${options.ascending}`);
    return this;
  }

  lt(column: string, value: string) {
    this.operations.push(`lt:${column}:${value}`);
    return this;
  }

  gt(column: string, value: string) {
    this.operations.push(`gt:${column}:${value}`);
    return this;
  }

  limit(value: number) {
    this.operations.push(`limit:${value}`);
    return this;
  }
}

describe('query helpers', () => {
  it('applies tenant filter', () => {
    const query = new FakeQueryBuilder();
    applyTenantFilter(query as never, 'org-1');
    expect(query.operations).toContain('eq:organization_id:org-1');
  });

  it('applies cursor pagination with limit + 1', () => {
    const query = new FakeQueryBuilder();
    applyCursorPagination(query as never, { limit: 25, cursor: Buffer.from('cursor-1').toString('base64') }, {
      cursorColumn: 'created_at',
      ascending: false
    });

    expect(query.operations).toContain('order:created_at:false');
    expect(query.operations).toContain('lt:created_at:cursor-1');
    expect(query.operations).toContain('limit:26');
  });
});
