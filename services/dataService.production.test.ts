import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('dataService production data source', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    (window as any).__RUNTIME_CONFIG__ = { DATA_SOURCE: 'firebase' };
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    delete (window as any).__RUNTIME_CONFIG__;
  });

  it('loads shows from Firebase-backed production API instead of local mock storage', async () => {
    const originalGetItem = Storage.prototype.getItem;
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
    getItemSpy.mockImplementation(function (this: Storage, key: string) {
      if (key === 'cruzpham_db_shows' || key === 'cruzpham_db_templates') {
        throw new Error(`mock db key read in production: ${key}`);
      }
      return Reflect.apply(originalGetItem, this, [key]);
    });

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      success: true,
      data: [{ id: 'show-1', userId: 'admin', title: 'Production Show', createdAt: '2026-05-10T00:00:00.000Z' }],
    }));

    const { dataService } = await import('./dataService');
    const shows = await dataService.getShowsForUserAsync('admin');

    expect(shows).toHaveLength(1);
    expect(shows[0].title).toBe('Production Show');
    expect(fetch).toHaveBeenCalledWith('/api/shows?username=admin', expect.any(Object));
  });

  it('ignores a mock data source override in production and still uses Firebase API', async () => {
    localStorage.setItem('cruzpham_db_shows', JSON.stringify([
      { id: 'mock-show', userId: 'admin', title: 'Mock Show', createdAt: '2026-05-09T00:00:00.000Z' },
    ]));
    (window as any).__RUNTIME_CONFIG__ = { BUILD_ENV: 'production', DATA_SOURCE: 'mock' };

    const originalGetItem = Storage.prototype.getItem;
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
    getItemSpy.mockImplementation(function (this: Storage, key: string) {
      if (key === 'cruzpham_db_shows' || key === 'cruzpham_db_templates') {
        throw new Error(`mock db key read in production: ${key}`);
      }
      return Reflect.apply(originalGetItem, this, [key]);
    });

    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      success: true,
      data: [{ id: 'show-1', userId: 'admin', title: 'Production Show', createdAt: '2026-05-10T00:00:00.000Z' }],
    }));

    const { dataService } = await import('./dataService');
    const shows = await dataService.getShowsForUserAsync('admin');

    expect(shows.map((show) => show.title)).toEqual(['Production Show']);
    expect(fetch).toHaveBeenCalledWith('/api/shows?username=admin', expect.any(Object));
  });

  it('creates templates through production API and preserves UI-compatible shape', async () => {
    vi.mocked(fetch).mockResolvedValueOnce(jsonResponse({
      success: true,
      data: {
        id: 'template-1',
        showId: 'show-1',
        topic: 'Finals',
        config: { playerCount: 2, categoryCount: 1, rowCount: 1 },
        categories: [],
        createdAt: '2026-05-10T00:00:00.000Z',
      },
    }));

    const { dataService } = await import('./dataService');
    const template = await dataService.createTemplate('show-1', 'Finals', {
      playerCount: 2,
      categoryCount: 1,
      rowCount: 1,
    }, []);

    expect(template.topic).toBe('Finals');
    expect(fetch).toHaveBeenCalledWith('/api/templates', expect.objectContaining({ method: 'POST' }));
  });
});
