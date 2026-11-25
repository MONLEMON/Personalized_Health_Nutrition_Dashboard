import { describe, expect, it } from 'bun:test';
import { GET, OPTIONS } from '../../../../../api/index';

describe('Vercel Serverless Hono Handler (api/index.ts)', () => {
  it('serves GET /api/health with HTTP 200', async () => {
    const res = await GET(new Request('https://example.vercel.app/api/health'));
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      status: string;
      storageMode: string;
      timestamp: string;
    };
    expect(body.status).toBe('ok');
    expect(['postgres', 'memory']).toContain(body.storageMode);
    expect(typeof body.timestamp).toBe('string');
  });

  it('rejects unauthenticated GET /api/dashboard/today with HTTP 401', async () => {
    const res = await GET(new Request('https://example.vercel.app/api/dashboard/today'));
    expect(res.status).toBe(401);

    const body = (await res.json()) as { error: string };
    expect(body.error.toLowerCase()).toContain('unauthorized');
  });

  it('handles CORS preflight OPTIONS and allows X-API-Key header', async () => {
    const res = await OPTIONS(
      new Request('https://example.vercel.app/api/webhooks/apple-health', {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.vercel.app',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'X-API-Key, Content-Type',
        },
      }),
    );

    expect(res.status).toBe(204);
    const allowHeaders = res.headers.get('Access-Control-Allow-Headers') ?? '';
    expect(allowHeaders).toContain('X-API-Key');
    expect(allowHeaders).toContain('Authorization');
  });
});
