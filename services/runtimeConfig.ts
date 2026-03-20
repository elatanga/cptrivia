import { logger } from './logger';

declare global {
  interface Window {
    __RUNTIME_CONFIG__?: Record<string, unknown>;
  }
}

export type RuntimeEnvironment = 'production' | 'staging' | 'test' | 'development' | 'unit-test';

export interface RuntimeConfigShape {
  FIREBASE_API_KEY?: string;
  FIREBASE_AUTH_DOMAIN?: string;
  FIREBASE_PROJECT_ID?: string;
  FIREBASE_STORAGE_BUCKET?: string;
  FIREBASE_MESSAGING_SENDER_ID?: string;
  FIREBASE_APP_ID?: string;
  API_KEY?: string;
  BUILD_ENV?: string;
  BUILD_VERSION?: string;
  ALLOW_LOCAL_MOCKS?: string | boolean;
  ENABLE_FIREBASE_ANON_AUTH?: string | boolean;
  [key: string]: unknown;
}

const readRuntimeConfig = (): RuntimeConfigShape => {
  if (typeof window !== 'undefined' && window.__RUNTIME_CONFIG__) {
    return window.__RUNTIME_CONFIG__ as RuntimeConfigShape;
  }
  return {};
};

const runtimeConfig = readRuntimeConfig();

const importMetaEnv = (() => {
  try {
    return (import.meta as ImportMeta & { env?: Record<string, string | boolean | undefined> }).env || {};
  } catch {
    return {} as Record<string, string | boolean | undefined>;
  }
})();

const toLower = (value?: unknown) => String(value ?? '').trim().toLowerCase();
const toBoolean = (value?: unknown) => String(value ?? '').trim().toLowerCase() === 'true';

const runtimeHost = (() => {
  if (typeof window === 'undefined') return '';
  return window.location.hostname.toLowerCase();
})();

const isLoopbackHost = runtimeHost === 'localhost' || runtimeHost === '127.0.0.1' || runtimeHost === '::1';
const mode = toLower(importMetaEnv.MODE);
const declaredBuildEnv = toLower(runtimeConfig.BUILD_ENV || importMetaEnv.VITE_BUILD_ENV || importMetaEnv.NODE_ENV);
const vitestDetected = mode === 'test' || typeof (globalThis as any).vitest !== 'undefined' || typeof (globalThis as any).jest !== 'undefined';

export const getRuntimeEnvironment = (): RuntimeEnvironment => {
  if (vitestDetected) return 'unit-test';
  if (declaredBuildEnv === 'production') return 'production';
  if (declaredBuildEnv === 'staging') return 'staging';
  if (declaredBuildEnv === 'test') return 'test';
  if (declaredBuildEnv === 'development' || mode === 'development' || isLoopbackHost || !runtimeHost) return 'development';
  return 'production';
};

export const getRuntimeConfig = (): RuntimeConfigShape => runtimeConfig;
export const isUnitTestRuntime = (): boolean => getRuntimeEnvironment() === 'unit-test';
export const isProductionRuntime = (): boolean => getRuntimeEnvironment() === 'production';
export const isTestRuntime = (): boolean => getRuntimeEnvironment() === 'test';
export const isStagingRuntime = (): boolean => getRuntimeEnvironment() === 'staging';
export const isLocalDevRuntime = (): boolean => getRuntimeEnvironment() === 'development';
export const isDeployedRuntime = (): boolean => isProductionRuntime() || isStagingRuntime() || isTestRuntime();

export const areLocalMocksExplicitlyEnabled = (): boolean => {
  if (isUnitTestRuntime()) return true;
  if (!isLocalDevRuntime()) return false;
  return toBoolean(runtimeConfig.ALLOW_LOCAL_MOCKS) || toBoolean(importMetaEnv.VITE_ALLOW_LOCAL_MOCKS);
};

export const areAnonymousFirebaseAuthFlowsEnabled = (): boolean => {
  if (isUnitTestRuntime()) return true;
  if (isLocalDevRuntime()) {
    return toBoolean(runtimeConfig.ENABLE_FIREBASE_ANON_AUTH) || toBoolean(importMetaEnv.VITE_ENABLE_FIREBASE_ANON_AUTH);
  }
  return false;
};

export const assertNoMocksInNonDev = (pathLabel: string) => {
  if (areLocalMocksExplicitlyEnabled()) return;
  if (isUnitTestRuntime()) return;
  if (isLocalDevRuntime()) {
    logger.warn('[RuntimeGuard] blocked local/mock path because explicit opt-in is missing', {
      pathLabel,
      environment: getRuntimeEnvironment(),
    });
    throw new Error(`Local/mock path \"${pathLabel}\" is disabled. Set ALLOW_LOCAL_MOCKS=true only for explicit local development.`);
  }
  logger.error('[RuntimeGuard] blocked local/mock path in non-dev runtime', {
    pathLabel,
    environment: getRuntimeEnvironment(),
  });
  throw new Error(`Local/mock path \"${pathLabel}\" is not allowed in ${getRuntimeEnvironment()} runtime.`);
};

export const assertRealAuthInDeployedEnv = (pathLabel: string, condition: boolean) => {
  if (!isDeployedRuntime()) return;
  if (condition) return;
  logger.error('[RuntimeGuard] deployed runtime missing authoritative backend/auth dependency', {
    pathLabel,
    environment: getRuntimeEnvironment(),
  });
  throw new Error(`Authoritative backend dependency missing for ${pathLabel} in ${getRuntimeEnvironment()} runtime.`);
};

export const logRuntimeMode = (component: string) => {
  logger.info('[RuntimeConfig] resolved runtime mode', {
    component,
    environment: getRuntimeEnvironment(),
    localMocksEnabled: areLocalMocksExplicitlyEnabled(),
    deployed: isDeployedRuntime(),
  });
};

