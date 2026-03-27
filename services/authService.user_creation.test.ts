import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const setupBackendService = async (createStudioUserPayload: unknown) => {
  vi.resetModules();

  vi.doMock('./logger', () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      getCorrelationId: () => 'corr-create-user',
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

  const callableSpy = vi.fn(async () => ({ data: createStudioUserPayload }));
  const httpsCallableSpy = vi.fn(() => callableSpy);

  vi.doMock('firebase/functions', () => ({
    httpsCallable: httpsCallableSpy,
  }));

  vi.doMock('./firebase', () => ({
    functions: { __mock: true },
    buildFunctionsHttpUrl: (name: string) => `https://example.test/functions/${name}`,
  }));

  const module = await import('./authService');
  return { authService: module.authService, callableSpy, httpsCallableSpy };
};

const setupLocalService = async () => {
  vi.resetModules();

  vi.doMock('./logger', () => ({
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      getCorrelationId: () => 'corr-local-user',
      maskPII: (value: unknown) => value,
    },
  }));

  vi.doMock('./runtimeConfig', () => ({
    areLocalMocksExplicitlyEnabled: () => true,
    assertNoMocksInNonDev: vi.fn(),
    assertRealAuthInDeployedEnv: vi.fn(),
    isDeployedRuntime: () => false,
    logRuntimeMode: vi.fn(),
  }));

  vi.doMock('./firebase', () => ({
    functions: undefined,
    buildFunctionsHttpUrl: (name: string) => `https://example.test/functions/${name}`,
  }));

  const module = await import('./authService');
  return module.authService;
};

describe('authService user creation notifications and token policies', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses authoritative createStudioUser path and returns delivery data for both channels', async () => {
    localStorage.setItem('cruzpham_active_session_id', 'session-1');
    const payload = {
      rawToken: 'pk-123',
      user: {
        id: 'user-1',
        username: 'producer1',
        tokenHash: '',
        role: 'PRODUCER',
        status: 'ACTIVE',
        email: 'producer@test.dev',
        phone: '+15550001111',
        profile: { source: 'MANUAL_CREATE' },
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      delivery: {
        SMS: { status: 'SENT' },
        EMAIL: { status: 'SENT' },
      },
      deliveryStatus: 'SENT',
    };

    const { authService, callableSpy, httpsCallableSpy } = await setupBackendService(payload);

    const result = await authService.createUserWithNotifications(
      'master',
      {
        username: 'producer1',
        email: 'producer@test.dev',
        phone: '+15550001111',
        profile: { source: 'MANUAL_CREATE' },
      },
      'PRODUCER',
      undefined,
      ['SMS', 'EMAIL'],
    );

    expect(result.rawToken).toBe('pk-123');
    expect(result.delivery.SMS?.status).toBe('SENT');
    expect(result.delivery.EMAIL?.status).toBe('SENT');
    expect(result.deliveryStatus).toBe('SENT');

    expect(httpsCallableSpy).toHaveBeenCalledTimes(1);
    expect(httpsCallableSpy).toHaveBeenCalledWith({ __mock: true }, 'createStudioUser');
    expect(callableSpy).toHaveBeenCalledTimes(1);
    expect(callableSpy).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'session-1',
      channels: ['SMS', 'EMAIL'],
    }));
  });

  it('keeps permanent tokens valid and expires temporary tokens through backend-compatible expiry checks', async () => {
    const authService = await setupLocalService();
    await authService.bootstrapMasterAdmin('master');

    const permanentToken = await authService.createUser('master', {
      username: 'permanent-user',
      phone: '+15550002222',
      profile: { source: 'MANUAL_CREATE' },
    }, 'PRODUCER');

    const permanentLogin = await authService.login('permanent-user', permanentToken);
    expect(permanentLogin.success).toBe(true);

    const temporaryToken = await authService.createUser('master', {
      username: 'temporary-user',
      phone: '+15550003333',
      profile: { source: 'MANUAL_CREATE' },
    }, 'PRODUCER', 1);

    const temporaryBeforeExpiry = await authService.login('temporary-user', temporaryToken);
    expect(temporaryBeforeExpiry.success).toBe(true);

    const users = JSON.parse(localStorage.getItem('cruzpham_db_users') || '[]');
    const updatedUsers = users.map((entry: any) => entry.username === 'temporary-user'
      ? { ...entry, expiresAt: new Date(Date.now() - 1_000).toISOString() }
      : entry);
    localStorage.setItem('cruzpham_db_users', JSON.stringify(updatedUsers));

    const temporaryAfterExpiry = await authService.login('temporary-user', temporaryToken);
    expect(temporaryAfterExpiry.success).toBe(false);
    expect(temporaryAfterExpiry.code).toBe('ERR_SESSION_EXPIRED');
  });
});

