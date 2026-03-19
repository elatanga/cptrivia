
import '@testing-library/jest-dom';
import { vi } from 'vitest';

// Compatibility bridge for older test files still using jest.* helpers.
const globalWithJest = globalThis as typeof globalThis & { jest?: typeof vi };
if (!globalWithJest.jest) {
  globalWithJest.jest = vi;
}
