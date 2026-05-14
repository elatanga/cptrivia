import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppError } from '../types';

vi.mock('./logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    getCorrelationId: () => 'test-correlation',
  },
}));

const jsonResponse = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });

describe('authService production data source', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    (window as any).__RUNTIME_CONFIG__ = { DATA_SOURCE: 'firebase' };
    vi.stubGlobal('fetch', vi.fn());
  });

  it('submits token requests through the production API without reading mock DB keys', async () => {
    const originalGetItem = Storage.prototype.getItem;
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
    getItemSpy.mockImplementation(function (this: Storage, key: string) {
      if (key.startsWith('cruzpham_db_') || key === 'cruzpham_sys_bootstrap') {
        throw new Error(`mock db key read in production: ${key}`);
      }
      return Reflect.apply(originalGetItem, this, [key]);
    });

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        id: 'REQ123',
        firstName: 'Ada',
        lastName: 'Lovelace',
        tiktokHandle: 'ada',
        preferredUsername: 'ada',
        phoneE164: '+15550001111',
        status: 'PENDING',
        createdAt: '2026-05-10T00:00:00.000Z',
        updatedAt: '2026-05-10T00:00:00.000Z',
        adminNotifyStatus: 'SENT',
        userNotifyStatus: 'PENDING',
      },
    }));

    const { authService } = await import('./authService');
    const result = await authService.submitTokenRequest({
      firstName: 'Ada',
      lastName: 'Lovelace',
      tiktokHandle: 'ada',
      preferredUsername: 'ada',
      phoneE164: '+15550001111',
    });

    expect(result.id).toBe('REQ123');
    expect(fetch).toHaveBeenCalledWith('/api/token-requests', expect.objectContaining({
      method: 'POST',
    }));
  });

  it('uses the production API for bootstrap and returns the existing response shape', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      success: true,
      data: { token: 'mk-production-token' },
    }));

    const { authService } = await import('./authService');
    await expect(authService.bootstrapMasterAdmin('master')).resolves.toBe('mk-production-token');
    expect(fetch).toHaveBeenCalledWith('/api/bootstrap/master', expect.objectContaining({ method: 'POST' }));
  });

  it('returns friendly delivery failure errors without provider internals', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      success: false,
      code: 'ERR_PROVIDER_DOWN',
      message: 'SMS delivery failed.',
    }, 502));

    const { authService } = await import('./authService');
    await expect(authService.sendMessage('admin', 'producer', 'SMS', 'secret token pk-abcdef123456'))
      .rejects
      .toMatchObject({ code: 'ERR_PROVIDER_DOWN', message: 'SMS delivery failed.' } satisfies Partial<AppError>);
  });
});
