import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';

describe('POST /api/v1/auth/login', () => {
  it('returns 400 for invalid payload', async () => {
    const request = new NextRequest('https://example.com/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email: 'bad-email', password: 'short' }),
      headers: {
        'content-type': 'application/json'
      }
    });

    const response = await POST(request);
    expect(response.status).toBe(400);

    const payload = (await response.json()) as { error: { code: string } };
    expect(payload.error.code).toBe('VALIDATION_ERROR');
  });
});
