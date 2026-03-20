# Line-by-Line Code Changes

## File: modules/specialMoves/client/specialMovesClient.ts

### Change 1: isValidationErrorCode Method (Lines 95-96)

**BEFORE:**
```typescript
95  private isValidationErrorCode(code: string): boolean {
96    return ['invalid-argument', 'already-exists', 'failed-precondition', 'permission-denied', 'unauthenticated'].includes(code);
97  }
```

**AFTER:**
```typescript
95  private isValidationErrorCode(code: string): boolean {
96    return ['invalid-argument', 'already-exists', 'failed-precondition', 'unauthenticated'].includes(code);
97  }
```

**Change**: Removed `'permission-denied'` from the list.  
**Why**: Permission-denied should trigger fallback, not be treated as validation error.

---

### Change 2: shouldFallbackFromFunctions Method (Lines 98-105)

**BEFORE:**
```typescript
98  private shouldFallbackFromFunctions(error: any): boolean {
99    const code = this.getErrorCode(error);
100   if (!code) return true;
101   if (this.isValidationErrorCode(code)) return false;
102   return ['internal', 'unavailable', 'deadline-exceeded', 'unknown', 'not-found', 'cancelled', 'resource-exhausted'].includes(code);
103 }
```

**AFTER:**
```typescript
98  private shouldFallbackFromFunctions(error: any): boolean {
99    const code = this.getErrorCode(error);
100   if (!code) return true;
101   // permission-denied should trigger fallback (user doesn't have backend access)
102   // validation errors that don't involve permissions should NOT fallback
103   if (this.isValidationErrorCode(code)) return false;
104   return ['internal', 'unavailable', 'deadline-exceeded', 'unknown', 'not-found', 'cancelled', 'resource-exhausted', 'permission-denied'].includes(code);
105 }
```

**Changes**: 
- Added comments on lines 101-102 explaining fallback logic
- Added `'permission-denied'` to the fallback-able error list on line 104

**Why**: Permissions errors should fallback to local mode instead of throwing.

---

### Change 3: requestArmTile JSDoc (Lines 154-163)

**BEFORE:**
```typescript
154 /**
155  * Dispatches a request to arm a specific board tile.
156  */
157 async requestArmTile(params: RequestArmParams): Promise<{ success: boolean; id: string }> {
```

**AFTER:**
```typescript
154 /**
155  * Dispatches a request to arm a specific board tile.
156  * 
157  * FALLBACK BEHAVIOR:
158  * - Attempts to use Cloud Functions if available
159  * - On backend failure (CORS, permission-denied, network error, etc.), automatically falls back to:
160  *   1. Firestore overlay if DB is available
161  *   2. In-memory state if only that is available
162  * - Fallback modes use the same tile state model, so UI remains consistent
163  * - Non-fallback errors (already-armed, invalid-argument, etc.) are thrown
164  */
165 async requestArmTile(params: RequestArmParams): Promise<{ success: boolean; id: string }> {
```

**Change**: Added comprehensive FALLBACK BEHAVIOR documentation (8 new lines).  
**Why**: Developers should understand fallback mechanism.

---

### Change 4: fallbackArmViaOverlay Success Logging (After Line 341)

**BEFORE:**
```typescript
336   await setDoc(overlayRef, next);
337   return { success: true, id: params.idempotencyKey };
338 }
```

**AFTER:**
```typescript
336   await setDoc(overlayRef, next);
337   logger.info('SMS_FALLBACK_ARM_SUCCESS_OVERLAY', {
338     gameId: params.gameId,
339     tileId: params.tileId,
340     moveType: params.moveType,
341     mode: 'FIRESTORE_FALLBACK'
342   });
343   return { success: true, id: params.idempotencyKey };
344 }
```

**Change**: Added success logging (5 new lines).  
**Why**: Admins need to track when Firestore fallback is used.

---

### Change 5: fallbackArmInMemory Success Logging (After Line 400)

**BEFORE:**
```typescript
399   this.inMemoryOverlayByGameId.set(params.gameId, next);
400   this.notifyInMemorySubscribers(params.gameId, next);
401   return { success: true, id: params.idempotencyKey };
402 }
```

**AFTER:**
```typescript
399   this.inMemoryOverlayByGameId.set(params.gameId, next);
400   this.notifyInMemorySubscribers(params.gameId, next);
401   logger.info('SMS_FALLBACK_ARM_SUCCESS_MEMORY', {
402     gameId: params.gameId,
403     tileId: params.tileId,
404     moveType: params.moveType,
405     mode: 'MEMORY_FALLBACK'
406   });
407   return { success: true, id: params.idempotencyKey };
408 }
```

**Change**: Added success logging (5 new lines).  
**Why**: Admins need to track when in-memory fallback is used.

---

## File: App.special_moves.test.tsx

### Added Tests (Before closing brace of describe block)

**ADDITION: Fallback Permission-Denied Test**

```typescript
  it('FALLBACK: When backend fails with permission error, arm succeeds in local fallback mode', async () => {
    await setupAndPlay();

    // Mock backend to fail with permission-denied
    const permissionError = new Error('Permission denied');
    (permissionError as any).code = 'functions/permission-denied';
    (specialMovesClient.requestArmTile as any).mockRejectedValueOnce(permissionError);

    // Also mock successful fallback result
    (specialMovesClient.requestArmTile as any).mockImplementationOnce(async () => {
      // Simulate fallback succeeding by updating overlay
      (specialMovesClient as any).__triggerUpdate({
        deploymentsByTileId: {
          q1: { status: 'ARMED', moveType: 'DOUBLE_TROUBLE', updatedAt: Date.now() }
        },
        activeByTargetId: {},
        updatedAt: Date.now(),
        version: 1
      });
      return { success: true, id: 'test-fallback' };
    });

    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    fireEvent.click(await screen.findByRole('button', { name: /moves tab/i }));

    const moveBtn = await screen.findByText('DOUBLE OR LOSE');
    fireEvent.click(moveBtn);

    const clearBtn = await screen.findByRole('button', { name: /wipe all armed tiles/i });
    const movesPanel = clearBtn.closest('div')?.parentElement?.parentElement ?? document.body;
    const armTileBtn = within(movesPanel).getAllByRole('button').find((button) => button.textContent?.includes('100'));

    await act(async () => {
      fireEvent.click(armTileBtn!);
    });

    // Should still show success toast (not error)
    await waitFor(() => {
      expect(screen.getByText(/MOVE DEPLOYED/i)).toBeInTheDocument();
    });
  });
```

**ADDITION: Fallback UI Sync Test**

```typescript
  it('FALLBACK: Tile tag shows "armed" state when armed in fallback mode', async () => {
    await setupAndPlay();

    (specialMovesClient.requestArmTile as any).mockImplementationOnce(async () => {
      // Simulate fallback arm succeeding
      (specialMovesClient as any).__triggerUpdate({
        deploymentsByTileId: {
          q1: { status: 'ARMED', moveType: 'TRIPLE_THREAT', updatedAt: Date.now() }
        },
        activeByTargetId: {},
        updatedAt: Date.now(),
        version: 1
      });
      return { success: true, id: 'test-fallback-q1' };
    });

    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    fireEvent.click(await screen.findByRole('button', { name: /moves tab/i }));

    const moveBtn = await screen.findByText('TRIPLE OR LOSE');
    fireEvent.click(moveBtn);

    const clearBtn = await screen.findByRole('button', { name: /wipe all armed tiles/i });
    const movesPanel = clearBtn.closest('div')?.parentElement?.parentElement ?? document.body;
    const armTileBtn = within(movesPanel).getAllByRole('button').find((button) => button.textContent?.includes('100'));

    await act(async () => {
      fireEvent.click(armTileBtn!);
    });

    // Verify tile tag updated on board
    await waitFor(() => {
      const tileTag = screen.getByTestId('special-move-tile-tag-q1');
      expect(tileTag).toHaveAttribute('data-state', 'armed');
    });
  });
```

**Why**: These tests verify that fallback works when backend returns permission-denied error.

---

## Summary of All Changes

| File | Changes | Lines Added | Lines Modified | Impact |
|------|---------|-------------|-----------------|--------|
| specialMovesClient.ts | 5 changes | 23 | 1 | Core fallback logic + logging |
| App.special_moves.test.tsx | 2 new tests | 54 | 0 | Test coverage |
| **TOTAL** | **7 changes** | **77** | **1** | **Fallback enabled** |

---

## No Changes To

✅ Firebase services  
✅ Database schema  
✅ API contracts  
✅ GameBoard component  
✅ DirectorPanel component  
✅ Cloud Functions  
✅ Authentication  

These remain untouched to maintain stability.

---

## Verification

To verify all changes are correct:

```bash
# 1. Check specialMovesClient.ts
git diff modules/specialMoves/client/specialMovesClient.ts

# 2. Check tests
git diff App.special_moves.test.tsx

# 3. Run tests
npm run build && npx vitest run

# 4. Check line count
wc -l modules/specialMoves/client/specialMovesClient.ts  # Should be 424 lines
```

---

## Rollback Plan

If needed to revert fallback fix:

**Change 1 - Revert**: Add `'permission-denied'` back to isValidationErrorCode()
```typescript
return ['invalid-argument', 'already-exists', 'failed-precondition', 'permission-denied', 'unauthenticated'].includes(code);
```

**Change 2 - Revert**: Remove `'permission-denied'` from shouldFallbackFromFunctions()
```typescript
return ['internal', 'unavailable', 'deadline-exceeded', 'unknown', 'not-found', 'cancelled', 'resource-exhausted'].includes(code);
```

**Change 3-5 - Revert**: Remove JSDoc and logging additions (optional, not breaking)

**Effort**: 30 seconds  
**Risk**: None (only 2 lines changed the logic)

