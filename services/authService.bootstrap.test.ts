import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchMock = vi.fn();

const setupBackendMode = async () => {
  vi.resetModules();

  vi.doMock('./logger', () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      getCorrelationId: () => 'corr-test-1',
      maskPII: (value: unknown) => value,
    },
  }));

  vi.doMock('./runtimeConfig', () => ({
    areLocalMocksExplicitlyEnabled: () => false,
    assertNoMocksInNonDev: vi.fn(),
    assertRealAuthInDeployedEnv: vi.fn(),
    isDeployedRuntime: () => true,
    logRuntimeMode: vi.fn(),
  }));

  vi.doMock('./firebase', () => ({
    functions: { __mock: true },
    buildFunctionsHttpUrl: (name: string) => `https://example.test/functions/${name}`,
  }));

  const module = await import('./authService');
  return module.authService;
};

const setupBackendModeWithoutFunctionsSdk = async () => {
  vi.resetModules();

  vi.doMock('./logger', () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      getCorrelationId: () => 'corr-test-2',
      maskPII: (value: unknown) => value,
    },
  }));

  vi.doMock('./runtimeConfig', () => ({
    areLocalMocksExplicitlyEnabled: () => false,
    assertNoMocksInNonDev: vi.fn(),
    assertRealAuthInDeployedEnv: vi.fn(),
    isDeployedRuntime: () => true,
    logRuntimeMode: vi.fn(),
  }));

  vi.doMock('./firebase', () => ({
    functions: undefined,
    buildFunctionsHttpUrl: (name: string) => `https://example.test/functions/${name}`,
  }));

  const module = await import('./authService');
  return module.authService;
};

describe('authService bootstrap backend classification', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('returns token on bootstrap success', async () => {
    const authService = await setupBackendMode();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ token: 'mk-success-token' }),
    } as Response);

    await expect(authService.bootstrapMasterAdmin('admin')).resolves.toBe('mk-success-token');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps 409 response to ERR_BOOTSTRAP_COMPLETE', async () => {
    const authService = await setupBackendMode();

    fetchMock.mockResolvedValue({
      ok: false,
      status: 409,
      json: async () => ({ message: 'System already bootstrapped.' }),
    } as Response);

    await expect(authService.bootstrapMasterAdmin('admin')).rejects.toMatchObject({
      code: 'ERR_BOOTSTRAP_COMPLETE',
      message: 'System already bootstrapped.',
    });
  });

  it('maps non-409 already-bootstrapped message to ERR_BOOTSTRAP_COMPLETE', async () => {
    const authService = await setupBackendMode();

    fetchMock.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ message: 'Studio is already bootstrapped in this environment.' }),
    } as Response);

    await expect(authService.bootstrapMasterAdmin('admin')).rejects.toMatchObject({
      code: 'ERR_BOOTSTRAP_COMPLETE',
    });
  });

  it('maps fetch rejection to ERR_NETWORK transport failure', async () => {
    const authService = await setupBackendMode();

    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

    await expect(authService.bootstrapMasterAdmin('admin')).rejects.toMatchObject({
      code: 'ERR_NETWORK',
    });
  });

  it('maps unexpected backend failure to ERR_UNKNOWN', async () => {
    const authService = await setupBackendMode();

    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      json: async () => ({ error: 'Internal bootstrap failure' }),
    } as Response);

    await expect(authService.bootstrapMasterAdmin('admin')).rejects.toMatchObject({
      code: 'ERR_UNKNOWN',
      message: 'Internal bootstrap failure',
    });
  });

  it('keeps getBootstrapStatus authoritative in deployed mode even when Firebase SDK is unavailable', async () => {
    const authService = await setupBackendModeWithoutFunctionsSdk();

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        bootstrapCompleted: true,
        masterReady: true,
        masterAdminUserId: 'uid-master',
      }),
    } as Response);

    const status = await authService.getBootstrapStatus();
    expect(status.masterReady).toBe(true);
    expect(status.bootstrapCompleted).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

