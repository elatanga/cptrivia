import { describe, expect, it, vi } from 'vitest';
import systemStatusHttp from './systemStatusHttp.js';

const { createSystemStatusCorsPolicy, createBootstrapSystemHandler } = systemStatusHttp as {
  createSystemStatusCorsPolicy: (params: {
    projectId?: string;
    extraAllowedOrigins?: string[];
    allowLocalhostCors?: boolean;
  }) => {
    isAllowedOrigin: (origin?: string) => boolean;
    setCorsHeaders: (req: any, res: any, origin?: string, allowedMethods?: string) => void;
  };
  createBootstrapSystemHandler: (params: {
    bootstrapSystem: (params: { username: string; correlationId: string }) => Promise<{ token: string }>;
    sanitizeUsername: (value: string, label?: string) => string;
    log: (...args: any[]) => void;
    getCorrelationIdFromHttpRequest: (req: any) => string;
    corsPolicy: { isAllowedOrigin: (origin?: string) => boolean; setCorsHeaders: (req: any, res: any, origin?: string, allowedMethods?: string) => void };
  }) => (req: any, res: any) => Promise<void>;
};

const createMockReq = ({ method, origin, requestedHeaders, body }: { method: string; origin?: string; requestedHeaders?: string; body?: any }) => ({
  method,
  body: body || {},
  get: (header: string) => {
    if (header === 'Origin') return origin || '';
    if (header === 'Access-Control-Request-Headers') return requestedHeaders;
    return undefined;
  },
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

describe('bootstrapSystem HTTP CORS', () => {
  const allowedOrigin = 'https://cptrivia-test--cruzpham-trivia-prod.us-central1.hosted.app';

  const buildHandler = (bootstrapSystem: (params: { username: string; correlationId: string }) => Promise<{ token: string }>) => {
    const corsPolicy = createSystemStatusCorsPolicy({
      projectId: '',
      extraAllowedOrigins: [allowedOrigin],
      allowLocalhostCors: false,
    });

    return createBootstrapSystemHandler({
      bootstrapSystem,
      sanitizeUsername: (value: string) => String(value || '').trim(),
      corsPolicy,
      log: vi.fn(),
      getCorrelationIdFromHttpRequest: () => 'test-correlation-id',
    });
  };

  it('allowed origin receives CORS headers on POST success', async () => {
    const handler = buildHandler(async () => ({ token: 'mk-test-token' }));
    const req = createMockReq({ method: 'POST', origin: allowedOrigin, body: { username: 'admin' } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({ token: 'mk-test-token' });
    expect(res.headers['Access-Control-Allow-Origin']).toBe(allowedOrigin);
    expect(res.headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
  });

  it('OPTIONS preflight for bootstrapSystem succeeds', async () => {
    const handler = buildHandler(async () => ({ token: 'mk-test-token' }));
    const req = createMockReq({
      method: 'OPTIONS',
      origin: allowedOrigin,
      requestedHeaders: 'content-type, x-firebase-gmpid',
    });
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(204);
    expect(res.body).toBe('');
    expect(res.headers['Access-Control-Allow-Origin']).toBe(allowedOrigin);
    expect(res.headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
    expect(res.headers['Access-Control-Allow-Headers']).toBe('content-type, x-firebase-gmpid');
  });

  it('already-bootstrapped response is preserved with CORS headers', async () => {
    const handler = buildHandler(async () => {
      const error: any = new Error('System already bootstrapped');
      error.code = 'already-exists';
      throw error;
    });
    const req = createMockReq({ method: 'POST', origin: allowedOrigin, body: { username: 'admin' } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(409);
    expect(res.body).toEqual({ error: 'System already bootstrapped', code: 'already-exists' });
    expect(res.headers['Access-Control-Allow-Origin']).toBe(allowedOrigin);
    expect(res.headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
  });

  it('error path includes CORS headers', async () => {
    const handler = buildHandler(async () => {
      throw new Error('db failure');
    });
    const req = createMockReq({ method: 'POST', origin: allowedOrigin, body: { username: 'admin' } });
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ error: 'Unable to bootstrap system' });
    expect(res.headers['Access-Control-Allow-Origin']).toBe(allowedOrigin);
    expect(res.headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
  });

  it('rejects invalid methods with CORS headers', async () => {
    const handler = buildHandler(async () => ({ token: 'mk-test-token' }));
    const req = createMockReq({ method: 'GET', origin: allowedOrigin });
    const res = createMockRes();

    await handler(req, res);

    expect(res.statusCode).toBe(405);
    expect(res.body).toEqual({ error: 'Method not allowed' });
    expect(res.headers['Access-Control-Allow-Origin']).toBe(allowedOrigin);
    expect(res.headers['Access-Control-Allow-Methods']).toBe('POST, OPTIONS');
  });
});

