
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

// Mock Logger to prevent noise during test execution
vi.mock('./logger', () => ({
  logger: { 
    info: vi.fn(), 
    error: vi.fn(), 
    warn: vi.fn(), 
    getCorrelationId: () => 'test-id' 
  }
}));

// Mock Firebase SDKs to prevent network calls/errors during init
vi.mock('firebase/app', () => ({
  initializeApp: vi.fn(() => ({ name: '[DEFAULT]' })),
  getApps: vi.fn(() => []),
  FirebaseApp: vi.fn()
}));
vi.mock('firebase/firestore', () => ({
  getFirestore: vi.fn(() => ({}))
}));
vi.mock('firebase/functions', () => ({
  getFunctions: vi.fn(() => ({}))
}));
vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({})),
  signInAnonymously: vi.fn().mockResolvedValue({})
}));

describe('SYSTEM: Configuration & Initialization', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
    (window as any).__RUNTIME_CONFIG__ = undefined;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('FAIL: Reports error when Runtime Config is missing', async () => {
    // Clear runtime config and reload
    delete (window as any).__RUNTIME_CONFIG__;
    const { initializeApp } = await import('firebase/app');
    const { firebaseConfigError, missingKeys } = await import('./firebase');
    expect(firebaseConfigError).toBe(true);
    expect(missingKeys).toContain('FIREBASE_API_KEY');
    expect(missingKeys).toContain('FIREBASE_PROJECT_ID');
    expect(initializeApp).not.toHaveBeenCalled();
  });

  it('FAIL: Reports error when keys are placeholders', async () => {
    (window as any).__RUNTIME_CONFIG__ = {
      FIREBASE_API_KEY: '__FIREBASE_API_KEY__', // Placeholder
      FIREBASE_AUTH_DOMAIN: 'valid-domain',
      // ... missing others
    };

    vi.resetModules();
    const { firebaseConfigError, missingKeys } = await import('./firebase');
    expect(firebaseConfigError).toBe(true);
    expect(missingKeys).toContain('FIREBASE_API_KEY');
  });

  it('SUCCESS: Initializes App when config is valid', async () => {
    (window as any).__RUNTIME_CONFIG__ = {
      FIREBASE_API_KEY: 'AIzaSyTestKey',
      FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
      FIREBASE_PROJECT_ID: 'test-project',
      FIREBASE_STORAGE_BUCKET: 'test.appspot.com',
      FIREBASE_MESSAGING_SENDER_ID: '123456789',
      FIREBASE_APP_ID: '1:123456789:web:abcdef'
    };

    vi.resetModules();
    const { initializeApp } = await import('firebase/app');
    const { firebaseConfigError, app, projectId } = await import('./firebase');
    
    if (firebaseConfigError) {
      throw new Error('Expected valid config but got error');
    }

    expect(firebaseConfigError).toBe(false);
    expect(app).toBeDefined();
    expect(projectId).toBe('test-project');
    expect(initializeApp).toHaveBeenCalledTimes(1);
    expect(initializeApp).toHaveBeenCalledWith({
      apiKey: 'AIzaSyTestKey',
      authDomain: 'test.firebaseapp.com',
      projectId: 'test-project',
      storageBucket: 'test.appspot.com',
      messagingSenderId: '123456789',
      appId: '1:123456789:web:abcdef',
    });
  });
});
