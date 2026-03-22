const functions = require('firebase-functions');
const admin = require('firebase-admin');
const sgMail = require('@sendgrid/mail');
const twilio = require('twilio');
const crypto = require('crypto');
const specialMoveHandlers = require('./src/specialMoves/handlers');
const { syncSMSOverlay } = require('./specialMoves/overlayProcessor');
const { createSystemStatusCorsPolicy, createGetSystemStatusHandler } = require('./src/systemStatusHttp');

admin.initializeApp();
const db = admin.firestore();

const {
  SENDGRID_API_KEY,
  TWILIO_ACCOUNT_SID,
  TWILIO_AUTH_TOKEN,
  TWILIO_FROM_NUMBER,
  ADMIN_EMAILS: ENV_ADMIN_EMAILS,
  ADMIN_PHONES: ENV_ADMIN_PHONES,
} = process.env;

const ADMIN_EMAILS = (ENV_ADMIN_EMAILS || '').split(',').map((e) => e.trim()).filter(Boolean);
const ADMIN_PHONES = (ENV_ADMIN_PHONES || '').split(',').map((p) => p.trim()).filter(Boolean);

if (SENDGRID_API_KEY) sgMail.setApiKey(SENDGRID_API_KEY);
const twilioClient = (TWILIO_ACCOUNT_SID && TWILIO_AUTH_TOKEN) ? twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN) : null;

const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
const NAME_PATTERN = /^[A-Za-z][A-Za-z' -]{0,47}$/;
const TIKTOK_PATTERN = /^[A-Za-z0-9._]{1,32}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MASTER_RECOVERY_TTL_MS = 15 * 60 * 1000;
const REQUEST_REVIEW_LOCK_MS = 2 * 60 * 1000;
const REQUEST_DEDUP_WINDOW_MS = 5 * 60 * 1000;
const DELIVERY_COOLDOWN_MS = 60 * 1000;
const DELIVERY_METHODS = new Set(['EMAIL', 'SMS']);
const DEFAULT_FUNCTIONS_REGION = 'us-central1';
const FIREBASE_PROJECT_ID = process.env.GCLOUD_PROJECT || process.env.GCP_PROJECT || (admin.app().options && admin.app().options.projectId) || '';
const EXTRA_ALLOWED_APP_ORIGINS = (process.env.ALLOWED_APP_ORIGINS || '').split(',').map((origin) => origin.trim()).filter(Boolean);
const ALLOW_LOCALHOST_CORS = String(process.env.ALLOW_LOCALHOST_CORS || '').trim().toLowerCase() === 'true';

const configRef = db.collection('system_bootstrap').doc('config');
const recoveryRef = db.collection('system_bootstrap').doc('recovery');
const usersCollection = db.collection('users');
const sessionsCollection = db.collection('studio_sessions');
const requestsCollection = db.collection('token_requests');
const auditLogsCollection = db.collection('audit_logs');

const maskPII = (data) => {
  if (typeof data === 'string') {
    let text = data;
    text = text.replace(/([a-zA-Z0-9._-]+)(@[a-zA-Z0-9._-]+\.[a-zA-Z0-9._-]+)/gi, (match, user, domain) => `${user.substring(0, 2)}***${domain}`);
    text = text.replace(/(\+?\d{1,3}[- ]?)?\(?\d{3}\)?[- ]?\d{3}[- ]?\d{4}/g, (match) => `${match.substring(0, 3)}****${match.substring(match.length - 2)}`);
    text = text.replace(/([smakprc]k-[a-zA-Z0-9]{3})[a-zA-Z0-9]+/g, '$1********');
    text = text.replace(/(AIza[a-zA-Z0-9_-]{5})[a-zA-Z0-9_-]+/g, '$1********');
    return text;
  }
  if (data instanceof Error) {
    return { message: maskPII(data.message), stack: maskPII(data.stack) };
  }
  if (typeof data === 'object' && data !== null) {
    if (Array.isArray(data)) return data.map(maskPII);
    const masked = {};
    Object.keys(data).forEach((key) => {
      if (key.match(/token|password|secret|key/i)) masked[key] = '********';
      else masked[key] = maskPII(data[key]);
    });
    return masked;
  }
  return data;
};

const log = (severity, category, message, correlationId, data = {}) => {
  const safeData = maskPII(data);
  console.log(JSON.stringify({
    severity,
    message: `[${category}] ${maskPII(message)}`,
    category,
    correlationId: correlationId || 'unknown',
    component: 'cloud-functions',
    timestamp: new Date().toISOString(),
    ...safeData,
  }));
};

const normalizeToken = (token) => String(token || '').trim().replace(/[\s-]/g, '');
const hashToken = (token) => crypto.createHash('sha256').update(normalizeToken(token)).digest('hex');
const generateSecret = (prefix, bytes = 24) => `${prefix}-${crypto.randomBytes(bytes).toString('hex')}`;
const nowIso = () => new Date().toISOString();

const systemStatusCorsPolicy = createSystemStatusCorsPolicy({
  projectId: FIREBASE_PROJECT_ID,
  extraAllowedOrigins: EXTRA_ALLOWED_APP_ORIGINS,
  allowLocalhostCors: ALLOW_LOCALHOST_CORS,
});

const getCorrelationIdFromHttpRequest = (req) => {
  const body = req && req.body;
  if (typeof body === 'string') {
    try {
      const parsed = JSON.parse(body);
      return parsed && (parsed.correlationId || (parsed.data && parsed.data.correlationId));
    } catch {
      return req.get('X-Correlation-ID') || undefined;
    }
  }
  return (body && (body.correlationId || (body.data && body.data.correlationId))) || req.get('X-Correlation-ID') || undefined;
};

const toIso = (value) => {
  if (!value) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return value;
  if (typeof value.toDate === 'function') return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
};

const serializeForClient = (value) => {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(serializeForClient);
  if (typeof value === 'object') {
    if (typeof value.toDate === 'function') return value.toDate().toISOString();
    const output = {};
    Object.keys(value).forEach((key) => {
      output[key] = serializeForClient(value[key]);
    });
    return output;
  }
  return value;
};

const sanitizeUsername = (username, label = 'Username') => {
  const sanitized = String(username || '').trim();
  if (!USERNAME_PATTERN.test(sanitized)) {
    throw new functions.https.HttpsError('invalid-argument', `${label} must be 3-32 characters and use letters, numbers, dots, dashes, or underscores.`);
  }
  return sanitized;
};

const sanitizeOptionalName = (value, label = 'Name') => {
  if (!value) return undefined;
  const sanitized = String(value).trim().replace(/\s+/g, ' ');
  if (!sanitized) return undefined;
  if (!NAME_PATTERN.test(sanitized)) {
    throw new functions.https.HttpsError('invalid-argument', `${label} contains unsupported characters.`);
  }
  return sanitized;
};

const sanitizeTikTokHandle = (value) => {
  if (!value) return undefined;
  const sanitized = String(value).trim().replace(/^@+/, '');
  if (!sanitized) return undefined;
  if (!TIKTOK_PATTERN.test(sanitized)) {
    throw new functions.https.HttpsError('invalid-argument', 'TikTok handle must use letters, numbers, periods, or underscores.');
  }
  return sanitized;
};

const sanitizeOptionalEmail = (value) => {
  if (!value) return undefined;
  const email = String(value).trim().toLowerCase();
  if (!email) return undefined;
  if (!EMAIL_PATTERN.test(email)) {
    throw new functions.https.HttpsError('invalid-argument', 'Please enter a valid email address.');
  }
  return email;
};

const sanitizeOptionalNotes = (value) => {
  if (!value) return undefined;
  const notes = String(value).trim();
  return notes ? notes.slice(0, 500) : undefined;
};

const normalizePhone = (phone) => {
  if (!phone) throw new functions.https.HttpsError('invalid-argument', 'Phone number is required.');
  let cleaned = String(phone).replace(/[\s().-]/g, '');
  if (/^[2-9]\d{9}$/.test(cleaned)) cleaned = `+1${cleaned}`;
  else if (/^1[2-9]\d{9}$/.test(cleaned)) cleaned = `+${cleaned}`;
  else if (!cleaned.startsWith('+')) cleaned = `+${cleaned}`;

  if (!/^\+[1-9]\d{7,14}$/.test(cleaned)) {
    throw new functions.https.HttpsError('invalid-argument', 'Please enter a valid E.164 phone number.');
  }
  return cleaned;
};

const sanitizeUserForClient = (rawUser) => {
  if (!rawUser) return rawUser;
  const user = serializeForClient(rawUser);
  delete user.usernameLower;
  user.tokenHash = '';
  return user;
};

const writeAuditLog = async (actor, action, details, metadata = {}, targetId) => {
  const entry = {
    id: crypto.randomUUID(),
    timestamp: nowIso(),
    actorId: actor?.username || actor?.actorId || 'SYSTEM',
    actorRole: actor?.role || actor?.actorRole || 'SYSTEM',
    targetId,
    action,
    details,
    metadata: serializeForClient(metadata),
  };
  await auditLogsCollection.doc(entry.id).set(entry);
};

const getBootstrapState = async () => {
  const [configSnap, recoverySnap] = await Promise.all([configRef.get(), recoveryRef.get()]);
  const config = configSnap.exists ? configSnap.data() : {};
  const recovery = recoverySnap.exists ? recoverySnap.data() : null;
  const bootstrapCompleted = Boolean(config.bootstrapCompleted || config.masterReady || config.masterAdminUserId);
  return {
    bootstrapCompleted,
    masterReady: bootstrapCompleted,
    masterAdminUserId: config.masterAdminUserId || null,
    masterAdminUsername: config.masterAdminUsername || null,
    recoveryArmed: Boolean(recovery && (!recovery.expiresAt || new Date(toIso(recovery.expiresAt)).getTime() > Date.now())),
    recoveryExpiresAt: recovery ? toIso(recovery.expiresAt) : null,
    initializedAt: config.bootstrapCompletedAt ? toIso(config.bootstrapCompletedAt) : null,
    bootstrapCompletedAt: config.bootstrapCompletedAt ? toIso(config.bootstrapCompletedAt) : null,
  };
};

const getUserByUsername = async (username) => {
  const lower = String(username || '').trim().toLowerCase();
  if (!lower) return null;

  let snap = await usersCollection.where('usernameLower', '==', lower).limit(1).get();
  if (snap.empty) {
    snap = await usersCollection.where('username', '==', username).limit(1).get();
  }
  if (snap.empty) return null;
  return { ref: snap.docs[0].ref, data: snap.docs[0].data() };
};

const ensureUniqueIdentity = async ({ username, phone, email, ignoreUserId }) => {
  const usernameLower = String(username).trim().toLowerCase();
  const usernameSnap = await usersCollection.where('usernameLower', '==', usernameLower).limit(1).get();
  if (!usernameSnap.empty && usernameSnap.docs[0].id !== ignoreUserId) {
    throw new functions.https.HttpsError('already-exists', 'Username taken');
  }
  if (phone) {
    const phoneSnap = await usersCollection.where('phone', '==', phone).limit(1).get();
    if (!phoneSnap.empty && phoneSnap.docs[0].id !== ignoreUserId) {
      throw new functions.https.HttpsError('already-exists', 'Phone number already assigned to another user.');
    }
  }
  if (email) {
    const emailSnap = await usersCollection.where('email', '==', email).limit(1).get();
    if (!emailSnap.empty && emailSnap.docs[0].id !== ignoreUserId) {
      throw new functions.https.HttpsError('already-exists', 'Email address already assigned to another user.');
    }
  }
};

const getChannelState = (status = 'PENDING', error, providerId, sentAt) => ({
  status,
  error,
  providerId,
  lastAttemptAt: nowIso(),
  sentAt,
});

const executeWithRetry = async (operation, context, correlationId, maxRetries = 3) => {
  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await operation();
    } catch (error) {
      attempt += 1;
      log('WARNING', 'NETWORK', `${context} failed (Attempt ${attempt}/${maxRetries})`, correlationId, { error });
      if (attempt >= maxRetries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000 * Math.pow(2, attempt - 1)));
    }
  }
  throw new Error(`${context} failed`);
};

const sendEmail = async (to, subject, text, correlationId) => {
  if (!SENDGRID_API_KEY) {
    log('ERROR', 'CONFIG', 'SendGrid API Key missing. Email delivery blocked.', correlationId, { recipientCount: Array.isArray(to) ? to.length : 1 });
    throw new functions.https.HttpsError('failed-precondition', 'Email delivery is not configured.');
  }
  const msg = { to, from: 'noreply@cruzpham.com', subject, text };
  await executeWithRetry(() => sgMail.send(msg), 'SendGrid Email', correlationId);
  return { status: 'SENT', provider: 'sendgrid', timestamp: nowIso() };
};

const sendSms = async (to, body, correlationId) => {
  if (!twilioClient || !TWILIO_FROM_NUMBER) {
    log('ERROR', 'CONFIG', 'Twilio credentials missing. SMS delivery blocked.', correlationId, { hasClient: Boolean(twilioClient) });
    throw new functions.https.HttpsError('failed-precondition', 'SMS delivery is not configured.');
  }
  await executeWithRetry(() => twilioClient.messages.create({ body, from: TWILIO_FROM_NUMBER, to }), 'Twilio SMS', correlationId);
  return { status: 'SENT', provider: 'twilio', timestamp: nowIso() };
};

const dispatchDelivery = async (method, recipient, content, subject, correlationId) => {
  if (!DELIVERY_METHODS.has(method)) {
    throw new functions.https.HttpsError('invalid-argument', 'Invalid delivery method');
  }
  if (!recipient || typeof recipient !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Missing delivery destination');
  }
  if (!content || typeof content !== 'string') {
    throw new functions.https.HttpsError('invalid-argument', 'Missing delivery content');
  }

  if (method === 'EMAIL') return sendEmail(recipient, subject || 'CruzPham Studios', content, correlationId);
  return sendSms(normalizePhone(recipient), content, correlationId);
};

const buildCredentialMessage = (user, rawToken) => {
  const firstName = user.profile?.firstName || user.username;
  return {
    subject: 'Your CruzPham Studios Access Credentials',
    sms: `Hello ${firstName}, your CruzPham Trivia access is ready. Username: ${user.username}. Token: ${rawToken}`,
    email: `Hello ${firstName},\n\nYour CruzPham Trivia access has been created.\nUsername: ${user.username}\nToken: ${rawToken}\n\nKeep this token private and use it to sign in to the studio.`,
  };
};

const ensureCredentialCooldown = (user, method) => {
  const lastState = user.credentialDelivery && user.credentialDelivery[method];
  const lastAttemptAt = lastState && lastState.lastAttemptAt;
  if (!lastAttemptAt) return;
  if (lastState.status === 'SENT' && Date.now() - new Date(lastAttemptAt).getTime() < DELIVERY_COOLDOWN_MS) {
    throw new functions.https.HttpsError('resource-exhausted', `${method} credential delivery is cooling down. Please wait before resending.`);
  }
};

const applyDeliveryToUser = (user, deliveryLog, actorUsername) => {
  user.lastDelivery = deliveryLog;
  user.credentialDelivery = user.credentialDelivery || {};
  if (deliveryLog.purpose === 'CREDENTIALS') {
    user.credentialDelivery[deliveryLog.method] = {
      status: deliveryLog.status,
      sentAt: deliveryLog.status === 'SENT' ? deliveryLog.timestamp : user.credentialDelivery[deliveryLog.method] && user.credentialDelivery[deliveryLog.method].sentAt,
      lastAttemptAt: deliveryLog.timestamp,
      providerId: deliveryLog.providerId,
      error: deliveryLog.error,
    };
    user.credentialDelivery.lastIssuedAt = deliveryLog.timestamp;
    user.credentialDelivery.lastIssuedBy = actorUsername;
  }
  user.updatedAt = deliveryLog.timestamp;
};

const getRequestAggregateDeliveryStatus = (request) => {
  const channels = Object.values(request.delivery || {});
  if (channels.length === 0) return 'SKIPPED';
  if (channels.some((channel) => channel && channel.status === 'SENT')) return 'SENT';
  if (channels.every((channel) => channel && channel.status === 'SKIPPED')) return 'SKIPPED';
  if (channels.some((channel) => channel && channel.status === 'FAILED')) return 'FAILED';
  return 'PENDING';
};

const removeUserSessions = async (userId) => {
  const snap = await sessionsCollection.where('userId', '==', userId).get();
  if (snap.empty) return;
  const batch = db.batch();
  snap.docs.forEach((docSnap) => batch.delete(docSnap.ref));
  await batch.commit();
};

const requireSession = async (sessionId, requiredRole = null) => {
  if (!sessionId) {
    throw new functions.https.HttpsError('unauthenticated', 'Session required');
  }

  const sessionRef = sessionsCollection.doc(sessionId);
  const sessionSnap = await sessionRef.get();
  if (!sessionSnap.exists) {
    throw new functions.https.HttpsError('unauthenticated', 'Session expired');
  }

  const session = sessionSnap.data();
  const userRef = session.userId ? usersCollection.doc(session.userId) : null;
  const userSnap = userRef ? await userRef.get() : null;

  if (!userSnap || !userSnap.exists) {
    await sessionRef.delete().catch(() => undefined);
    throw new functions.https.HttpsError('unauthenticated', 'User invalid');
  }

  const user = userSnap.data();
  if (user.status === 'REVOKED') {
    await sessionRef.delete().catch(() => undefined);
    throw new functions.https.HttpsError('permission-denied', 'Access revoked');
  }
  if (user.expiresAt && Date.now() > new Date(toIso(user.expiresAt)).getTime()) {
    await sessionRef.delete().catch(() => undefined);
    throw new functions.https.HttpsError('unauthenticated', 'Session expired');
  }
  if (session.role !== user.role) {
    await sessionRef.set({ role: user.role, updatedAt: Date.now() }, { merge: true });
    session.role = user.role;
  }
  if (requiredRole && user.role !== requiredRole) {
    await writeAuditLog({ username: user.username, role: user.role }, 'ADMIN_ACCESS_DENIED', `Denied ${requiredRole} action`, { requiredRole }, user.id);
    throw new functions.https.HttpsError('permission-denied', `${requiredRole} privileges required.`);
  }

  return { sessionRef, session: serializeForClient(session), userRef: userSnap.ref, user };
};

const getAdminSnapshot = async () => {
  const [usersSnap, requestsSnap, auditSnap] = await Promise.all([
    usersCollection.orderBy('createdAt', 'desc').get(),
    requestsCollection.orderBy('createdAt', 'desc').get(),
    auditLogsCollection.orderBy('timestamp', 'desc').limit(250).get(),
  ]);

  return {
    users: usersSnap.docs.map((docSnap) => sanitizeUserForClient({ id: docSnap.id, ...docSnap.data() })),
    requests: requestsSnap.docs.map((docSnap) => serializeForClient({ id: docSnap.id, ...docSnap.data() })),
    auditLogs: auditSnap.docs.map((docSnap) => serializeForClient({ id: docSnap.id, ...docSnap.data() })),
  };
};

const createUserRecord = async ({ actor, username, role, status, email, phone, profile, durationMinutes }) => {
  const sanitizedUsername = sanitizeUsername(username, 'Username');
  const sanitizedRole = role === 'ADMIN' ? 'ADMIN' : 'PRODUCER';
  const sanitizedStatus = status === 'REVOKED' ? 'REVOKED' : 'ACTIVE';
  const normalizedPhone = phone ? normalizePhone(phone) : undefined;
  const normalizedEmail = sanitizeOptionalEmail(email);
  const firstName = sanitizeOptionalName(profile && profile.firstName, 'First name');
  const lastName = sanitizeOptionalName(profile && profile.lastName, 'Last name');
  const tiktokHandle = sanitizeTikTokHandle(profile && profile.tiktokHandle);
  const notes = sanitizeOptionalNotes(profile && profile.notes);

  if (durationMinutes !== undefined && (!Number.isFinite(durationMinutes) || durationMinutes <= 0)) {
    throw new functions.https.HttpsError('invalid-argument', 'Duration must be a positive number of minutes.');
  }

  await ensureUniqueIdentity({ username: sanitizedUsername, phone: normalizedPhone, email: normalizedEmail });

  const rawToken = generateSecret(sanitizedRole === 'ADMIN' ? 'ak' : 'pk', 16);
  const tokenHash = hashToken(rawToken);
  const userId = crypto.randomUUID();
  const createdAt = nowIso();
  const expiresAt = durationMinutes ? new Date(Date.now() + durationMinutes * 60000).toISOString() : null;

  const user = {
    id: userId,
    username: sanitizedUsername,
    usernameLower: sanitizedUsername.toLowerCase(),
    tokenHash,
    role: sanitizedRole,
    status: sanitizedStatus,
    email: normalizedEmail,
    phone: normalizedPhone,
    profile: {
      firstName,
      lastName,
      tiktokHandle,
      notes,
      source: profile && profile.source ? profile.source : 'MANUAL_CREATE',
      originalRequestId: profile && profile.originalRequestId,
      preferredUsername: profile && profile.preferredUsername,
    },
    createdAt,
    updatedAt: createdAt,
    expiresAt,
    createdBy: actor.username,
    credentialDelivery: {},
  };

  await usersCollection.doc(userId).set(user);
  await writeAuditLog(actor, sanitizedRole === 'ADMIN' ? 'ADMIN_CREATED' : 'USER_CREATED', `Username ${sanitizedUsername} was created.`, { role: sanitizedRole, expiresAt, status: sanitizedStatus }, userId);
  await writeAuditLog(actor, 'TOKEN_ISSUED', `A secure access token was generated for ${sanitizedUsername}.`, { role: sanitizedRole }, userId);

  return { rawToken, user };
};

const sendCredentialsToUser = async ({ actor, targetUsername, rawToken, channels, correlationId }) => {
  const lookup = await getUserByUsername(targetUsername);
  if (!lookup) {
    throw new functions.https.HttpsError('not-found', 'User not found');
  }

  const user = lookup.data;
  const selectedChannels = (channels && channels.length ? channels : ['SMS', 'EMAIL']).filter((channel, index, array) => DELIVERY_METHODS.has(channel) && array.indexOf(channel) === index);
  const credentialMessage = buildCredentialMessage(user, rawToken);
  const delivery = {};

  for (const method of selectedChannels) {
    const recipient = method === 'EMAIL' ? user.email : user.phone;
    if (!recipient) {
      delivery[method] = getChannelState('SKIPPED', `User has no ${method === 'EMAIL' ? 'email' : 'phone'} on file.`);
      continue;
    }

    ensureCredentialCooldown(user, method);
    try {
      const result = await dispatchDelivery(method, recipient, method === 'EMAIL' ? credentialMessage.email : credentialMessage.sms, credentialMessage.subject, correlationId);
      const deliveryLog = {
        id: crypto.randomUUID(),
        method,
        status: 'SENT',
        timestamp: nowIso(),
        providerId: result.provider,
        purpose: 'CREDENTIALS',
        recipient,
      };
      applyDeliveryToUser(user, deliveryLog, actor.username);
      delivery[method] = user.credentialDelivery[method];
      await writeAuditLog(actor, method === 'EMAIL' ? 'MESSAGE_SENT_EMAIL' : 'MESSAGE_SENT_SMS', `Access token was sent to ${user.profile.firstName || user.username} by ${method}.`, { status: 'SENT' }, user.id);
    } catch (error) {
      const deliveryLog = {
        id: crypto.randomUUID(),
        method,
        status: 'FAILED',
        timestamp: nowIso(),
        error: error.message,
        purpose: 'CREDENTIALS',
        recipient,
      };
      applyDeliveryToUser(user, deliveryLog, actor.username);
      delivery[method] = user.credentialDelivery[method];
      await writeAuditLog(actor, 'DELIVERY_FAILED', `${method} delivery failed for ${user.profile.firstName || user.username} — retry available.`, { method, error: error.message }, user.id);
    }
  }

  await lookup.ref.set(user, { merge: true });
  return { user: sanitizeUserForClient(user), delivery: serializeForClient(delivery) };
};

const handleNewRequestNotification = async (requestData, correlationId) => {
  const updates = {};

  if (ADMIN_EMAILS.length > 0) {
    try {
      await sendEmail(
        ADMIN_EMAILS,
        `[CRUZPHAM] New Token Request: ${requestData.preferredUsername}`,
        `New Request from ${requestData.firstName} ${requestData.lastName} (@${requestData.tiktokHandle}).\nPhone: ${requestData.phoneE164}${requestData.email ? `\nEmail: ${requestData.email}` : ''}\nID: ${requestData.id}\n\nPlease check Admin Console.`,
        correlationId,
      );
      updates.adminNotifyStatus = 'SENT';
      updates.adminNotifyError = admin.firestore.FieldValue.delete();
    } catch (error) {
      updates.adminNotifyStatus = 'FAILED';
      updates.adminNotifyError = error.message;
      log('ERROR', 'NETWORK', 'Email Notification Failed', correlationId, { error });
    }
  } else {
    updates.adminNotifyStatus = 'SKIPPED';
  }

  if (Object.keys(updates).length > 0) {
    updates.updatedAt = admin.firestore.FieldValue.serverTimestamp();
    await requestsCollection.doc(requestData.id).set(updates, { merge: true });
  }
};

const getSystemStatusHandler = createGetSystemStatusHandler({
  getBootstrapState,
  log,
  getCorrelationIdFromHttpRequest,
  corsPolicy: systemStatusCorsPolicy,
});

exports.getSystemStatus = functions.region(DEFAULT_FUNCTIONS_REGION).https.onRequest(getSystemStatusHandler);

exports.bootstrapSystem = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  const username = sanitizeUsername((data && data.username) || 'admin', 'Master Admin username');
  log('INFO', 'BOOTSTRAP', 'Bootstrap requested', correlationId, { username });

  return db.runTransaction(async (transaction) => {
    const snap = await transaction.get(configRef);
    const config = snap.exists ? snap.data() : {};
    if (config.bootstrapCompleted || config.masterReady || config.masterAdminUserId) {
      log('WARNING', 'BOOTSTRAP', 'Duplicate bootstrap attempt blocked', correlationId, { username });
      throw new functions.https.HttpsError('already-exists', 'System already bootstrapped');
    }

    const existingMaster = await usersCollection.where('role', '==', 'MASTER_ADMIN').limit(1).get();
    if (!existingMaster.empty) {
      log('WARNING', 'BOOTSTRAP', 'Bootstrap blocked because a master user already exists', correlationId, { username });
      throw new functions.https.HttpsError('already-exists', 'System already bootstrapped');
    }

    const rawToken = generateSecret('mk', 32);
    const userId = crypto.randomUUID();
    const createdAt = nowIso();
    const user = {
      id: userId,
      username,
      usernameLower: username.toLowerCase(),
      tokenHash: hashToken(rawToken),
      role: 'MASTER_ADMIN',
      status: 'ACTIVE',
      profile: {
        source: 'MANUAL_CREATE',
        firstName: 'System',
        lastName: 'Admin',
      },
      createdAt,
      updatedAt: createdAt,
      createdBy: 'SYSTEM',
      credentialDelivery: {},
    };

    transaction.set(usersCollection.doc(userId), user);
    transaction.set(configRef, {
      masterReady: true,
      bootstrapCompleted: true,
      bootstrapCompletedAt: admin.firestore.FieldValue.serverTimestamp(),
      bootstrapCompletedBy: 'SYSTEM',
      masterAdminUserId: userId,
      masterAdminUsername: username,
    }, { merge: true });
    transaction.delete(recoveryRef);

    return { token: rawToken };
  }).then(async (result) => {
    await writeAuditLog({ username: 'SYSTEM', role: 'SYSTEM' }, 'BOOTSTRAP', 'Master Admin created', { username }, username);
    log('INFO', 'BOOTSTRAP', 'Bootstrap complete', correlationId, { username });
    return result;
  });
});

exports.loginWithToken = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  const username = sanitizeUsername((data && data.username) || '', 'Username');
  const token = (data && data.token) || '';
  const userAgent = String((data && data.userAgent) || 'unknown');

  const lookup = await getUserByUsername(username);
  if (!lookup) {
    log('WARNING', 'AUTH', 'Login failed: username not found', correlationId, { username });
    return { success: false, message: 'Invalid credentials.', code: 'ERR_INVALID_CREDENTIALS' };
  }

  const user = lookup.data;
  if (user.status === 'REVOKED') {
    return { success: false, message: 'Account access revoked.', code: 'ERR_FORBIDDEN' };
  }
  if (user.expiresAt && Date.now() > new Date(toIso(user.expiresAt)).getTime()) {
    return { success: false, message: 'Access token expired.', code: 'ERR_SESSION_EXPIRED' };
  }
  if (hashToken(token) !== user.tokenHash) {
    log('WARNING', 'AUTH', 'Login failed: invalid token', correlationId, { username });
    return { success: false, message: 'Invalid credentials.', code: 'ERR_INVALID_CREDENTIALS' };
  }

  await removeUserSessions(user.id);
  const sessionId = crypto.randomUUID();
  const session = {
    id: sessionId,
    userId: user.id,
    username: user.username,
    role: user.role,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    userAgent,
  };
  await sessionsCollection.doc(sessionId).set(session);
  await writeAuditLog({ username: user.username, role: user.role }, 'LOGIN', 'User logged in', { userAgent }, user.id);
  log('INFO', 'AUTH', 'Session initialized from backend-authenticated login', correlationId, { username: user.username, role: user.role });
  return { success: true, session: { id: session.id, username: session.username, role: session.role, createdAt: session.createdAt, userAgent: session.userAgent } };
});

exports.restoreStudioSession = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  try {
    const { session } = await requireSession(data && data.sessionId);
    log('INFO', 'AUTH', 'Session restored from authoritative backend state', correlationId, { username: session.username, role: session.role });
    return { success: true, session: { id: session.id, username: session.username, role: session.role, createdAt: session.createdAt, userAgent: session.userAgent } };
  } catch (error) {
    if (error instanceof functions.https.HttpsError) {
      const code = error.code === 'permission-denied' ? 'ERR_FORBIDDEN' : 'ERR_SESSION_EXPIRED';
      return { success: false, message: error.message, code };
    }
    throw error;
  }
});

exports.logoutStudioSession = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  const sessionId = data && data.sessionId;
  if (!sessionId) return { success: true };
  await sessionsCollection.doc(sessionId).delete().catch(() => undefined);
  log('INFO', 'AUTH', 'Session logout completed', correlationId, { sessionId });
  return { success: true };
});

exports.getAdminConsoleSnapshot = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  const { user } = await requireSession(data && data.sessionId, 'MASTER_ADMIN');
  const snapshot = await getAdminSnapshot();
  log('INFO', 'AUTH', 'Admin snapshot loaded from backend', correlationId, { actor: user.username, users: snapshot.users.length, requests: snapshot.requests.length });
  return snapshot;
});

exports.beginStudioRequestReview = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  const reqId = String((data && data.reqId) || '').trim();
  const { user } = await requireSession(data && data.sessionId, 'MASTER_ADMIN');
  const result = await db.runTransaction(async (transaction) => {
    const requestRef = requestsCollection.doc(reqId);
    const snap = await transaction.get(requestRef);
    if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Request not found');
    const request = snap.data();
    if (request.status !== 'PENDING') throw new functions.https.HttpsError('failed-precondition', 'Request is not pending');

    const now = Date.now();
    const lockExpiresAt = request.reviewLockExpiresAt ? new Date(toIso(request.reviewLockExpiresAt)).getTime() : 0;
    if (request.reviewLockedBy && request.reviewLockedBy !== user.username && lockExpiresAt > now) {
      throw new functions.https.HttpsError('failed-precondition', `This request is currently being reviewed by ${request.reviewLockedBy}.`);
    }

    const updated = {
      reviewLockedBy: user.username,
      reviewLockExpiresAt: new Date(now + REQUEST_REVIEW_LOCK_MS).toISOString(),
      reviewedBy: user.username,
      reviewedAt: nowIso(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    transaction.set(requestRef, updated, { merge: true });
    return { ...request, ...serializeForClient(updated), id: requestRef.id };
  });

  await writeAuditLog({ username: user.username, role: user.role }, 'REQUEST_REVIEW_STARTED', `Master Admin opened request ${reqId} for review.`, { requestId: reqId }, reqId);
  log('INFO', 'REQUESTS', 'Request review lock granted', correlationId, { actor: user.username, reqId });
  return serializeForClient(result);
});

exports.createStudioUser = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  const { user: actor } = await requireSession(data && data.sessionId, 'MASTER_ADMIN');
  const userData = data && data.userData ? data.userData : {};
  const role = data && data.role;
  const durationMinutes = data && data.durationMinutes;
  const result = await createUserRecord({
    actor,
    username: userData.username,
    role,
    status: userData.status,
    email: userData.email,
    phone: userData.phone,
    profile: userData.profile || {},
    durationMinutes,
  });
  log('INFO', 'USER_PROVISIONING', 'User creation requested via backend service', correlationId, { actor: actor.username, username: result.user.username, role: result.user.role });
  return { rawToken: result.rawToken, user: sanitizeUserForClient(result.user) };
});

exports.refreshStudioUserToken = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  const { user: actor } = await requireSession(data && data.sessionId, 'MASTER_ADMIN');
  const targetUsername = sanitizeUsername((data && data.targetUsername) || '', 'Target username');
  const lookup = await getUserByUsername(targetUsername);
  if (!lookup) throw new functions.https.HttpsError('not-found', 'User not found');

  const target = lookup.data;
  const rawToken = generateSecret(target.role === 'ADMIN' ? 'ak' : target.role === 'MASTER_ADMIN' ? 'mk' : 'pk', 16);
  target.tokenHash = hashToken(rawToken);
  target.updatedAt = nowIso();

  await lookup.ref.set(target, { merge: true });
  await removeUserSessions(target.id);
  await writeAuditLog(actor, 'TOKEN_REFRESHED', `Rotated token for ${target.username}`, { action: 'ROTATE' }, target.id);
  log('INFO', 'USER_PROVISIONING', 'User token rotated via backend service', correlationId, { actor: actor.username, username: target.username });
  return { rawToken, user: sanitizeUserForClient(target) };
});

exports.sendStudioUserCredentials = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  const { user: actor } = await requireSession(data && data.sessionId, 'MASTER_ADMIN');
  const targetUsername = sanitizeUsername((data && data.targetUsername) || '', 'Target username');
  const rawToken = String((data && data.rawToken) || '').trim();
  const channels = Array.isArray(data && data.channels) ? data.channels : undefined;

  if (!rawToken) {
    throw new functions.https.HttpsError('invalid-argument', 'Missing access token.');
  }

  const result = await sendCredentialsToUser({ actor, targetUsername, rawToken, channels, correlationId });
  log('INFO', 'USER_PROVISIONING', 'Credential delivery completed via backend service', correlationId, { actor: actor.username, username: targetUsername, channels: channels || ['SMS', 'EMAIL'] });
  return { user: sanitizeUserForClient(result.user), delivery: serializeForClient(result.delivery) };
});

exports.resendStudioUserCredentials = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  const { user: actor } = await requireSession(data && data.sessionId, 'MASTER_ADMIN');
  const targetUsername = sanitizeUsername((data && data.targetUsername) || '', 'Target username');
  const channels = Array.isArray(data && data.channels) ? data.channels : undefined;

  const lookup = await getUserByUsername(targetUsername);
  if (!lookup) throw new functions.https.HttpsError('not-found', 'User not found');

  const target = lookup.data;
  const rawToken = generateSecret(target.role === 'ADMIN' ? 'ak' : target.role === 'MASTER_ADMIN' ? 'mk' : 'pk', 16);
  target.tokenHash = hashToken(rawToken);
  target.updatedAt = nowIso();
  await lookup.ref.set(target, { merge: true });
  await removeUserSessions(target.id);

  const result = await sendCredentialsToUser({ actor, targetUsername, rawToken, channels, correlationId });
  await writeAuditLog(actor, 'CREDENTIALS_RESENT', `Credential resend triggered for ${targetUsername}.`, { channels: channels || ['SMS', 'EMAIL'] }, target.id);
  log('INFO', 'USER_PROVISIONING', 'Credential resend completed via backend service', correlationId, { actor: actor.username, username: targetUsername, channels: channels || ['SMS', 'EMAIL'] });
  return { rawToken, user: sanitizeUserForClient(result.user), delivery: serializeForClient(result.delivery) };
});

exports.toggleStudioUserAccess = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  const { user: actor } = await requireSession(data && data.sessionId, 'MASTER_ADMIN');
  const targetUsername = sanitizeUsername((data && data.targetUsername) || '', 'Target username');
  const revoke = Boolean(data && data.revoke);
  const lookup = await getUserByUsername(targetUsername);
  if (!lookup) throw new functions.https.HttpsError('not-found', 'User not found');

  const target = lookup.data;
  if (target.role === 'MASTER_ADMIN') {
    throw new functions.https.HttpsError('permission-denied', 'Cannot revoke Master Admin');
  }

  target.status = revoke ? 'REVOKED' : 'ACTIVE';
  target.updatedAt = nowIso();
  await lookup.ref.set(target, { merge: true });
  if (revoke) await removeUserSessions(target.id);

  await writeAuditLog(actor, revoke ? 'ACCESS_REVOKED' : 'ACCESS_GRANTED', `${revoke ? 'Revoked' : 'Granted'} access for ${target.username}`, null, target.id);
  log('INFO', 'USER_PROVISIONING', 'User access updated via backend service', correlationId, { actor: actor.username, username: target.username, revoke });
  return { user: sanitizeUserForClient(target) };
});

exports.deleteStudioUser = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  const { user: actor } = await requireSession(data && data.sessionId, 'MASTER_ADMIN');
  const targetUsername = sanitizeUsername((data && data.targetUsername) || '', 'Target username');
  const lookup = await getUserByUsername(targetUsername);
  if (!lookup) return { success: true };

  const target = lookup.data;
  if (target.role === 'MASTER_ADMIN') {
    throw new functions.https.HttpsError('permission-denied', 'Cannot delete Master Admin');
  }

  await lookup.ref.delete();
  await removeUserSessions(target.id);
  await writeAuditLog(actor, 'USER_DELETED', `Deleted user ${target.username}`, { role: target.role }, target.id);
  log('INFO', 'USER_PROVISIONING', 'User deleted via backend service', correlationId, { actor: actor.username, username: target.username });
  return { success: true };
});

exports.sendStudioMessage = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  const { user: actor } = await requireSession(data && data.sessionId, 'MASTER_ADMIN');
  const targetUsername = sanitizeUsername((data && data.targetUsername) || '', 'Target username');
  const method = String((data && data.method) || '').toUpperCase();
  const content = String((data && data.content) || '').trim();
  const lookup = await getUserByUsername(targetUsername);
  if (!lookup) throw new functions.https.HttpsError('not-found', 'User not found');
  if (!DELIVERY_METHODS.has(method)) throw new functions.https.HttpsError('invalid-argument', 'Invalid delivery method');
  if (!content) throw new functions.https.HttpsError('invalid-argument', 'Message content is required.');

  const user = lookup.data;
  const recipient = method === 'EMAIL' ? user.email : user.phone;
  if (!recipient) {
    throw new functions.https.HttpsError('invalid-argument', `User has no ${method === 'EMAIL' ? 'email' : 'phone'} on file`);
  }

  const result = await dispatchDelivery(method, recipient, content, 'CruzPham Studios', correlationId);
  const deliveryLog = {
    id: crypto.randomUUID(),
    method,
    status: result.status === 'SENT' ? 'SENT' : 'FAILED',
    timestamp: nowIso(),
    providerId: result.provider,
    purpose: 'GENERIC_MESSAGE',
    recipient,
  };
  applyDeliveryToUser(user, deliveryLog, actor.username);
  await lookup.ref.set(user, { merge: true });

  await writeAuditLog(actor, method === 'EMAIL' ? 'MESSAGE_SENT_EMAIL' : 'MESSAGE_SENT_SMS', `Sent ${method} to ${targetUsername}`, { status: deliveryLog.status }, user.id);
  return { user: sanitizeUserForClient(user), deliveryLog: serializeForClient(deliveryLog) };
});

exports.submitStudioTokenRequest = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  const firstName = sanitizeOptionalName(data && data.firstName, 'First name');
  const lastName = sanitizeOptionalName(data && data.lastName, 'Last name');
  const tiktokHandle = sanitizeTikTokHandle(data && data.tiktokHandle);
  const preferredUsername = sanitizeUsername(String((data && data.preferredUsername) || '').trim(), 'Preferred username');
  const phoneE164 = normalizePhone(data && data.phoneE164);
  const email = sanitizeOptionalEmail(data && data.email);

  if (!firstName || !lastName || !tiktokHandle) {
    throw new functions.https.HttpsError('invalid-argument', 'Please complete all required request fields.');
  }

  const dedupAfter = new Date(Date.now() - REQUEST_DEDUP_WINDOW_MS).toISOString();
  const existingByPhone = await requestsCollection
    .where('status', '==', 'PENDING')
    .where('phoneE164', '==', phoneE164)
    .where('createdAt', '>=', dedupAfter)
    .limit(1)
    .get();
  const existingByUsername = await requestsCollection
    .where('status', '==', 'PENDING')
    .where('preferredUsername', '==', preferredUsername)
    .where('createdAt', '>=', dedupAfter)
    .limit(1)
    .get();
  if (!existingByPhone.empty || !existingByUsername.empty) {
    throw new functions.https.HttpsError('already-exists', 'A pending access request already exists for this phone number or username.');
  }

  const createdAt = nowIso();
  const request = {
    id: crypto.randomUUID().split('-')[0].toUpperCase(),
    firstName,
    lastName,
    tiktokHandle,
    preferredUsername,
    phoneE164,
    email,
    status: 'PENDING',
    createdAt,
    updatedAt: createdAt,
    adminNotifyStatus: 'PENDING',
    userNotifyStatus: 'PENDING',
    delivery: {},
  };

  await requestsCollection.doc(request.id).set(request);
  await writeAuditLog({ username: 'SYSTEM', role: 'SYSTEM' }, 'REQUEST_SUBMITTED', `${firstName} ${lastName.charAt(0)}. requested producer access.`, { preferredUsername, phoneE164 }, request.id);
  void handleNewRequestNotification(request, correlationId).catch((error) => {
    log('ERROR', 'REQUESTS', 'Background admin notification failed', correlationId, { error });
  });
  return serializeForClient(request);
});

exports.retryStudioAdminNotification = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  await requireSession(data && data.sessionId, 'MASTER_ADMIN');
  const reqId = String((data && data.reqId) || '').trim();
  const snap = await requestsCollection.doc(reqId).get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Request not found');
  const request = { id: snap.id, ...snap.data() };
  await handleNewRequestNotification(request, correlationId);
  const updatedSnap = await requestsCollection.doc(reqId).get();
  return { success: true, request: serializeForClient({ id: updatedSnap.id, ...updatedSnap.data() }) };
});

exports.approveStudioRequest = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  const { user: actor } = await requireSession(data && data.sessionId, 'MASTER_ADMIN');
  const reqId = String((data && data.reqId) || '').trim();
  const options = data && data.options ? data.options : {};

  const requestRef = requestsCollection.doc(reqId);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) throw new functions.https.HttpsError('not-found', 'Request not found');
  const request = { id: requestSnap.id, ...requestSnap.data() };
  if (request.status !== 'PENDING') throw new functions.https.HttpsError('failed-precondition', 'Request is not pending');

  const requestedUsername = String(options.username || request.preferredUsername || '').trim();
  const strictUsername = Boolean(String(options.username || '').trim());
  let assignedUsername = sanitizeUsername(requestedUsername, 'Assigned username');
  const existingUser = await getUserByUsername(assignedUsername);
  if (existingUser) {
    if (strictUsername) {
      throw new functions.https.HttpsError('already-exists', 'Assigned username is already taken.');
    }
    assignedUsername = `${assignedUsername.slice(0, 28)}${Math.floor(Math.random() * 9000 + 1000)}`.slice(0, 32);
  }

  const created = await createUserRecord({
    actor,
    username: assignedUsername,
    role: options.role || 'PRODUCER',
    status: 'ACTIVE',
    email: options.email || request.email,
    phone: request.phoneE164,
    profile: {
      firstName: request.firstName,
      lastName: request.lastName,
      tiktokHandle: request.tiktokHandle,
      source: 'REQUEST_APPROVAL',
      originalRequestId: request.id,
      preferredUsername: request.preferredUsername,
      notes: options.notes,
    },
  });

  const requestedChannels = [];
  if (options.sendSms !== false) requestedChannels.push('SMS');
  if (options.sendEmail !== false) requestedChannels.push('EMAIL');
  const deliveryResult = await sendCredentialsToUser({ actor, targetUsername: created.user.username, rawToken: created.rawToken, channels: requestedChannels, correlationId });

  const updatedRequest = {
    status: 'APPROVED',
    updatedAt: nowIso(),
    approvedAt: nowIso(),
    reviewedAt: nowIso(),
    reviewedBy: actor.username,
    userId: created.user.id,
    linkedUserId: created.user.id,
    reviewLockedBy: admin.firestore.FieldValue.delete(),
    reviewLockExpiresAt: admin.firestore.FieldValue.delete(),
    delivery: serializeForClient(deliveryResult.delivery),
    userNotifyStatus: getRequestAggregateDeliveryStatus({ delivery: deliveryResult.delivery }),
    userNotifyError: admin.firestore.FieldValue.delete(),
  };
  await requestRef.set(updatedRequest, { merge: true });
  const approvedSnap = await requestRef.get();
  const approvedRequest = serializeForClient({ id: approvedSnap.id, ...approvedSnap.data() });

  await writeAuditLog(actor, 'REQUEST_APPROVED', `Master Admin approved ${request.firstName} ${request.lastName}'s access request. Username ${created.user.username} was created.`, { requestId: reqId, deliveryStatus: approvedRequest.userNotifyStatus }, created.user.id);
  log('INFO', 'REQUESTS', 'Request approved via backend service', correlationId, { actor: actor.username, reqId, username: created.user.username });
  return { rawToken: created.rawToken, user: sanitizeUserForClient(deliveryResult.user), delivery: serializeForClient(deliveryResult.delivery), request: approvedRequest };
});

exports.rejectStudioRequest = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  const { user: actor } = await requireSession(data && data.sessionId, 'MASTER_ADMIN');
  const reqId = String((data && data.reqId) || '').trim();
  const reason = sanitizeOptionalNotes(data && data.reason);
  const requestRef = requestsCollection.doc(reqId);
  const snap = await requestRef.get();
  if (!snap.exists) throw new functions.https.HttpsError('not-found', 'Request not found');
  const request = snap.data();
  if (request.status !== 'PENDING') throw new functions.https.HttpsError('failed-precondition', 'Request is not pending');

  await requestRef.set({
    status: 'REJECTED',
    updatedAt: nowIso(),
    rejectedAt: nowIso(),
    reviewedAt: nowIso(),
    reviewedBy: actor.username,
    rejectionReason: reason || admin.firestore.FieldValue.delete(),
    reviewLockedBy: admin.firestore.FieldValue.delete(),
    reviewLockExpiresAt: admin.firestore.FieldValue.delete(),
  }, { merge: true });

  const updatedSnap = await requestRef.get();
  const updatedRequest = serializeForClient({ id: updatedSnap.id, ...updatedSnap.data() });
  await writeAuditLog(actor, 'REQUEST_REJECTED', `Master Admin rejected ${request.firstName} ${request.lastName}'s access request.${reason ? ` Reason: ${reason}` : ''}`, { requestId: reqId }, reqId);
  log('INFO', 'REQUESTS', 'Request rejected via backend service', correlationId, { actor: actor.username, reqId });
  return updatedRequest;
});

exports.issueStudioMasterRecovery = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  const { user: actor } = await requireSession(data && data.sessionId, 'MASTER_ADMIN');
  const masterSnap = await usersCollection.where('role', '==', 'MASTER_ADMIN').limit(1).get();
  if (masterSnap.empty) throw new functions.https.HttpsError('failed-precondition', 'Master Admin account unavailable.');

  const master = masterSnap.docs[0].data();
  const issuedAt = nowIso();
  const expiresAt = new Date(Date.now() + MASTER_RECOVERY_TTL_MS).toISOString();
  const recoveryCode = generateSecret('rc', 20);
  await recoveryRef.set({
    masterAdminId: master.id,
    masterAdminUsername: master.username,
    codeHash: hashToken(recoveryCode),
    issuedAt,
    expiresAt,
    issuedBy: actor.username,
  });

  await writeAuditLog(actor, 'MASTER_RECOVERY_ISSUED', 'Issued time-bound master recovery code', { issuedAt, expiresAt }, master.id);
  log('INFO', 'AUTH', 'Master recovery code issued', correlationId, { actor: actor.username, master: master.username });
  return { recoveryCode, issuedAt, expiresAt };
});

exports.completeStudioMasterRecovery = functions.https.onCall(async (data) => {
  const correlationId = data && data.correlationId;
  const username = sanitizeUsername((data && data.username) || '', 'Master Admin username');
  const recoveryCode = String((data && data.recoveryCode) || '').trim();
  const [recoverySnap, masterLookup] = await Promise.all([
    recoveryRef.get(),
    getUserByUsername(username),
  ]);

  if (!recoverySnap.exists || !masterLookup) {
    log('WARNING', 'AUTH', 'Master recovery failed due to missing state', correlationId, { username });
    throw new functions.https.HttpsError('failed-precondition', 'Invalid or expired recovery code.');
  }

  const recovery = recoverySnap.data();
  const master = masterLookup.data;
  if (!recovery.expiresAt || new Date(toIso(recovery.expiresAt)).getTime() <= Date.now()) {
    await recoveryRef.delete().catch(() => undefined);
    throw new functions.https.HttpsError('failed-precondition', 'Invalid or expired recovery code.');
  }
  if (String(recovery.masterAdminUsername || '').toLowerCase() !== username.toLowerCase() || master.role !== 'MASTER_ADMIN') {
    throw new functions.https.HttpsError('failed-precondition', 'Invalid or expired recovery code.');
  }
  if (hashToken(recoveryCode) !== recovery.codeHash) {
    throw new functions.https.HttpsError('failed-precondition', 'Invalid or expired recovery code.');
  }

  const rawToken = generateSecret('mk', 32);
  master.tokenHash = hashToken(rawToken);
  master.updatedAt = nowIso();
  await masterLookup.ref.set(master, { merge: true });
  await removeUserSessions(master.id);
  await recoveryRef.delete();
  await writeAuditLog({ username: 'SYSTEM', role: 'SYSTEM' }, 'MASTER_RECOVERY_COMPLETED', `Master recovery completed for ${master.username}`, { completedAt: master.updatedAt }, master.id);
  log('INFO', 'AUTH', 'Master recovery completed', correlationId, { username: master.username });
  return { username: master.username, rawToken };
});
