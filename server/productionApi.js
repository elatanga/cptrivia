import express from "express";
import crypto from "crypto";
import { FieldValue } from "firebase-admin/firestore";
import { getFirebaseDb } from "./firebaseAdmin.js";
import { createDeliveryServices, DeliveryError, validateAndNormalizePhone, validateEmail } from "./delivery.js";
import { safeLog } from "./safeLog.js";

const COLLECTIONS = {
  USERS: "users",
  SESSIONS: "sessions",
  REQUESTS: "token_requests",
  AUDIT: "audit_logs",
  BOOTSTRAP: "system_bootstrap",
  SHOWS: "shows",
  TEMPLATES: "templates",
};

class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const normalizeTokenInput = (token) => String(token || "").trim().replace(/[\s-]/g, "");
const hashToken = (token) => crypto.createHash("sha256").update(normalizeTokenInput(token)).digest("hex");
const normalizeUsername = (username) => String(username || "").trim();
const usernameKey = (username) => normalizeUsername(username).toLowerCase();

const stripUndefined = (value) => {
  if (Array.isArray(value)) return value.map(stripUndefined);
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, entry] of Object.entries(value)) {
      if (entry !== undefined) next[key] = stripUndefined(entry);
    }
    return next;
  }
  return value;
};

const toIsoString = (value) => {
  if (!value) return new Date().toISOString();
  if (typeof value === "string") return value;
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  return new Date(value).toISOString();
};

const normalizeUser = (data, id) => ({
  ...data,
  id: data.id || id,
  createdAt: toIsoString(data.createdAt),
  updatedAt: toIsoString(data.updatedAt),
});

const normalizeRequest = (data, id) => ({
  ...data,
  id: data.id || id,
  createdAt: toIsoString(data.createdAt),
  updatedAt: toIsoString(data.updatedAt),
  adminNotifyStatus: data.adminNotifyStatus || data.notify?.emailStatus || "PENDING",
  adminNotifyError: data.adminNotifyError || data.notify?.lastError,
  userNotifyStatus: data.userNotifyStatus || "PENDING",
});

const normalizeAudit = (data, id) => ({
  ...data,
  id: data.id || id,
  timestamp: toIsoString(data.timestamp),
});

const validateNonEmpty = (value, field) => {
  const text = String(value || "").trim();
  if (!text) throw new ApiError(400, "ERR_VALIDATION", `${field} is required.`);
  return text;
};

const validateUsername = (value) => {
  const username = validateNonEmpty(value, "Username");
  if (!/^[a-zA-Z0-9_.-]{3,40}$/.test(username)) {
    throw new ApiError(400, "ERR_VALIDATION", "Username must be 3-40 letters, numbers, dots, dashes, or underscores.");
  }
  return username;
};

const validateRole = (role) => {
  if (!["MASTER_ADMIN", "ADMIN", "PRODUCER"].includes(role)) {
    throw new ApiError(400, "ERR_VALIDATION", "Invalid role.");
  }
  return role;
};

const publicError = (error) => {
  if (error instanceof ApiError) return error;
  if (error instanceof DeliveryError) {
    return new ApiError(error.code === "ERR_VALIDATION" ? 400 : 502, error.code, error.message);
  }
  return new ApiError(500, "ERR_NETWORK", "Service unavailable. Please try again.");
};

const sendApiError = (res, error, log) => {
  const apiError = publicError(error);
  if (!(error instanceof ApiError) && !(error instanceof DeliveryError)) {
    log("ERROR", "apiUnhandledError", { error });
  }
  res.status(apiError.status).json({
    success: false,
    code: apiError.code,
    message: apiError.message,
  });
};

const route = (handler, log) => async (req, res) => {
  try {
    const data = await handler(req, res);
    if (!res.headersSent) res.json({ success: true, data });
  } catch (error) {
    sendApiError(res, error, log);
  }
};

async function findUserByUsername(db, username) {
  const key = usernameKey(username);
  if (!key) return null;

  const direct = await db.collection(COLLECTIONS.USERS).doc(key).get();
  if (direct.exists) return { ref: direct.ref, user: normalizeUser(direct.data(), direct.id) };

  const byLower = await db.collection(COLLECTIONS.USERS).where("usernameLower", "==", key).limit(1).get();
  if (!byLower.empty) {
    const doc = byLower.docs[0];
    return { ref: doc.ref, user: normalizeUser(doc.data(), doc.id) };
  }

  const byExact = await db.collection(COLLECTIONS.USERS).where("username", "==", normalizeUsername(username)).limit(1).get();
  if (!byExact.empty) {
    const doc = byExact.docs[0];
    return { ref: doc.ref, user: normalizeUser(doc.data(), doc.id) };
  }

  return null;
}

async function deleteSessionsForUser(db, username) {
  const sessions = await db.collection(COLLECTIONS.SESSIONS).where("username", "==", username).get();
  const batch = db.batch();
  sessions.docs.forEach((doc) => batch.delete(doc.ref));
  await batch.commit();
}

async function requireSession(db, req) {
  const sessionId = req.get("X-CPJS-Session") || req.body?.sessionId;
  if (!sessionId) throw new ApiError(401, "ERR_SESSION_EXPIRED", "Session expired.");

  const snap = await db.collection(COLLECTIONS.SESSIONS).doc(sessionId).get();
  if (!snap.exists) throw new ApiError(401, "ERR_SESSION_EXPIRED", "Session expired.");

  const session = snap.data();
  const found = await findUserByUsername(db, session.username);
  if (!found || found.user.status === "REVOKED") {
    throw new ApiError(403, "ERR_FORBIDDEN", "Account access revoked.");
  }

  return { ...session, id: sessionId, user: found.user };
}

async function requireAdmin(db, req, actorUsername) {
  const session = await requireSession(db, req);
  if (actorUsername && session.username !== actorUsername) {
    throw new ApiError(403, "ERR_FORBIDDEN", "Session actor mismatch.");
  }
  if (!["MASTER_ADMIN", "ADMIN"].includes(session.role)) {
    throw new ApiError(403, "ERR_FORBIDDEN", "Admin permissions required.");
  }
  return session;
}

async function logAction(db, actor, action, details, metadata = undefined, targetId = undefined) {
  const entry = stripUndefined({
    id: crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    actorId: typeof actor === "string" ? actor : actor.username,
    actorRole: typeof actor === "string" ? "SYSTEM" : actor.role,
    targetId,
    action,
    details,
    metadata,
  });
  await db.collection(COLLECTIONS.AUDIT).doc(entry.id).set(entry);
}

async function createUser(db, actor, userData, role, durationMinutes) {
  const username = validateUsername(userData?.username);
  const key = usernameKey(username);
  const existing = await findUserByUsername(db, username);
  if (existing) throw new ApiError(409, "ERR_FORBIDDEN", "Username taken.");

  validateRole(role);
  if (actor.role !== "MASTER_ADMIN" && role === "ADMIN") {
    throw new ApiError(403, "ERR_FORBIDDEN", "Only Master Admin can create Admins.");
  }

  const rawToken = `${role === "ADMIN" ? "ak" : "pk"}-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const expiresAt = durationMinutes ? new Date(Date.now() + Number(durationMinutes) * 60000).toISOString() : null;
  const user = stripUndefined({
    id: key,
    username,
    usernameLower: key,
    tokenHash: hashToken(rawToken),
    role,
    status: "ACTIVE",
    email: userData.email ? validateEmail(userData.email) : undefined,
    phone: userData.phone ? validateAndNormalizePhone(userData.phone) : undefined,
    profile: {
      firstName: userData.profile?.firstName,
      lastName: userData.profile?.lastName,
      tiktokHandle: userData.profile?.tiktokHandle,
      source: userData.profile?.source || "MANUAL_CREATE",
      originalRequestId: userData.profile?.originalRequestId,
    },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt,
    createdBy: actor.username,
  });

  await db.collection(COLLECTIONS.USERS).doc(key).set(user);
  await logAction(db, actor, role === "ADMIN" ? "ADMIN_CREATED" : "USER_CREATED", `Created ${role} ${username}`, { role, expiresAt }, username);
  return { token: rawToken, user };
}

async function notifyAdminsForRequest(db, delivery, env, request, correlationId) {
  const updates = {};
  const responseUpdates = {};
  const adminEmails = String(env.ADMIN_EMAILS || "").split(",").map((v) => v.trim()).filter(Boolean);
  const adminPhones = String(env.ADMIN_PHONES || "").split(",").map((v) => v.trim()).filter(Boolean);

  if (adminEmails.length > 0) {
    try {
      await delivery.sendEmail(
        adminEmails,
        `[CRUZPHAM] New Token Request: ${request.preferredUsername}`,
        `New request from ${request.firstName} ${request.lastName} (@${request.tiktokHandle}).\nPhone: ${request.phoneE164}\nID: ${request.id}\n\nPlease review in Admin Console.`,
        correlationId
      );
      updates.adminNotifyStatus = "SENT";
      updates.adminNotifyError = FieldValue.delete();
      responseUpdates.adminNotifyStatus = "SENT";
      delete responseUpdates.adminNotifyError;
    } catch (error) {
      updates.adminNotifyStatus = "FAILED";
      updates.adminNotifyError = "Email delivery failed.";
      responseUpdates.adminNotifyStatus = "FAILED";
      responseUpdates.adminNotifyError = "Email delivery failed.";
    }
  }

  if (adminPhones.length > 0) {
    const smsResults = await Promise.allSettled(adminPhones.map((phone) =>
      delivery.sendSms(phone, `[CRUZPHAM] Request ${request.id}: ${request.preferredUsername}`, correlationId)
    ));
    if (smsResults.some((result) => result.status === "fulfilled")) {
      updates.adminNotifyStatus = "SENT";
      updates.adminNotifyError = FieldValue.delete();
      responseUpdates.adminNotifyStatus = "SENT";
      delete responseUpdates.adminNotifyError;
    } else if (!updates.adminNotifyStatus) {
      updates.adminNotifyStatus = "FAILED";
      updates.adminNotifyError = "SMS delivery failed.";
      responseUpdates.adminNotifyStatus = "FAILED";
      responseUpdates.adminNotifyError = "SMS delivery failed.";
    }
  }

  if (!updates.adminNotifyStatus) {
    updates.adminNotifyStatus = "FAILED";
    updates.adminNotifyError = "No admin notification recipients configured.";
    responseUpdates.adminNotifyStatus = "FAILED";
    responseUpdates.adminNotifyError = "No admin notification recipients configured.";
  }

  await db.collection(COLLECTIONS.REQUESTS).doc(request.id).update(updates);
  return { ...request, ...responseUpdates };
}

function validateTokenRequest(data) {
  return {
    firstName: validateNonEmpty(data?.firstName, "First name").slice(0, 80),
    lastName: validateNonEmpty(data?.lastName, "Last name").slice(0, 80),
    tiktokHandle: validateNonEmpty(data?.tiktokHandle, "TikTok handle").replace(/^@/, "").slice(0, 80),
    preferredUsername: validateUsername(data?.preferredUsername),
    phoneE164: validateAndNormalizePhone(data?.phoneE164),
  };
}

function assertTemplateShape(parsed) {
  if (!parsed.topic || !Array.isArray(parsed.categories) || !parsed.config) {
    throw new ApiError(400, "ERR_VALIDATION", "Invalid template schema.");
  }
  if (parsed.categories.length > 8 || parsed.config.rowCount > 10 || parsed.config.playerCount > 8) {
    throw new ApiError(400, "ERR_VALIDATION", "Template exceeds allowed limits.");
  }
}

async function assertShowAccess(db, session, showId) {
  const snap = await db.collection(COLLECTIONS.SHOWS).doc(showId).get();
  if (!snap.exists) throw new ApiError(404, "ERR_UNKNOWN", "Show not found.");
  const show = snap.data();
  if (show.userId !== session.username && !["MASTER_ADMIN", "ADMIN"].includes(session.role)) {
    throw new ApiError(403, "ERR_FORBIDDEN", "Show access denied.");
  }
  return { ...show, id: snap.id };
}

export function createProductionApiRouter({
  db,
  delivery = createDeliveryServices(),
  env = process.env,
  log = safeLog,
} = {}) {
  const router = express.Router();
  const resolvedDb = db || new Proxy({}, {
    get(_target, prop) {
      return getFirebaseDb(env)[prop];
    },
  });
  db = resolvedDb;

  router.get("/bootstrap/status", route(async () => {
    const snap = await db.collection(COLLECTIONS.BOOTSTRAP).doc("config").get();
    return { masterReady: snap.exists && snap.data()?.masterReady === true };
  }, log));

  router.post("/bootstrap/master", route(async (req) => {
    const username = validateUsername(req.body?.username || "admin");
    const result = await db.runTransaction(async (transaction) => {
      const configRef = db.collection(COLLECTIONS.BOOTSTRAP).doc("config");
      const configSnap = await transaction.get(configRef);
      if (configSnap.exists && configSnap.data()?.masterReady) {
        throw new ApiError(409, "ERR_BOOTSTRAP_COMPLETE", "System already bootstrapped.");
      }

      const key = usernameKey(username);
      const userRef = db.collection(COLLECTIONS.USERS).doc(key);
      const userSnap = await transaction.get(userRef);
      if (userSnap.exists) {
        throw new ApiError(409, "ERR_BOOTSTRAP_COMPLETE", "System already bootstrapped.");
      }

      const rawToken = `mk-${crypto.randomUUID().replace(/-/g, "")}`;
      const now = new Date().toISOString();
      const user = {
        id: key,
        username,
        usernameLower: key,
        tokenHash: hashToken(rawToken),
        role: "MASTER_ADMIN",
        status: "ACTIVE",
        profile: { source: "MANUAL_CREATE", firstName: "System", lastName: "Admin" },
        createdAt: now,
        updatedAt: now,
        createdBy: "SYSTEM",
      };

      transaction.set(userRef, user);
      transaction.set(configRef, {
        masterReady: true,
        createdAt: now,
        masterAdminId: key,
      });

      return rawToken;
    });

    await logAction(db, "SYSTEM", "BOOTSTRAP", "Master Admin created");
    return { token: result };
  }, log));

  router.post("/auth/login", route(async (req) => {
    const username = validateNonEmpty(req.body?.username, "Username");
    const token = validateNonEmpty(req.body?.token, "Token");
    const found = await findUserByUsername(db, username);

    if (!found || found.user.tokenHash !== hashToken(token)) {
      return { success: false, message: "Invalid credentials.", code: "ERR_INVALID_CREDENTIALS" };
    }
    if (found.user.status === "REVOKED") {
      return { success: false, message: "Account access revoked.", code: "ERR_FORBIDDEN" };
    }
    if (found.user.expiresAt && Date.now() > new Date(found.user.expiresAt).getTime()) {
      return { success: false, message: "Access token expired.", code: "ERR_SESSION_EXPIRED" };
    }

    await deleteSessionsForUser(db, found.user.username);

    const session = {
      id: crypto.randomUUID(),
      username: found.user.username,
      role: found.user.role,
      createdAt: Date.now(),
      userAgent: String(req.get("user-agent") || "").slice(0, 500),
    };
    await db.collection(COLLECTIONS.SESSIONS).doc(session.id).set(session);
    await logAction(db, found.user, "LOGIN", "User logged in");
    return { success: true, session };
  }, log));

  router.post("/auth/restore", route(async (req) => {
    const session = await requireSession(db, req);
    return {
      success: true,
      session: {
        id: session.id,
        username: session.username,
        role: session.role,
        createdAt: session.createdAt,
        userAgent: session.userAgent || "",
      },
    };
  }, log));

  router.post("/auth/logout", route(async (req) => {
    const sessionId = req.body?.sessionId || req.get("X-CPJS-Session");
    if (sessionId) await db.collection(COLLECTIONS.SESSIONS).doc(sessionId).delete();
    return { success: true };
  }, log));

  router.post("/token-requests", route(async (req) => {
    const input = validateTokenRequest(req.body);
    const id = crypto.randomUUID().split("-")[0].toUpperCase();
    const now = new Date().toISOString();
    const request = {
      id,
      ...input,
      status: "PENDING",
      createdAt: now,
      updatedAt: now,
      adminNotifyStatus: "PENDING",
      userNotifyStatus: "PENDING",
    };

    await db.collection(COLLECTIONS.REQUESTS).doc(id).set(request);
    await logAction(db, "SYSTEM", "REQUEST_SUBMITTED", `New request from ${input.firstName}`, undefined, id);
    return notifyAdminsForRequest(db, delivery, env, request, req.body?.correlationId);
  }, log));

  router.get("/admin/users", route(async (req) => {
    await requireAdmin(db, req);
    const snap = await db.collection(COLLECTIONS.USERS).get();
    return snap.docs
      .map((doc) => normalizeUser(doc.data(), doc.id))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, log));

  router.post("/admin/users", route(async (req) => {
    const actor = await requireAdmin(db, req, req.body?.actorUsername);
    return createUser(db, actor.user, req.body?.userData || {}, req.body?.role, req.body?.durationMinutes);
  }, log));

  router.post("/admin/users/:username/token", route(async (req) => {
    const actor = await requireAdmin(db, req, req.body?.actorUsername);
    const found = await findUserByUsername(db, req.params.username);
    if (!found) throw new ApiError(404, "ERR_UNKNOWN", "User not found.");
    if (found.user.role === "MASTER_ADMIN" && actor.role !== "MASTER_ADMIN") {
      throw new ApiError(403, "ERR_FORBIDDEN", "Cannot modify Master Admin.");
    }

    const rawToken = `${found.user.role === "ADMIN" ? "ak" : "pk"}-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
    await found.ref.update({ tokenHash: hashToken(rawToken), updatedAt: new Date().toISOString() });
    await deleteSessionsForUser(db, found.user.username);
    await logAction(db, actor.user, "TOKEN_REFRESHED", `Rotated token for ${found.user.username}`, { action: "ROTATE" }, found.user.username);
    return { token: rawToken };
  }, log));

  router.post("/admin/users/:username/access", route(async (req) => {
    const actor = await requireAdmin(db, req, req.body?.actorUsername);
    const found = await findUserByUsername(db, req.params.username);
    if (!found) throw new ApiError(404, "ERR_UNKNOWN", "User not found.");
    if (found.user.role === "MASTER_ADMIN") throw new ApiError(403, "ERR_FORBIDDEN", "Cannot revoke Master Admin.");
    if (found.user.role === "ADMIN" && actor.role !== "MASTER_ADMIN") {
      throw new ApiError(403, "ERR_FORBIDDEN", "Only Master Admin can modify Admins.");
    }

    const revoke = req.body?.revoke === true;
    await found.ref.update({ status: revoke ? "REVOKED" : "ACTIVE", updatedAt: new Date().toISOString() });
    if (revoke) await deleteSessionsForUser(db, found.user.username);
    await logAction(db, actor.user, revoke ? "ACCESS_REVOKED" : "ACCESS_GRANTED", `${revoke ? "Revoked" : "Granted"} access for ${found.user.username}`, undefined, found.user.username);
    return { success: true };
  }, log));

  router.delete("/admin/users/:username", route(async (req) => {
    const actor = await requireAdmin(db, req, req.body?.actorUsername);
    const found = await findUserByUsername(db, req.params.username);
    if (!found) return { success: true };
    if (found.user.role === "MASTER_ADMIN") throw new ApiError(403, "ERR_FORBIDDEN", "Cannot delete Master Admin.");
    if (found.user.role === "ADMIN" && actor.role !== "MASTER_ADMIN") {
      throw new ApiError(403, "ERR_FORBIDDEN", "Only Master Admin can delete Admins.");
    }

    await found.ref.delete();
    await deleteSessionsForUser(db, found.user.username);
    await logAction(db, actor.user, "USER_DELETED", `Deleted user ${found.user.username}`, { role: found.user.role }, found.user.username);
    return { success: true };
  }, log));

  router.post("/admin/messages", route(async (req) => {
    const actor = await requireAdmin(db, req, req.body?.actorUsername);
    const found = await findUserByUsername(db, req.body?.targetUsername);
    if (!found) throw new ApiError(404, "ERR_UNKNOWN", "User not found.");

    const method = req.body?.method;
    if (!["EMAIL", "SMS"].includes(method)) throw new ApiError(400, "ERR_VALIDATION", "Invalid delivery method.");

    const destination = method === "EMAIL" ? found.user.email : found.user.phone;
    if (!destination) throw new ApiError(400, "ERR_VALIDATION", `User has no ${method === "EMAIL" ? "email" : "phone"} on file.`);

    const sent = method === "EMAIL"
      ? await delivery.sendEmail(destination, "Message from CruzPham Studios", req.body?.content, req.body?.correlationId)
      : await delivery.sendSms(destination, req.body?.content, req.body?.correlationId);

    const deliveryLog = {
      id: crypto.randomUUID(),
      method,
      status: "SENT",
      timestamp: sent.timestamp,
      providerId: sent.id,
    };
    await found.ref.update({ lastDelivery: deliveryLog });
    await logAction(db, actor.user, method === "EMAIL" ? "MESSAGE_SENT_EMAIL" : "MESSAGE_SENT_SMS", `Sent ${method} to ${found.user.username}`, { status: "SENT" }, found.user.username);
    return deliveryLog;
  }, log));

  router.get("/admin/token-requests", route(async (req) => {
    await requireAdmin(db, req);
    const snap = await db.collection(COLLECTIONS.REQUESTS).get();
    return snap.docs
      .map((doc) => normalizeRequest(doc.data(), doc.id))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, log));

  router.post("/admin/token-requests/:requestId/retry-notification", route(async (req) => {
    await requireAdmin(db, req);
    const ref = db.collection(COLLECTIONS.REQUESTS).doc(req.params.requestId);
    const snap = await ref.get();
    if (!snap.exists) throw new ApiError(404, "ERR_REQUEST_NOT_FOUND", "Request not found.");
    const request = normalizeRequest(snap.data(), snap.id);
    await notifyAdminsForRequest(db, delivery, env, request, req.body?.correlationId);
    return { success: true };
  }, log));

  router.post("/admin/token-requests/:requestId/approve", route(async (req) => {
    const actor = await requireAdmin(db, req, req.body?.actorUsername);
    const requestRef = db.collection(COLLECTIONS.REQUESTS).doc(req.params.requestId);
    const rawToken = `pk-${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;

    const result = await db.runTransaction(async (transaction) => {
      const reqSnap = await transaction.get(requestRef);
      if (!reqSnap.exists) throw new ApiError(404, "ERR_REQUEST_NOT_FOUND", "Request not found.");
      const request = normalizeRequest(reqSnap.data(), reqSnap.id);
      if (request.status !== "PENDING") {
        throw new ApiError(409, "ERR_REQUEST_ALREADY_PROCESSED", "Request is not pending.");
      }

      const finalUsername = validateUsername(req.body?.customUsername || request.preferredUsername);
      const userKey = usernameKey(finalUsername);
      const userRef = db.collection(COLLECTIONS.USERS).doc(userKey);
      const existingUser = await transaction.get(userRef);
      if (existingUser.exists) throw new ApiError(409, "ERR_FORBIDDEN", "Username taken.");

      const now = new Date().toISOString();
      const user = stripUndefined({
        id: userKey,
        username: finalUsername,
        usernameLower: userKey,
        tokenHash: hashToken(rawToken),
        role: "PRODUCER",
        status: "ACTIVE",
        phone: request.phoneE164,
        profile: {
          firstName: request.firstName,
          lastName: request.lastName,
          tiktokHandle: request.tiktokHandle,
          source: "REQUEST_APPROVAL",
          originalRequestId: request.id,
        },
        createdAt: now,
        updatedAt: now,
        createdBy: actor.username,
      });

      transaction.set(userRef, user);
      transaction.update(requestRef, {
        status: "APPROVED",
        updatedAt: now,
        approvedAt: now,
        userId: user.id,
        userNotifyStatus: "PENDING",
      });
      return { request, user, finalUsername };
    });

    try {
      await delivery.sendSms(result.request.phoneE164, `APPROVED. Welcome to CruzPham Studios. Token: ${rawToken} . Login at studio.cruzpham.com`, req.body?.correlationId);
      await requestRef.update({ userNotifyStatus: "SENT", userNotifyError: FieldValue.delete() });
    } catch {
      await requestRef.update({ userNotifyStatus: "FAILED", userNotifyError: "SMS delivery failed." });
    }

    await logAction(db, actor.user, "REQUEST_APPROVED", `Approved ${req.params.requestId}. User ${result.finalUsername} created.`, undefined, result.user.id);
    return { rawToken, user: result.user };
  }, log));

  router.post("/admin/token-requests/:requestId/reject", route(async (req) => {
    const actor = await requireAdmin(db, req, req.body?.actorUsername);
    const ref = db.collection(COLLECTIONS.REQUESTS).doc(req.params.requestId);
    await db.runTransaction(async (transaction) => {
      const snap = await transaction.get(ref);
      if (!snap.exists) throw new ApiError(404, "ERR_REQUEST_NOT_FOUND", "Request not found.");
      const request = normalizeRequest(snap.data(), snap.id);
      if (request.status !== "PENDING") {
        throw new ApiError(409, "ERR_REQUEST_ALREADY_PROCESSED", "Request is not pending.");
      }
      transaction.update(ref, {
        status: "REJECTED",
        updatedAt: new Date().toISOString(),
        rejectedAt: new Date().toISOString(),
      });
    });
    await logAction(db, actor.user, "REQUEST_REJECTED", `Rejected request ${req.params.requestId}`, undefined, req.params.requestId);
    return { success: true };
  }, log));

  router.get("/admin/audit-logs", route(async (req) => {
    await requireAdmin(db, req);
    const snap = await db.collection(COLLECTIONS.AUDIT).get();
    return snap.docs
      .map((doc) => normalizeAudit(doc.data(), doc.id))
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, log));

  router.get("/shows", route(async (req) => {
    const session = await requireSession(db, req);
    const requestedUsername = req.query.username ? String(req.query.username) : session.username;
    if (requestedUsername !== session.username && !["MASTER_ADMIN", "ADMIN"].includes(session.role)) {
      throw new ApiError(403, "ERR_FORBIDDEN", "Show access denied.");
    }
    const snap = await db.collection(COLLECTIONS.SHOWS).where("userId", "==", requestedUsername).get();
    return snap.docs
      .map((doc) => ({ ...doc.data(), id: doc.id, createdAt: toIsoString(doc.data().createdAt) }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, log));

  router.get("/shows/:showId", route(async (req) => {
    const session = await requireSession(db, req);
    return assertShowAccess(db, session, req.params.showId);
  }, log));

  router.post("/shows", route(async (req) => {
    const session = await requireSession(db, req);
    const username = validateNonEmpty(req.body?.username, "Username");
    if (username !== session.username && !["MASTER_ADMIN", "ADMIN"].includes(session.role)) {
      throw new ApiError(403, "ERR_FORBIDDEN", "Show access denied.");
    }
    const show = {
      id: crypto.randomUUID(),
      userId: username,
      title: validateNonEmpty(req.body?.title, "Show title").slice(0, 120),
      createdAt: new Date().toISOString(),
    };
    await db.collection(COLLECTIONS.SHOWS).doc(show.id).set(show);
    return show;
  }, log));

  router.get("/templates", route(async (req) => {
    const session = await requireSession(db, req);
    const showId = validateNonEmpty(req.query.showId, "Show ID");
    await assertShowAccess(db, session, showId);
    const snap = await db.collection(COLLECTIONS.TEMPLATES).where("showId", "==", showId).get();
    return snap.docs
      .map((doc) => ({ ...doc.data(), id: doc.id, createdAt: toIsoString(doc.data().createdAt) }))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, log));

  router.post("/templates", route(async (req) => {
    const session = await requireSession(db, req);
    const showId = validateNonEmpty(req.body?.showId, "Show ID");
    await assertShowAccess(db, session, showId);

    const existing = await db.collection(COLLECTIONS.TEMPLATES).where("showId", "==", showId).get();
    if (existing.size >= 40) throw new ApiError(400, "ERR_LIMIT_REACHED", "Limit reached.");

    const template = {
      id: crypto.randomUUID(),
      showId,
      topic: validateNonEmpty(req.body?.topic, "Topic").slice(0, 160),
      config: req.body?.config,
      categories: Array.isArray(req.body?.categories) ? req.body.categories : [],
      createdAt: new Date().toISOString(),
    };
    assertTemplateShape(template);
    await db.collection(COLLECTIONS.TEMPLATES).doc(template.id).set(stripUndefined(template));
    return template;
  }, log));

  router.put("/templates/:templateId", route(async (req) => {
    const session = await requireSession(db, req);
    const ref = db.collection(COLLECTIONS.TEMPLATES).doc(req.params.templateId);
    const snap = await ref.get();
    if (!snap.exists) throw new ApiError(404, "ERR_UNKNOWN", "Template not found.");
    const current = snap.data();
    await assertShowAccess(db, session, current.showId);
    const template = stripUndefined({
      ...current,
      ...req.body?.template,
      id: req.params.templateId,
      showId: current.showId,
      lastModified: new Date().toISOString(),
    });
    assertTemplateShape(template);
    await ref.set(template);
    return template;
  }, log));

  router.delete("/templates/:templateId", route(async (req) => {
    const session = await requireSession(db, req);
    const ref = db.collection(COLLECTIONS.TEMPLATES).doc(req.params.templateId);
    const snap = await ref.get();
    if (!snap.exists) return { showId: "" };
    const template = snap.data();
    await assertShowAccess(db, session, template.showId);
    await ref.delete();
    return { showId: template.showId };
  }, log));

  router.post("/templates/import", route(async (req) => {
    const session = await requireSession(db, req);
    const showId = validateNonEmpty(req.body?.showId, "Show ID");
    await assertShowAccess(db, session, showId);

    let parsed;
    try {
      parsed = JSON.parse(String(req.body?.jsonContent || ""));
    } catch {
      throw new ApiError(400, "ERR_VALIDATION", "Invalid JSON.");
    }
    assertTemplateShape(parsed);

    const existing = await db.collection(COLLECTIONS.TEMPLATES).where("showId", "==", showId).get();
    if (existing.size >= 40) throw new ApiError(400, "ERR_LIMIT_REACHED", "Limit reached.");

    const template = {
      id: crypto.randomUUID(),
      showId,
      topic: `${parsed.topic} (Imported)`,
      config: parsed.config,
      categories: parsed.categories.map((category) => ({
        ...category,
        id: crypto.randomUUID(),
        questions: (category.questions || []).map((question) => ({
          ...question,
          id: crypto.randomUUID(),
          isRevealed: false,
          isAnswered: false,
        })),
      })),
      createdAt: new Date().toISOString(),
    };
    await db.collection(COLLECTIONS.TEMPLATES).doc(template.id).set(stripUndefined(template));
    return template;
  }, log));

  return router;
}
