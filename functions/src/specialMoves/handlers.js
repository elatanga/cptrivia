
const admin = require("firebase-admin");
const functions = require("firebase-functions");

const ALLOWED_MOVE_TYPES = new Set([
  'DOUBLE_TROUBLE',
  'TRIPLE_THREAT',
  'SABOTAGE',
  'MEGA_STEAL',
  'DOUBLE_WINS_OR_NOTHING',
  'TRIPLE_WINS_OR_NOTHING',
  'SAFE_BET',
  'LOCKOUT',
  'SUPER_SAVE',
  'GOLDEN_GAMBLE',
  'SHIELD_BOOST',
  'FINAL_SHOT'
]);

/**
 * Structured Logging Helper
 */
const logSMS = (event, context, metadata = {}) => {
  console.log(JSON.stringify({
    service: "specialMoves",
    event,
    gameId: context.gameId,
    correlationId: context.correlationId,
    idempotencyKey: context.idempotencyKey,
    timestamp: new Date().toISOString(),
    ...metadata
  }));
};

const throwSmsError = (code, message, details = {}) => {
  throw new functions.https.HttpsError(code, message, details);
};

/**
 * Handler: Arm a Tile
 */
exports.requestArm = async (data, context) => {
  const { gameId, tileId, moveType, actorId, idempotencyKey, correlationId } = data;
  const db = admin.firestore();

  if (!gameId || !tileId || !moveType || !idempotencyKey) {
    logSMS("ARM_REJECTED", { gameId, correlationId, idempotencyKey }, { reason: "MISSING_ARGS" });
    throwSmsError("invalid-argument", "Missing required fields", { reason: "MISSING_ARGS" });
  }

  if (!ALLOWED_MOVE_TYPES.has(moveType)) {
    logSMS("ARM_REJECTED", { gameId, correlationId, idempotencyKey }, { reason: "UNSUPPORTED_MOVE_TYPE", moveType });
    throwSmsError("invalid-argument", "Unsupported move type", { reason: "UNSUPPORTED_MOVE_TYPE", moveType });
  }

  logSMS("ARM_REQUEST_RECEIVED", { gameId, correlationId, idempotencyKey }, { moveType, tileId });

  const requestRef = db.collection(`games/${gameId}/specialMoves_requests`).doc(idempotencyKey);
  const activeCol = db.collection(`games/${gameId}/specialMoves_active`);
  const activeRef = activeCol.doc(idempotencyKey);

  return db.runTransaction(async (transaction) => {
    const existingReq = await transaction.get(requestRef);
    if (existingReq.exists) {
      logSMS("ARM_REQUEST_IDEMPOTENT", { gameId, correlationId, idempotencyKey });
      return { success: true, status: "ALREADY_EXISTS", id: idempotencyKey };
    }

    const conflictSnap = await transaction.get(activeCol.where("tileId", "==", tileId).limit(1));
    if (!conflictSnap.empty) {
      logSMS("ARM_REQUEST_CONFLICT", { gameId, correlationId, idempotencyKey }, { tileId });
      throwSmsError("already-exists", "Tile is already affected by an active move", { reason: "TILE_CONFLICT", tileId });
    }

    const requestDoc = {
      state: "APPROVED",
      moveType,
      scope: "TILE",
      tileId,
      actorId,
      actorRole: "director",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      idempotencyKey,
      correlationId
    };

    const activeDoc = {
      moveType,
      scope: "TILE",
      targetId: null,
      tileId,
      appliedAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      requestId: idempotencyKey,
      correlationId
    };

    transaction.set(requestRef, requestDoc);
    transaction.set(activeRef, activeDoc);
    logSMS("ARM_REQUEST_COMMITTED", { gameId, correlationId, idempotencyKey });
    return { success: true, id: idempotencyKey };
  });
};

/**
 * Handler: Approve Move
 */
exports.approveMove = async (data, context) => {
  const { gameId, requestId, correlationId } = data;
  const db = admin.firestore();

  if (!gameId || !requestId) {
    logSMS("APPROVE_REJECTED", { gameId, correlationId }, { reason: "MISSING_ARGS", requestId });
    throwSmsError("invalid-argument", "Missing required fields", { reason: "MISSING_ARGS" });
  }

  logSMS("APPROVE_REQUEST_RECEIVED", { gameId, correlationId }, { requestId });

  const requestRef = db.collection(`games/${gameId}/specialMoves_requests`).doc(requestId);
  const activeRef = db.collection(`games/${gameId}/specialMoves_active`).doc();
  const auditRef = db.collection(`games/${gameId}/specialMoves_audit`).doc();

  return db.runTransaction(async (transaction) => {
    const reqSnap = await transaction.get(requestRef);
    if (!reqSnap.exists) {
      throwSmsError("not-found", "Request does not exist", { requestId });
    }
    
    const req = reqSnap.data();
    if (req.state !== "REQUESTED") {
      throwSmsError("failed-precondition", "Request is not in REQUESTED state", { requestId, state: req.state });
    }

    transaction.update(requestRef, { state: "APPROVED", updatedAt: Date.now() });

    const activeDoc = {
      moveType: req.moveType,
      scope: req.scope,
      targetId: req.targetId || null,
      tileId: req.tileId || null,
      appliedAt: Date.now(),
      expiresAt: Date.now() + (req.ttlMs || 3600000),
      requestId: requestId,
      correlationId: correlationId
    };
    transaction.set(activeRef, activeDoc);

    transaction.set(auditRef, {
      eventType: "MOVE_APPROVED",
      summary: `Approved ${req.moveType} for ${req.tileId || req.targetId}`,
      createdAt: Date.now(),
      correlationId,
      idempotencyKey: `audit_${requestId}`
    });

    logSMS("MOVE_ACTIVATED", { gameId, correlationId }, { requestId, activeId: activeRef.id });
    return { success: true, activeId: activeRef.id };
  });
};

/**
 * Handler: Clear Armory
 */
exports.clearArmory = async (data, context) => {
  const { gameId, correlationId } = data;

  if (!gameId) {
    logSMS("CLEAR_ARMORY_REJECTED", { gameId, correlationId }, { reason: "MISSING_ARGS" });
    throwSmsError("invalid-argument", "Missing required fields", { reason: "MISSING_ARGS" });
  }

  const db = admin.firestore();
  const activeCol = db.collection(`games/${gameId}/specialMoves_active`);

  logSMS("CLEAR_ARMORY_REQUESTED", { gameId, correlationId });

  const snapshots = await activeCol.where("scope", "==", "TILE").get();
  const batch = db.batch();

  snapshots.forEach(doc => batch.delete(doc.ref));
  
  const auditRef = db.collection(`games/${gameId}/specialMoves_audit`).doc();
  batch.set(auditRef, {
    eventType: "ARMORY_CLEARED",
    summary: `Director cleared all armed tiles`,
    createdAt: Date.now(),
    correlationId,
    idempotencyKey: `clear_${Date.now()}`
  });

  await batch.commit();
  logSMS("ARMORY_CLEARED", { gameId, correlationId }, { count: snapshots.size });
  return { success: true, clearedCount: snapshots.size };
};
