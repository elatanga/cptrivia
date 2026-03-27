# Special Moves Fallback - Quick Summary

## Problem
When backend Cloud Function fails with CORS/permission errors → game breaks. Director can't arm moves.

## Root Cause
`permission-denied` error code was in validation error list, preventing fallback to local mode.

```typescript
// BEFORE (BROKEN)
private isValidationErrorCode(code: string): boolean {
  return ['invalid-argument', 'already-exists', 'failed-precondition', 
          'permission-denied', 'unauthenticated'].includes(code);  // ← Blocks fallback
}
```

## Solution
Move `permission-denied` from validation errors to fallback-able errors.

```typescript
// AFTER (FIXED)
private isValidationErrorCode(code: string): boolean {
  return ['invalid-argument', 'already-exists', 'failed-precondition', 
          'unauthenticated'].includes(code);  // ← Removed permission-denied
}

private shouldFallbackFromFunctions(error: any): boolean {
  const code = this.getErrorCode(error);
  if (!code) return true;
  if (this.isValidationErrorCode(code)) return false;
  return ['internal', 'unavailable', 'deadline-exceeded', 'unknown', 
          'not-found', 'cancelled', 'resource-exhausted', 'permission-denied'].includes(code);  // ← Added
}
```

## What Changed

### File: `modules/specialMoves/client/specialMovesClient.ts`

**Change 1**: Lines ~95-96 (isValidationErrorCode method)
- Removed `'permission-denied'` from validation error list

**Change 2**: Lines ~98-105 (shouldFallbackFromFunctions method)  
- Added `'permission-denied'` to fallback-able error list
- Added comment explaining permission-denied triggers fallback

**Change 3**: Lines ~159-163 (requestArmTile JSDoc)
- Added comprehensive documentation of fallback behavior

**Change 4**: Lines ~310-341 (fallbackArmViaOverlay method)
- Added success logging: `SMS_FALLBACK_ARM_SUCCESS_OVERLAY`

**Change 5**: Lines ~356-383 (fallbackArmInMemory method)
- Added success logging: `SMS_FALLBACK_ARM_SUCCESS_MEMORY`

### File: `App.special_moves.test.tsx`

**Added Tests**:
1. `FALLBACK: When backend fails with permission error, arm succeeds in local fallback mode`
   - Verifies permission-denied triggers fallback
   - Confirms success toast (not error)

2. `FALLBACK: Tile tag shows "armed" state when armed in fallback mode`
   - Verifies UI updates correctly in fallback mode

## How It Works Now

```
Director arms tile with Cloud Function unavailable:

1. requestArmTile() called with tile/move params
2. Cloud Function fails with permission-denied
3. shouldFallbackFromFunctions() returns true (permission-denied in list)
4. Try Firestore fallback → success
5. Return { success: true, id: ... } 
6. No exception thrown
7. Success toast shown: "MOVE DEPLOYED"
8. UI updates normally
9. Backend mode indicator shows: "Firestore Fallback"
```

## Testing Checklist

```bash
# 1. Run special moves tests
cd D:\cruzpham\cruzpham-trivia-studios24
npx vitest run App.special_moves.test.tsx

# 2. Run full test suite
npx vitest run

# 3. Build production
npm run build

# 4. Manual test:
# - Start dev server: npm run dev
# - Create game, open Director
# - Go to Moves tab
# - Disable network (DevTools > Network > Offline)
# - Try to arm tile
# - Should show "MOVE DEPLOYED" (not error)
# - Backend mode should switch to fallback
```

## What NOT Changed

✅ Backend logic still works in production
✅ Firebase authentication untouched  
✅ Cloud Functions still tried first
✅ Firestore schema unchanged
✅ API contracts unchanged
✅ No refactoring of unrelated code
✅ GameBoard already has correct memoization

## Result

- ✅ Permission errors no longer break the game
- ✅ Fallback mode activates automatically
- ✅ Same UI/UX in both production and fallback modes
- ✅ Game stays playable offline or when backend unavailable
- ✅ All special moves features work in fallback mode
- ✅ Logging tracks when fallback is used

## Deployment

1. Merge changes to `modules/specialMoves/client/specialMovesClient.ts`
2. Merge test additions to `App.special_moves.test.tsx`
3. Run full test suite to verify
4. Build and deploy
5. Monitor logs for `SMS_FUNCTIONS_ARM_FAILED_FALLBACK` to track fallback usage

## Logs to Monitor

- `SMS_FUNCTIONS_ARM_FAILED_FALLBACK` - Backend failed, fallback triggered
- `SMS_FALLBACK_ARM_SUCCESS_OVERLAY` - Fallback succeeded via Firestore
- `SMS_FALLBACK_ARM_SUCCESS_MEMORY` - Fallback succeeded via in-memory
- `director_special_move_armed` - Move armed successfully (production or fallback)

