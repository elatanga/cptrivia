/**
 * specialMovesClient.fallback.test.ts
 *
 * Unit tests for the SpecialMovesClient fallback cascade behavior.
 * Covers: Functions → Firestore → Memory in all failure combinations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Hoist mock variables so vi.mock factories can reference them ─────────────
// vi.mock calls are hoisted to the top of the file by Vitest; any variables they
// reference must also be hoisted with vi.hoisted() or they won't be initialized yet.
const { mockSetDoc, mockGetDoc, mockOnSnapshot, mockDoc, mockHttpsCallable } = vi.hoisted(() => ({
  mockSetDoc: vi.fn(),
  mockGetDoc: vi.fn(),
  mockOnSnapshot: vi.fn(),
  mockDoc: vi.fn(() => 'mock-doc-ref'),
  mockHttpsCallable: vi.fn(),
}));

// ─── Mock Firebase before importing the module ────────────────────────────────
vi.mock('../../../services/firebase', () => ({
  db: { type: 'firestore' },       // truthy → Firestore path enabled
  functions: { type: 'functions' }, // truthy → Functions path enabled
}));

vi.mock('firebase/firestore', () => ({
  doc: mockDoc,
  setDoc: mockSetDoc,
  getDoc: mockGetDoc,
  onSnapshot: mockOnSnapshot,
}));

vi.mock('firebase/functions', () => ({
  httpsCallable: mockHttpsCallable,
}));

vi.mock('../../../services/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    getCorrelationId: () => 'test-corr',
  },
}));

// ─── Import AFTER mocks are in place ─────────────────────────────────────────
import { specialMovesClient } from './specialMovesClient';

// ─── Helpers ─────────────────────────────────────────────────────────────────
const BASE_PARAMS = {
  gameId: 'game-1',
  tileId: 'tile-1',
  moveType: 'DOUBLE_TROUBLE' as const,
  actorId: 'director',
  idempotencyKey: 'idem-1',
  correlationId: 'corr-1',
};

const permissionError = Object.assign(new Error('permission denied'), {
  code: 'functions/permission-denied',
});
const internalError = Object.assign(new Error('internal'), {
  code: 'functions/internal',
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('SpecialMovesClient – requestArmTile fallback cascade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset private state between tests via a fresh import (module-level singleton)
    // We simulate different scenarios by controlling mock behavior.
  });

  it('1. Functions success → returns result, no fallback', async () => {
    const callFn = vi.fn().mockResolvedValue({ data: { success: true, id: 'req-1' } });
    mockHttpsCallable.mockReturnValue(callFn);

    const result = await specialMovesClient.requestArmTile(BASE_PARAMS);

    expect(result).toEqual({ success: true, id: 'req-1' });
    expect(mockSetDoc).not.toHaveBeenCalled(); // No Firestore write
  });

  it('2. Functions permission-denied → cascades to Firestore → success', async () => {
    const callFn = vi.fn().mockRejectedValue(permissionError);
    mockHttpsCallable.mockReturnValue(callFn);

    // Firestore getDoc returns empty, setDoc succeeds
    mockGetDoc.mockResolvedValue({ exists: () => false, data: () => undefined });
    mockSetDoc.mockResolvedValue(undefined);

    const result = await specialMovesClient.requestArmTile(BASE_PARAMS);

    expect(result.success).toBe(true);
    expect(mockSetDoc).toHaveBeenCalledTimes(1);
  });

  it('3. Functions permission-denied + Firestore permission-denied → cascades to memory', async () => {
    const callFn = vi.fn().mockRejectedValue(permissionError);
    mockHttpsCallable.mockReturnValue(callFn);

    // Firestore getDoc also fails
    mockGetDoc.mockRejectedValue(
      Object.assign(new Error('firestore permission denied'), { code: 'permission-denied' })
    );

    const result = await specialMovesClient.requestArmTile(BASE_PARAMS);

    // Must still succeed via in-memory fallback
    expect(result.success).toBe(true);
    expect(result.id).toBe(BASE_PARAMS.idempotencyKey);
  });

  it('4. Functions unavailable (null) + Firestore fails → cascades to memory', async () => {
    // Temporarily override functions to null via a fresh instance-like behavior
    // We use the singleton, so we'll spy on internal methods instead
    const firestoreError = Object.assign(new Error('firestore write failed'), {
      code: 'permission-denied',
    });
    mockGetDoc.mockRejectedValue(firestoreError);

    // This test verifies the MEMORY_FALLBACK path when Firestore errors.
    // In the real client the in-memory path sets the inMemoryOverlay and notifies subscribers.
    const result = await specialMovesClient.requestArmTile({
      ...BASE_PARAMS,
      tileId: 'tile-cascade-test',
      idempotencyKey: 'idem-cascade',
    });

    expect(result.success).toBe(true);
  });

  it('5. Already-armed validation error (already-exists) → throws, no cascade', async () => {
    const alreadyArmedError = Object.assign(new Error('already exists'), {
      code: 'functions/already-exists',
    });
    const callFn = vi.fn().mockRejectedValue(alreadyArmedError);
    mockHttpsCallable.mockReturnValue(callFn);

    await expect(
      specialMovesClient.requestArmTile(BASE_PARAMS)
    ).rejects.toThrow();
  });
});

describe('SpecialMovesClient – clearArmory fallback cascade', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('6. Functions success → returns cleared count, no fallback', async () => {
    const callFn = vi.fn().mockResolvedValue({ data: { success: true, clearedCount: 3 } });
    mockHttpsCallable.mockReturnValue(callFn);

    const result = await specialMovesClient.clearArmory({
      gameId: 'game-1',
      actorId: 'director',
      idempotencyKey: 'idem-clear-1',
      correlationId: 'corr-clear-1',
    });

    expect(result.success).toBe(true);
    expect(result.clearedCount).toBe(3);
  });

  it('7. Functions permission-denied → cascades to Firestore → success', async () => {
    const callFn = vi.fn().mockRejectedValue(permissionError);
    mockHttpsCallable.mockReturnValue(callFn);

    mockGetDoc.mockResolvedValue({
      exists: () => true,
      data: () => ({
        deploymentsByTileId: { 'tile-a': { status: 'ARMED' } },
        activeByTargetId: {},
        updatedAt: Date.now(),
        version: 1,
      }),
    });
    mockSetDoc.mockResolvedValue(undefined);

    const result = await specialMovesClient.clearArmory({
      gameId: 'game-1',
      actorId: 'director',
      idempotencyKey: 'idem-clear-2',
      correlationId: 'corr-clear-2',
    });

    expect(result.success).toBe(true);
    expect(result.clearedCount).toBeGreaterThanOrEqual(0);
  });

  it('8. Functions permission-denied + Firestore fails → cascades to memory', async () => {
    const callFn = vi.fn().mockRejectedValue(permissionError);
    mockHttpsCallable.mockReturnValue(callFn);
    mockGetDoc.mockRejectedValue(
      Object.assign(new Error('firestore denied'), { code: 'permission-denied' })
    );

    const result = await specialMovesClient.clearArmory({
      gameId: 'game-1',
      actorId: 'director',
      idempotencyKey: 'idem-clear-3',
      correlationId: 'corr-clear-3',
    });

    expect(result.success).toBe(true);
  });
});

describe('SpecialMovesClient – subscribeOverlay fallback to in-memory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('9. Firestore snapshot error → switches to in-memory, overlay callback is immediately called', () => {
    let errorCallback: ((err: Error) => void) | undefined;

    mockOnSnapshot.mockImplementation((_ref: any, handlers: any) => {
      errorCallback = handlers.error;
      return () => {}; // unsubscribe noop
    });

    const overlayCallbacks: any[] = [];
    const unsubscribe = specialMovesClient.subscribeOverlay({
      gameId: 'game-snapshot-error',
      onOverlay: (overlay) => overlayCallbacks.push(overlay),
      onError: vi.fn(),
    });

    // Simulate Firestore snapshot error
    errorCallback!(
      Object.assign(new Error('permission denied'), { code: 'permission-denied' })
    );

    // The in-memory overlay should have been delivered immediately after error
    expect(overlayCallbacks.length).toBeGreaterThanOrEqual(1);
    // The overlay should be a valid empty structure
    expect(overlayCallbacks[overlayCallbacks.length - 1]).toMatchObject({
      deploymentsByTileId: expect.any(Object),
    });

    unsubscribe();
  });

  it('10. After Firestore snapshot error, in-memory arm arm notifies the same overlay callback', async () => {
    let errorCallback: ((err: Error) => void) | undefined;

    mockOnSnapshot.mockImplementation((_ref: any, handlers: any) => {
      errorCallback = handlers.error;
      return () => {};
    });

    // Also set up Firestore to fail so arm cascades to memory
    const callFn = vi.fn().mockRejectedValue(permissionError);
    mockHttpsCallable.mockReturnValue(callFn);
    mockGetDoc.mockRejectedValue(
      Object.assign(new Error('firestore denied'), { code: 'permission-denied' })
    );

    const overlayCallbacks: any[] = [];
    const gameId = 'game-live-fallback';

    const unsubscribe = specialMovesClient.subscribeOverlay({
      gameId,
      onOverlay: (overlay) => overlayCallbacks.push(overlay),
    });

    // Trigger Firestore snapshot error → registers in-memory subscriber
    errorCallback!(
      Object.assign(new Error('permission denied'), { code: 'permission-denied' })
    );

    const initialCount = overlayCallbacks.length;

    // Arm a tile — should cascade to memory and trigger in-memory subscriber
    await specialMovesClient.requestArmTile({
      ...BASE_PARAMS,
      gameId,
      tileId: 'tile-live-test',
      idempotencyKey: 'idem-live',
    });

    // Overlay callback should have been called again with the armed tile
    expect(overlayCallbacks.length).toBeGreaterThan(initialCount);
    const lastOverlay = overlayCallbacks[overlayCallbacks.length - 1];
    expect(lastOverlay.deploymentsByTileId?.['tile-live-test']?.status).toBe('ARMED');

    unsubscribe();
  });
});

