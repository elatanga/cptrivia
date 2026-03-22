import { describe, expect, it, vi } from 'vitest';
import systemStatusHttp from './systemStatusHttp.js';

const { createSystemStatusCorsPolicy, createGetSystemStatusHandler } = systemStatusHttp as {
  createSystemStatusCorsPolicy: (params: {
    projectId?: string;
    extraAllowedOrigins?: string[];
    allowLocalhostCors?: boolean;
  }) => {
    isAllowedOrigin: (origin?: string) => boolean;
    setCorsHeaders: (req: any, res: any, origin?: string) => void;
  };
  createGetSystemStatusHandler: (params: {
    getBootstrapState: () => Promise<any>;
    log: (...args: any[]) => void;
    getCorrelationIdFromHttpRequest: (req: any) => string;
    corsPolicy: { isAllowedOrigin: (origin?: string) => boolean; setCorsHeaders: (req: any, res: any, origin?: string) => void };
  }) => (req: any, res: any) => Promise<void>;
};

const createMockReq = ({ method, origin, requestedHeaders }: { method: string; origin?: string; requestedHeaders?: string }) => ({
  method,
  get: (header: string) => {
    if (header === 'Origin') return origin || '';
    if (header === 'Access-Control-Request-Headers') return requestedHeaders;
    return undefined;
  },
  body: {},
});

const createMockRes = () => {
  const headers: Record<string, string> = {};
  const res: any = {
    statusCode: 200,
    body: null,
    headers,
    set: (key: string, value: string) => {
      headers[key] = value;
      return res;
    },
    status: (code: number) => {
      res.statusCode = code;
      return res;
    },
    json: (payload: any) => {
      res.body = payload;
      return res;
    },
    send: (payload: any) => {
      res.body = payload;
      return res;
    },
  };
  return res;
};

describe('getSystemStatus CORS', () => {
  const allowedOrigin = 'https://cptrivia-test--cruzpham-trivia-prod.us-central1.hosted.app';

  const buildHandler = (getBootstrapState: () => Promise<any>) => {
    const corsPolicy = createSystemStatusCorsPolicy({
      projectId: '',
      extraAllowedOrigins: [],
      allowLocalhostCors: false,
    });

    return createGetSystemStatusHandler({
      getBootstrapState,
      corsPolicy,
      log: vi.fn(),
      getCorrelationIdFromHttpRequest: () => 'test-correlation-id',
    });
  };

  it('allowed origin receives CORS headers on GET', async () => {
    const handler = buildHandler(async () => ({ bootstrapCompleted: false }));
    const req = createMockReq({ method: 'GET', origin: allowedOrigin });
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.headers['Access-Control-Allow-Origin']).toBe(allowedOrigin);
    expect(res.headers['Access-Control-Allow-Methods']).toBe('GET, OPTIONS');
    expect(res.headers['Vary']).toContain('Origin');
  });

  it('OPTIONS preflight succeeds with expected headers', async () => {
    const handler = buildHandler(async () => ({ bootstrapCompleted: false }));
    const req = createMockReq({
      method: 'OPTIONS',
      origin: allowedOrigin,
      requestedHeaders: 'Content-Type, X-Firebase-AppCheck',
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(res.headers['Access-Control-Allow-Origin']).toBe(allowedOrigin);
    expect(res.headers['Access-Control-Allow-Headers']).toBe('Content-Type, X-Firebase-AppCheck');
    expect(res.headers['Access-Control-Allow-Methods']).toBe('GET, OPTIONS');
    expect(res.headers['Cache-Control']).toBe('no-store');
  });

  it('disallowed origin rejection includes CORS headers (CRITICAL FIX)', async () => {
    const corsPolicy = createSystemStatusCorsPolicy({
      projectId: '',
      extraAllowedOrigins: [allowedOrigin],
      allowLocalhostCors: false,
    });

    const handler = createGetSystemStatusHandler({
      getBootstrapState: async () => ({ bootstrapCompleted: false }),
      corsPolicy,
      log: vi.fn(),
      getCorrelationIdFromHttpRequest: () => 'test-correlation-id',
    });

    const disallowedOrigin = 'https://evil.example.com';
    const req = createMockReq({ method: 'GET', origin: disallowedOrigin });
    const res = createMockRes();

    await handler(req, res);

    // Must return 403, but WITH CORS headers set
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ error: 'Origin not allowed' });
    // CRITICAL: Even though origin is disallowed, response must include CORS headers
    // so browser doesn't block the response. The origin check is on server side.
    expect(res.headers['Access-Control-Allow-Methods']).toBe('GET, OPTIONS');
    expect(res.headers['Vary']).toBe('Origin, Access-Control-Request-Headers');
  });

  it('invalid method rejection includes CORS headers', async () => {
    const handler = buildHandler(async () => ({ bootstrapCompleted: false }));
    const req = createMockReq({ method: 'POST', origin: allowedOrigin });
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
    expect(res.headers['Access-Control-Allow-Origin']).toBe(allowedOrigin);
    expect(res.headers['Access-Control-Allow-Methods']).toBe('GET, OPTIONS');
  });

  it('normal success response shape is preserved', async () => {
    const state = {
      bootstrapCompleted: true,
      masterReady: true,
      masterAdminUserId: 'master-1',
      initializedAt: '2026-03-22T00:00:00.000Z',
    };
    const handler = buildHandler(async () => state);
    const req = createMockReq({ method: 'GET', origin: allowedOrigin });
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      initialized: true,
      data: state,
      result: state,
      bootstrapCompleted: true,
      masterReady: true,
    });
  });

  it('error response still includes CORS headers for allowed origin', async () => {
    const handler = buildHandler(async () => {
      throw new Error('db unavailable');
    });
    const req = createMockReq({ method: 'GET', origin: allowedOrigin });
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Unable to load system status' });
    expect(res.headers['Access-Control-Allow-Origin']).toBe(allowedOrigin);
    expect(res.headers['Access-Control-Allow-Methods']).toBe('GET, OPTIONS');
  });
});

