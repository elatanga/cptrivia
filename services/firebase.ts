import { initializeApp, FirebaseApp, getApps } from 'firebase/app';
import { getFirestore, Firestore } from 'firebase/firestore';
import { getFunctions, Functions } from 'firebase/functions';
import { getAuth, Auth, signInAnonymously } from 'firebase/auth';
import { logger } from './logger';
import {
  getRuntimeConfig,
  areAnonymousFirebaseAuthFlowsEnabled,
  assertRealAuthInDeployedEnv,
  logRuntimeMode,
  isDeployedRuntime,
} from './runtimeConfig';

const runtimeConfig = getRuntimeConfig();
logRuntimeMode('firebase');

// Define strictly required keys matching server.js
const requiredKeys = [
  'FIREBASE_API_KEY',
  'FIREBASE_AUTH_DOMAIN',
  'FIREBASE_PROJECT_ID',
  'FIREBASE_STORAGE_BUCKET',
  'FIREBASE_MESSAGING_SENDER_ID',
  'FIREBASE_APP_ID'
] as const;

// Validator to check for missing, empty, or placeholder values
const isInvalid = (val: string | undefined): boolean => {
  if (!val || typeof val !== 'string') return true;
  const trimmed = val.trim();
  if (trimmed === '') return true;
  if (trimmed.startsWith('%') && trimmed.endsWith('%')) return true; // Build-time placeholder
  if (trimmed.startsWith('__') && trimmed.endsWith('__')) return true; // Runtime placeholder
  if (trimmed.includes('INSERT_KEY')) return true; // Default template text
  if (trimmed === 'undefined' || trimmed === 'null') return true;
  return false;
};

// Identify invalid keys
const missingKeys = requiredKeys.filter(key => isInvalid(runtimeConfig[key]));
const firebaseConfigError = missingKeys.length > 0;

assertRealAuthInDeployedEnv('firebase.config', !firebaseConfigError);

let app: FirebaseApp | undefined;
let db: Firestore | undefined;
let functions: Functions | undefined;
let auth: Auth | undefined;
let projectId: string | undefined;

if (firebaseConfigError) {
  // Log the error but don't throw, allowing the UI to render the error screen
  // Fix: logger.error expects 1-2 arguments
  logger.error('Firebase Configuration Missing or Invalid', {
    category: 'CONFIG',
    missingKeys,
    configState: 'partial_or_empty',
    correlationId: logger.getCorrelationId()
  });
} else {
  try {
    const config = {
      apiKey: runtimeConfig.FIREBASE_API_KEY,
      authDomain: runtimeConfig.FIREBASE_AUTH_DOMAIN,
      projectId: runtimeConfig.FIREBASE_PROJECT_ID,
      storageBucket: runtimeConfig.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: runtimeConfig.FIREBASE_MESSAGING_SENDER_ID,
      appId: runtimeConfig.FIREBASE_APP_ID
    };

    projectId = config.projectId;

    // Singleton Pattern: Prevent multiple initializations (e.g. during hot reload)
    if (!getApps().length) {
      app = initializeApp(config);
      // Fix: logger.info expects 1-2 arguments
      logger.info('Firebase App Initialized', { category: 'SYSTEM', projectId });
    } else {
      app = getApps()[0];
      // Fix: logger.info expects 1-2 arguments
      logger.info('Firebase App Re-used', { category: 'SYSTEM', projectId });
    }

    // Initialize Services
    db = getFirestore(app);
    functions = getFunctions(app);
    auth = getAuth(app);

    if (areAnonymousFirebaseAuthFlowsEnabled()) {
      signInAnonymously(auth).catch((err) => {
        logger.warn('[Auth] anonymous auth failed in explicitly enabled local mode', {
          category: 'AUTH',
          error: err.message,
        });
      });
    } else if (isDeployedRuntime()) {
      logger.info('[Auth] anonymous auth disabled in deployed runtime', { category: 'AUTH' });
    }

    assertRealAuthInDeployedEnv('firebase.functions', Boolean(functions));
    assertRealAuthInDeployedEnv('firebase.auth', Boolean(auth));
    
  } catch (error: any) {
    // Fix: logger.error expects 1-2 arguments
    logger.error('Firebase Critical Failure During Init', {
      category: 'SYSTEM',
      message: error.message,
      correlationId: logger.getCorrelationId()
    });
    // Ensure services are undefined if init failed
    app = undefined;
    db = undefined;
    functions = undefined;
    auth = undefined;
  }
}

export { app, db, functions, auth, firebaseConfigError, missingKeys, projectId };