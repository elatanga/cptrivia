type RuntimeConfig = {
  BUILD_ENV?: string;
  DATA_SOURCE?: string;
  [key: string]: any;
};

export type DataSourceMode = 'mock' | 'firebase';

export const getRuntimeConfig = (): RuntimeConfig => {
  if (typeof window !== 'undefined' && (window as any).__RUNTIME_CONFIG__) {
    return (window as any).__RUNTIME_CONFIG__;
  }
  return {};
};

const getImportMetaEnv = () => {
  return ((import.meta as any).env || {}) as {
    MODE?: string;
    PROD?: boolean;
    DEV?: boolean;
    VITE_DATA_SOURCE?: string;
  };
};

const getNodeEnv = () => {
  if (typeof process === 'undefined') return undefined;
  return process.env?.NODE_ENV;
};

const normalizeMode = (value: unknown): DataSourceMode | undefined => {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'firebase' || normalized === 'production') return 'firebase';
  if (normalized === 'mock' || normalized === 'local' || normalized === 'development' || normalized === 'test') return 'mock';
  return undefined;
};

const isProductionValue = (value: unknown): boolean => {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'production' || normalized === 'prod' || normalized === 'deployed';
};

export function resolveDataSource(options?: {
  runtimeConfig?: RuntimeConfig;
  viteMode?: string;
  viteProd?: boolean;
  viteDev?: boolean;
  nodeEnv?: string;
  viteDataSource?: string;
}): DataSourceMode {
  const importEnv = getImportMetaEnv();
  const runtimeConfig = options?.runtimeConfig ?? getRuntimeConfig();

  const viteMode = options?.viteMode ?? importEnv.MODE;
  const nodeEnv = options?.nodeEnv ?? getNodeEnv();
  const viteDev = options?.viteDev ?? importEnv.DEV;
  const viteProd = options?.viteProd ?? importEnv.PROD;
  const buildEnv = String(runtimeConfig.BUILD_ENV || '').trim().toLowerCase();
  const explicit = normalizeMode(
    runtimeConfig.DATA_SOURCE ||
      options?.viteDataSource ||
      importEnv.VITE_DATA_SOURCE
  );

  if (
    isProductionValue(buildEnv) ||
    isProductionValue(viteMode) ||
    isProductionValue(nodeEnv) ||
    viteProd
  ) {
    return 'firebase';
  }

  if (explicit) return explicit;

  if (nodeEnv === 'test' || viteMode === 'test') return 'mock';
  if (viteDev) return 'mock';
  if (buildEnv === 'development' || buildEnv === 'dev' || buildEnv === 'local' || buildEnv === 'test') return 'mock';

  return 'mock';
}

export const usesFirebaseDataSource = () => resolveDataSource() === 'firebase';
