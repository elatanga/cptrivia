import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolveGeminiApiKey, getGeminiConfigHealth } from './geminiService';
import { AppError } from '../types';
import { logger } from './logger';

describe('geminiService API key resolution', () => {
  const originalApiKey = process.env.API_KEY;
  const originalGeminiApiKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    process.env.API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    (window as any).__RUNTIME_CONFIG__ = undefined;
  });

  afterEach(() => {
    process.env.API_KEY = originalApiKey;
    process.env.GEMINI_API_KEY = originalGeminiApiKey;
    (window as any).__RUNTIME_CONFIG__ = undefined;
  });

  it('prefers runtime-config API_KEY when present', () => {
    (window as any).__RUNTIME_CONFIG__ = { API_KEY: 'runtime-key-123' };
    process.env.API_KEY = 'process-key-456';

    expect(resolveGeminiApiKey()).toBe('runtime-key-123');
  });

  it('falls back to process env when runtime key is placeholder', () => {
    (window as any).__RUNTIME_CONFIG__ = { API_KEY: 'PLACEHOLDER_API_KEY' };
    process.env.GEMINI_API_KEY = 'process-gemini-key-xyz';

    expect(resolveGeminiApiKey()).toBe('process-gemini-key-xyz');
  });

  it('accepts GEMINI_API_KEY from runtime config when API_KEY is not present', () => {
    (window as any).__RUNTIME_CONFIG__ = { GEMINI_API_KEY: 'runtime-gemini-key-abc' };
    expect(resolveGeminiApiKey()).toBe('runtime-gemini-key-abc');
  });

  it('throws AppError when no usable key exists', () => {
    const loggerErrorSpy = vi.spyOn(logger, 'error').mockImplementation(() => {});
    (window as any).__RUNTIME_CONFIG__ = { API_KEY: '...' };
    process.env.API_KEY = '';
    process.env.GEMINI_API_KEY = '';

    try {
      resolveGeminiApiKey();
      throw new Error('Expected resolveGeminiApiKey to throw');
    } catch (error: any) {
      expect(error).toBeInstanceOf(AppError);
      expect(error.code).toBe('ERR_FORBIDDEN');
      expect(error.message).toContain('GEMINI_API_KEY');
    }

    const [, payload] = loggerErrorSpy.mock.calls[0];
    expect(payload).not.toHaveProperty('API_KEY');
    expect(payload).not.toHaveProperty('GEMINI_API_KEY');
    loggerErrorSpy.mockRestore();
  });

  it('reports health ready when a usable key exists', () => {
    (window as any).__RUNTIME_CONFIG__ = { API_KEY: 'runtime-key-123' };
    expect(getGeminiConfigHealth()).toEqual({ ready: true, message: 'AI ready' });
  });

  it('reports health not-ready when no usable key exists', () => {
    (window as any).__RUNTIME_CONFIG__ = { API_KEY: '...' };
    const health = getGeminiConfigHealth();
    expect(health.ready).toBe(false);
    expect(health.message).toContain('GEMINI_API_KEY');
  });
});

