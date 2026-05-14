import { describe, expect, it } from 'vitest';
import { resolveDataSource } from './runtimeEnvironment';

describe('runtime data source selector', () => {
  it('uses mock data by default in test mode', () => {
    expect(resolveDataSource({ viteMode: 'test', nodeEnv: 'test' })).toBe('mock');
  });

  it('uses mock data in local development', () => {
    expect(resolveDataSource({ viteDev: true, viteMode: 'development' })).toBe('mock');
  });

  it('uses Firebase for deployed production runtime', () => {
    expect(resolveDataSource({
      runtimeConfig: { BUILD_ENV: 'production' },
      viteProd: true,
      viteDev: false,
      viteMode: 'production',
      nodeEnv: 'production',
    })).toBe('firebase');
  });

  it('allows tests to explicitly force Firebase behavior', () => {
    expect(resolveDataSource({
      runtimeConfig: { DATA_SOURCE: 'firebase' },
      viteMode: 'test',
      nodeEnv: 'test',
    })).toBe('firebase');
  });

  it('never allows production to resolve mock data even with an explicit mock override', () => {
    expect(resolveDataSource({
      runtimeConfig: { DATA_SOURCE: 'mock', BUILD_ENV: 'production' },
      viteProd: true,
    })).toBe('firebase');

    expect(resolveDataSource({
      runtimeConfig: { BUILD_ENV: 'production' },
      viteDataSource: 'mock',
      viteProd: true,
    })).toBe('firebase');
  });
});
