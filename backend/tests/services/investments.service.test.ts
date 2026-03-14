import { describe, expect, it, vi } from 'vitest';
import { NotFoundError } from '@/errors/NotFoundError';
import { InvestmentsService } from '@/services/investments/service';
import { createServiceContext } from '../utils/context';

describe('InvestmentsService', () => {
  it('throws when a requested investment does not exist', async () => {
    const repository = {
      list: vi.fn(),
      create: vi.fn(),
      findById: vi.fn(async () => null)
    };
    const service = new InvestmentsService(createServiceContext(), repository as never);

    await expect(service.getById('missing-investment')).rejects.toBeInstanceOf(NotFoundError);
  });
});
