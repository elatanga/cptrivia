import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolveGeminiApiKey, resolveGeminiModel, getGeminiConfigHealth } from './geminiService';
import { AppError } from '../types';

describe('geminiService API key resolution', () => {
  const originalApiKey = process.env.API_KEY;
  const originalGeminiApiKey = process.env.GEMINI_API_KEY;
  const originalGeminiModel = process.env.GEMINI_MODEL;

  beforeEach(() => {
    process.env.API_KEY = '';
    process.env.GEMINI_API_KEY = '';
    process.env.GEMINI_MODEL = '';
    (window as any).__RUNTIME_CONFIG__ = undefined;
  });

  afterEach(() => {
    process.env.API_KEY = originalApiKey;
    process.env.GEMINI_API_KEY = originalGeminiApiKey;
    process.env.GEMINI_MODEL = originalGeminiModel;
    (window as any).__RUNTIME_CONFIG__ = undefined;
  });

  it('resolves official Gemini 3.1 model when configured', () => {
    (window as any).__RUNTIME_CONFIG__ = { GEMINI_MODEL: 'gemini-3.1-pro-preview' };
    expect(resolveGeminiModel()).toBe('gemini-3.1-pro-preview');
  });

  it('falls back to Gemini 3.1 Pro when model is outdated', () => {
    process.env.GEMINI_MODEL = 'gemini-3-flash-preview';
    expect(resolveGeminiModel()).toBe('gemini-3.1-pro-preview');
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

  it('throws AppError when no usable key exists', () => {
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

