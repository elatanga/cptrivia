
import { vi } from 'vitest';

declare const describe: any;
declare const test: any;
declare const expect: any;
declare const beforeEach: any;
declare const afterAll: any;

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

  test('FAIL: Reports error when Runtime Config is missing', async () => {
    const firebaseModule: any = await import('./firebase');
    expect(firebaseModule.firebaseConfigError).toBe(true);
    expect(firebaseModule.missingKeys).toContain('FIREBASE_API_KEY');
    expect(firebaseModule.missingKeys).toContain('FIREBASE_PROJECT_ID');
  });

  test('FAIL: Reports error when keys are placeholders', async () => {
    (window as any).__RUNTIME_CONFIG__ = {
      FIREBASE_API_KEY: '...',
      FIREBASE_AUTH_DOMAIN: 'valid-domain',
      // ... missing others
    };

    const firebaseModule: any = await import('./firebase');
    expect(firebaseModule.firebaseConfigError).toBe(true);
    expect(firebaseModule.missingKeys).toContain('FIREBASE_API_KEY');
  });

  test('SUCCESS: Initializes App when config is valid', async () => {
    (window as any).__RUNTIME_CONFIG__ = {
      FIREBASE_API_KEY: 'AIzaSyTestKey',
      FIREBASE_AUTH_DOMAIN: 'test.firebaseapp.com',
      FIREBASE_PROJECT_ID: 'test-project',
      FIREBASE_STORAGE_BUCKET: 'test.appspot.com',
      FIREBASE_MESSAGING_SENDER_ID: '123456789',
      FIREBASE_APP_ID: '1:123456789:web:abcdef',
      FUNCTIONS_REGION: 'us-central1'
    };

    const firebaseModule: any = await import('./firebase');
    
    if (firebaseModule.firebaseConfigError) {
      throw new Error('Expected valid config but got error');
    }

    expect(firebaseModule.firebaseConfigError).toBe(false);
    expect(firebaseModule.app).toBeDefined();
    expect(firebaseModule.projectId).toBe('test-project');
    expect(firebaseModule.resolvedFunctionsTarget).toBe('us-central1');
    expect(firebaseModule.buildFunctionsHttpUrl('getSystemStatus')).toBe('https://us-central1-test-project.cloudfunctions.net/getSystemStatus');
  });
});
