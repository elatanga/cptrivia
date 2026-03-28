
import { functions, db } from '../../../services/firebase';
import { httpsCallable } from 'firebase/functions';
import { doc, onSnapshot, getDoc, setDoc } from 'firebase/firestore';
import { logger } from '../../../services/logger';
import { SMSOverlayDoc } from '../firestoreTypes';
import { SpecialMoveType } from '../../../types';

export interface RequestArmParams {
  gameId: string;
  tileId: string;
  moveType: SpecialMoveType;
  actorId: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface ClearArmoryParams {
  gameId: string;
  actorId: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface SubscribeParams {
  gameId: string;
  onOverlay: (overlay: SMSOverlayDoc) => void;
  onError?: (error: Error) => void;
}

export type SMSServiceHealth = 'HEALTHY' | 'DEGRADED' | 'OFFLINE';
export type SMSBackendMode = 'FUNCTIONS' | 'FIRESTORE_FALLBACK' | 'MEMORY_FALLBACK';

/**
 * Client-side interface for the Special Moves Microservice.
 */
class SpecialMovesClient {
  private consecutiveFailures = 0;
  private MAX_FAILURES = 3;
  private backendMode: SMSBackendMode;
  private inMemoryOverlayByGameId = new Map<string, SMSOverlayDoc>();
  private inMemorySubscribers = new Map<string, Set<(overlay: SMSOverlayDoc) => void>>();

  constructor() {
    this.backendMode = this.resolveInitialMode();
  }

  /**
   * Returns current health of the SMS service based on recent interaction history.
   */
  getHealth(): SMSServiceHealth {
    if (this.consecutiveFailures >= this.MAX_FAILURES) return 'OFFLINE';
    if (this.consecutiveFailures > 0) return 'DEGRADED';
    return 'HEALTHY';
  }

  /**
   * Returns the currently selected backend execution mode.
   */
  getBackendMode(): SMSBackendMode {
    return this.backendMode;
  }

  private resolveInitialMode(): SMSBackendMode {
    if (functions) return 'FUNCTIONS';
    if (db) return 'FIRESTORE_FALLBACK';
    return 'MEMORY_FALLBACK';
  }

  private setBackendMode(nextMode: SMSBackendMode) {
    if (this.backendMode === nextMode) return;
    this.backendMode = nextMode;
    logger.info('SMS_BACKEND_MODE_CHANGED', { backendMode: nextMode });
  }

  /**
   * Utility: Exponential Backoff Retry
   */
  private async withRetry<T>(
    operation: () => Promise<T>, 
    context: string,
    params: any
  ): Promise<T> {
    let lastError: any;
    const initialDelay = 1000;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const result = await operation();
        this.consecutiveFailures = 0; // Reset health on success
        return result;
      } catch (e: any) {
        lastError = e;
        const isRetryable = e.code === 'unavailable' || e.code === 'deadline-exceeded' || e.code === 'internal';
        
        logger.warn('SMS_CLIENT_ATTEMPT_FAILED', {
          context,
          attempt: attempt + 1,
          isRetryable,
          error: e.message,
          correlationId: params.correlationId
        });

        if (!isRetryable) break;
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, initialDelay * Math.pow(2, attempt)));
        }
      }
    }

    this.consecutiveFailures++;
    logger.error(`SMS_CLIENT_CRITICAL_FAILURE`, {
      context,
      finalHealth: this.getHealth(),
      error: lastError.message,
      ...params
    });
    throw lastError;
  }

  /**
   * Dispatches a request to arm a specific board tile.
   */
  async requestArmTile(params: RequestArmParams): Promise<{ success: boolean; id: string }> {
    if (functions) {
      this.setBackendMode('FUNCTIONS');
      const call = httpsCallable<RequestArmParams, { success: boolean; id: string }>(functions, 'sms_requestArm');
      return this.withRetry(
        async () => {
          const result = await call(params);
          return result.data;
        },
        'requestArmTile',
        params
      );
    }

    logger.warn('SMS_FUNCTIONS_UNAVAILABLE_FALLBACK_ARM', { gameId: params.gameId, tileId: params.tileId });

    if (db) {
      this.setBackendMode('FIRESTORE_FALLBACK');
      return this.withRetry(
        async () => this.fallbackArmViaOverlay(params),
        'requestArmTileFallbackOverlay',
        params
      );
    }

    this.setBackendMode('MEMORY_FALLBACK');
    return this.fallbackArmInMemory(params);
  }

  /**
   * Command: Wipe all currently armed tiles.
   */
  async clearArmory(params: ClearArmoryParams): Promise<{ success: boolean; clearedCount: number }> {
    if (functions) {
      this.setBackendMode('FUNCTIONS');
      const call = httpsCallable<ClearArmoryParams, { success: boolean; clearedCount: number }>(functions, 'sms_clearArmory');
      return this.withRetry(
        async () => {
          const result = await call(params);
          return result.data;
        },
        'clearArmory',
        params
      );
    }

    logger.warn('SMS_FUNCTIONS_UNAVAILABLE_FALLBACK_CLEAR', { gameId: params.gameId });

    if (db) {
      this.setBackendMode('FIRESTORE_FALLBACK');
      return this.withRetry(
        async () => this.fallbackClearViaOverlay(params),
        'clearArmoryFallbackOverlay',
        params
      );
    }

    this.setBackendMode('MEMORY_FALLBACK');
    return this.fallbackClearInMemory(params);
  }

  /**
   * Subscribes to the board projection overlay.
   */
  subscribeOverlay({ gameId, onOverlay, onError }: SubscribeParams) {
    if (!db) {
      this.setBackendMode('MEMORY_FALLBACK');
      logger.warn('SMS_CLIENT_DB_MISSING_USING_MEMORY_OVERLAY', { gameId });
      const subscribers = this.inMemorySubscribers.get(gameId) || new Set<(overlay: SMSOverlayDoc) => void>();
      subscribers.add(onOverlay);
      this.inMemorySubscribers.set(gameId, subscribers);
      onOverlay(this.getInMemoryOverlay(gameId));
      return () => {
        const existing = this.inMemorySubscribers.get(gameId);
        if (!existing) return;
        existing.delete(onOverlay);
        if (existing.size === 0) this.inMemorySubscribers.delete(gameId);
      };
    }

    if (!functions) this.setBackendMode('FIRESTORE_FALLBACK');

    const docRef = doc(db, `games/${gameId}/specialMoves_overlay`, 'current');

    logger.info('SMS_OVERLAY_SUBSCRIPTION_START', { gameId });

    return onSnapshot(docRef, {
      next: (snap) => {
        if (snap.exists()) {
          onOverlay(snap.data() as SMSOverlayDoc);
        } else {
          onOverlay(this.getEmptyOverlay());
        }
      },
      error: (err) => {
        logger.error('SMS_CLIENT_SNAPSHOT_ERROR', { gameId, error: err.message });
        onOverlay(this.getEmptyOverlay());
        if (onError) onError(err);
      }
    });
  }

  private getEmptyOverlay(): SMSOverlayDoc {
    return {
      deploymentsByTileId: {},
      activeByTargetId: {},
      updatedAt: Date.now(),
      version: 1
    };
  }

  private getInMemoryOverlay(gameId: string): SMSOverlayDoc {
    const existing = this.inMemoryOverlayByGameId.get(gameId);
    if (existing) return existing;
    const empty = this.getEmptyOverlay();
    this.inMemoryOverlayByGameId.set(gameId, empty);
    return empty;
  }

  private notifyInMemorySubscribers(gameId: string, overlay: SMSOverlayDoc) {
    const subscribers = this.inMemorySubscribers.get(gameId);
    if (!subscribers) return;
    subscribers.forEach((callback) => callback(overlay));
  }

  private async fallbackArmViaOverlay(params: RequestArmParams): Promise<{ success: boolean; id: string }> {
    if (!db) return this.fallbackArmInMemory(params);

    const now = Date.now();
    const overlayRef = doc(db, `games/${params.gameId}/specialMoves_overlay`, 'current');
    const currentSnap = await getDoc(overlayRef);
    const current = currentSnap.exists() ? (currentSnap.data() as SMSOverlayDoc) : this.getEmptyOverlay();

    const next: SMSOverlayDoc = {
      deploymentsByTileId: {
        ...(current.deploymentsByTileId || {}),
        [params.tileId]: {
          status: 'ARMED',
          moveType: params.moveType,
          updatedAt: now
        }
      },
      activeByTargetId: current.activeByTargetId || {},
      updatedAt: now,
      version: 1
    };

    await setDoc(overlayRef, next);
    return { success: true, id: params.idempotencyKey };
  }

  private async fallbackClearViaOverlay(params: ClearArmoryParams): Promise<{ success: boolean; clearedCount: number }> {
    if (!db) return this.fallbackClearInMemory(params);

    const now = Date.now();
    const overlayRef = doc(db, `games/${params.gameId}/specialMoves_overlay`, 'current');
    const currentSnap = await getDoc(overlayRef);
    const current = currentSnap.exists() ? (currentSnap.data() as SMSOverlayDoc) : this.getEmptyOverlay();
    const clearedCount = Object.keys(current.deploymentsByTileId || {}).length;

    const next: SMSOverlayDoc = {
      deploymentsByTileId: {},
      activeByTargetId: {},
      updatedAt: now,
      version: 1
    };

    await setDoc(overlayRef, next);
    return { success: true, clearedCount };
  }

  private fallbackArmInMemory(params: RequestArmParams): { success: boolean; id: string } {
    const now = Date.now();
    const current = this.getInMemoryOverlay(params.gameId);
    const next: SMSOverlayDoc = {
      deploymentsByTileId: {
        ...(current.deploymentsByTileId || {}),
        [params.tileId]: {
          status: 'ARMED',
          moveType: params.moveType,
          updatedAt: now
        }
      },
      activeByTargetId: current.activeByTargetId || {},
      updatedAt: now,
      version: 1
    };
    this.inMemoryOverlayByGameId.set(params.gameId, next);
    this.notifyInMemorySubscribers(params.gameId, next);
    return { success: true, id: params.idempotencyKey };
  }

  private fallbackClearInMemory(params: ClearArmoryParams): { success: boolean; clearedCount: number } {
    const current = this.getInMemoryOverlay(params.gameId);
    const clearedCount = Object.keys(current.deploymentsByTileId || {}).length;
    const next: SMSOverlayDoc = {
      deploymentsByTileId: {},
      activeByTargetId: {},
      updatedAt: Date.now(),
      version: 1
    };
    this.inMemoryOverlayByGameId.set(params.gameId, next);
    this.notifyInMemorySubscribers(params.gameId, next);
    return { success: true, clearedCount };
  }
}

export const specialMovesClient = new SpecialMovesClient();
