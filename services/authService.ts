import { User, Session, TokenRequest, AuthResponse, AuditLogEntry, UserRole, AppError, AuditAction, DeliveryLog, UserSource, UserProfile, DeliveryMethod, ChannelDeliveryState, UserStatus } from '../types';
import { logger } from './logger';
import { buildFunctionsHttpUrl, functions as firebaseFunctions } from './firebase';
import { httpsCallable } from 'firebase/functions';
import {
  areLocalMocksExplicitlyEnabled,
  assertNoMocksInNonDev,
  assertRealAuthInDeployedEnv,
  logRuntimeMode,
} from './runtimeConfig';

const STORAGE_KEYS = {
  USERS: 'cruzpham_db_users',
  SESSIONS: 'cruzpham_db_sessions',
  REQUESTS: 'cruzpham_db_requests',
  AUDIT: 'cruzpham_db_audit_logs',
  BOOTSTRAP: 'cruzpham_sys_bootstrap',
  RECOVERY: 'cruzpham_sys_recovery',  // Stores ONLY the hashed recovery code — never plaintext
};

// Rate Limiting Map: ActorID -> timestamps[]
const userRateLimits = new Map<string, number[]>();
const destinationRateLimits = new Map<string, number[]>();

const USER_RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const USER_RATE_LIMIT_MAX = 10; 

const DEST_RATE_LIMIT_WINDOW = 60 * 1000; // 1 minute
const DEST_RATE_LIMIT_MAX = 3; // Max 3 messages per destination per minute
const MASTER_RECOVERY_TTL_MS = 15 * 60 * 1000;
const REQUEST_DEDUP_WINDOW_MS = 5 * 60 * 1000;
const REQUEST_REVIEW_LOCK_MS = 2 * 60 * 1000;
const DELIVERY_COOLDOWN_MS = 60 * 1000;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,32}$/;
const NAME_PATTERN = /^[A-Za-z][A-Za-z' -]{0,47}$/;
const TIKTOK_PATTERN = /^[A-Za-z0-9._]{1,32}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RecoveryRecord {
  masterAdminId: string;
  masterAdminUsername: string;
  codeHash: string;
  issuedAt: string;
  expiresAt: string;
  issuedBy: string;
}

type BootstrapStatusShape = {
  bootstrapCompleted?: boolean;
  masterReady: boolean;
  masterAdminUserId?: string | null;
  initializedAt?: string | null;
  masterAdminUsername?: string;
  recoveryArmed?: boolean;
  recoveryExpiresAt?: string | null;
};

type MasterRecoveryIssueShape = {
  recoveryCode: string;
  issuedAt: string;
  expiresAt: string;
};

type MasterRecoveryResultShape = {
  username: string;
  rawToken: string;
};

type AdminConsoleSnapshotShape = {
  users: User[];
  requests: TokenRequest[];
  auditLogs: AuditLogEntry[];
};

type SecurityAuditAction = AuditAction
  | 'BOOTSTRAP_BLOCKED'
  | 'ADMIN_ACCESS_DENIED'
  | 'MASTER_RECOVERY_ISSUED'
  | 'MASTER_RECOVERY_COMPLETED'
  | 'MASTER_RECOVERY_FAILED';

// --- TOKEN & PHONE UTILS ---

/**
 * Normalizes token for comparison and hashing.
 * Removes spaces, dashes, newlines to ensure "pk-123-456" works as "pk123456".
 */
export function normalizeTokenInput(token: string): string {
  if (!token) return '';
  return token.trim().replace(/[\s-]/g, '');
}

/**
 * Validates and formats phone number to E.164 strictly.
 * Throws error if invalid.
 */
function validateAndNormalizePhone(phone: string): string {
  // 1. Strip common separators
  let cleaned = phone.replace(/[\s().-]/g, '');

  // 2. Heuristic: If 10 digits (US standard without code), assume +1
  if (/^[2-9]\d{9}$/.test(cleaned)) {
    cleaned = '+1' + cleaned;
  } 
  // 3. Heuristic: If 11 digits starting with 1 (US with code but no +), add +
  else if (/^1[2-9]\d{9}$/.test(cleaned)) {
    cleaned = '+' + cleaned;
  }
  // 4. Ensure it starts with + if user omitted it but included country code
  else if (!cleaned.startsWith('+')) {
    cleaned = '+' + cleaned;
  }

  // 5. Strict E.164 Regex Check
  // Pattern: "+" followed by 1-15 digits. 
  // (In practice, country codes are 1-3 digits, total length rarely exceeds 15).
  // We enforce at least a reasonable length (e.g. +1415...) -> min 8 chars
  const e164Regex = /^\+[1-9]\d{7,14}$/;
  
  if (!e164Regex.test(cleaned)) {
    throw new Error('Invalid E.164 format');
  }

  return cleaned;
}

async function hashToken(token: string): Promise<string> {
  const normalized = normalizeTokenInput(token);
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function generateSecret(prefix: string, lengthBytes = 24): string {
  if (typeof crypto.getRandomValues === 'function') {
    const bytes = new Uint8Array(lengthBytes);
    crypto.getRandomValues(bytes);
    const secret = Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${prefix}-${secret}`;
  }

  const fallback = `${crypto.randomUUID().replace(/-/g, '')}${crypto.randomUUID().replace(/-/g, '')}`;
  return `${prefix}-${fallback.slice(0, Math.max(lengthBytes * 2, 32))}`;
}

function shouldForceProviderFailure(method: DeliveryMethod): boolean {
  try {
    const raw = localStorage.getItem('cruzpham_force_delivery_failure');
    if (!raw) return false;
    const modes = raw.split(',').map((part) => part.trim().toUpperCase());
    return modes.includes(method);
  } catch {
    return false;
  }
}

// --- MOCK DELIVERY PROVIDERS ---

async function simulateEmailProvider(to: string, subject: string, body: string): Promise<{ success: boolean; id?: string; error?: string }> {
  void subject;
  void body;
  logger.info('emailSendAttempt', { to });
  await new Promise(r => setTimeout(r, 600)); // Network latency
  
  // Simulate Secret Manager / API Key check
  // if (!process.env.SENDGRID_API_KEY) ... 
  
  if (shouldForceProviderFailure('EMAIL')) {
    logger.error('emailSendFail', { to, reason: 'Provider Internal Error' });
    return { success: false, error: 'Provider Internal Error (Simulated)' };
  }
  
  logger.info('emailSendSuccess', { to });
  return { success: true, id: `sg_${Math.random().toString(36).substr(2, 12)}` };
}

async function simulateSmsProvider(to: string, message: string): Promise<{ success: boolean; id?: string; error?: string }> {
  void message;
  logger.info('smsSendAttempt', { to }); 
  await new Promise(r => setTimeout(r, 600));
  
  if (shouldForceProviderFailure('SMS')) {
    logger.error('smsSendFail', { to, reason: 'Carrier Blocked' });
    return { success: false, error: 'Carrier Blocked (Simulated)' };
  }
  
  logger.info('smsSendSuccess', { to });
  return { success: true, id: `sm_${Math.random().toString(36).substr(2, 12)}` };
}

// --- BACKEND SERVICE ---

class AuthService {
  // In-memory lock to prevent concurrent bootstrap requests (race-condition guard)
  private _bootstrapInProgress = false;
  private adminConsoleSnapshot: AdminConsoleSnapshotShape = {
    users: [],
    requests: [],
    auditLogs: [],
  };

  constructor() {
    logRuntimeMode('authService');
  }

  // --- PRIVATE HELPERS ---

  private useLocalAuthority(): boolean {
    return areLocalMocksExplicitlyEnabled();
  }

  private useAuthoritativeBackend(): boolean {
    return !this.useLocalAuthority();
  }

  private assertLocalAuthority(pathLabel: string) {
    if (this.useAuthoritativeBackend()) {
      assertNoMocksInNonDev(pathLabel);
    }
  }

  private getActiveSessionId(): string | null {
    try {
      return localStorage.getItem('cruzpham_active_session_id');
    } catch {
      return null;
    }
  }

  private requireActiveSessionId(action: string): string {
    const sessionId = this.getActiveSessionId();
    if (!sessionId) {
      throw new AppError('ERR_SESSION_EXPIRED', `${action} requires an active session.`, logger.getCorrelationId());
    }
    return sessionId;
  }

  private requireBackendFunctions(action: string) {
    assertRealAuthInDeployedEnv(action, Boolean(firebaseFunctions));
    if (!firebaseFunctions) {
      logger.error('[RuntimeGuard] authoritative backend unavailable', { action });
      throw new AppError('ERR_NETWORK', `Authoritative backend unavailable for ${action}.`, logger.getCorrelationId());
    }
    return firebaseFunctions;
  }

  private async callBackend<TResponse>(callableName: string, payload: Record<string, unknown>): Promise<TResponse> {
    const functions = this.requireBackendFunctions(callableName);
    logger.info('[Auth] calling authoritative backend', { callableName, source: 'firebase-functions' });
    const callable = httpsCallable(functions, callableName);
    const result = await callable({
      ...payload,
      correlationId: logger.getCorrelationId(),
    });
    return result.data as TResponse;
  }

  private async fetchBootstrapStatusFromBackend(): Promise<BootstrapStatusShape> {
    const endpoint = buildFunctionsHttpUrl('getSystemStatus');
    if (!endpoint) {
      logger.error('[Bootstrap] system status endpoint unavailable', {
        transport: 'http',
      });
      throw new AppError('ERR_NETWORK', 'Authoritative system status endpoint unavailable.', logger.getCorrelationId());
    }

    const correlationId = logger.getCorrelationId();
    logger.info('system_status_fetch_requested', {
      transport: 'http',
      endpoint,
    });

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Correlation-ID': correlationId,
        },
        body: JSON.stringify({ correlationId }),
      });
    } catch (error: any) {
      logger.error('system_status_fetch_failed', {
        transport: 'http',
        endpoint,
        message: error?.message,
      });
      throw new AppError('ERR_NETWORK', 'Unable to load bootstrap state.', correlationId);
    }

    if (!response.ok) {
      logger.error('system_status_fetch_failed', {
        transport: 'http',
        endpoint,
        status: response.status,
        statusText: response.statusText,
      });
      throw new AppError('ERR_NETWORK', 'Unable to load bootstrap state.', correlationId);
    }

    let payload: any = null;
    try {
      payload = await response.json();
    } catch (error: any) {
      logger.error('system_status_fetch_failed', {
        transport: 'http',
        endpoint,
        message: error?.message || 'Invalid JSON response',
      });
      throw new AppError('ERR_NETWORK', 'Unable to load bootstrap state.', correlationId);
    }

    const normalized = this.normalizeBootstrapStatus(payload?.data || payload?.result || payload);
    logger.info('system_status_fetch_succeeded', {
      transport: 'http',
      endpoint,
      bootstrapCompleted: normalized.bootstrapCompleted,
      masterReady: normalized.masterReady,
      initializedAt: normalized.initializedAt,
    });
    return normalized;
  }

  private normalizeBootstrapStatus(status: Partial<BootstrapStatusShape> | null | undefined): BootstrapStatusShape {
    const bootstrapCompleted = Boolean(status?.bootstrapCompleted ?? status?.masterReady);
    return {
      bootstrapCompleted,
      masterReady: bootstrapCompleted,
      masterAdminUserId: status?.masterAdminUserId ?? null,
      initializedAt: status?.initializedAt ?? null,
      masterAdminUsername: status?.masterAdminUsername,
      recoveryArmed: status?.recoveryArmed,
      recoveryExpiresAt: status?.recoveryExpiresAt ?? null,
    };
  }

  private mapCallableError(error: any, fallbackCode: AppError['code'] = 'ERR_UNKNOWN', fallbackMessage?: string): AppError {
    if (error instanceof AppError) return error;
    const backendCode = error?.code || error?.details?.code;
    const message = error?.message || fallbackMessage || 'Request failed';
    let code: AppError['code'] = fallbackCode;
    if (backendCode === 'functions/invalid-argument' || backendCode === 'invalid-argument') code = 'ERR_VALIDATION';
    else if (backendCode === 'functions/resource-exhausted' || backendCode === 'resource-exhausted') code = 'ERR_RATE_LIMIT';
    else if (backendCode === 'functions/permission-denied' || backendCode === 'permission-denied') code = 'ERR_FORBIDDEN';
    else if (backendCode === 'functions/unauthenticated' || backendCode === 'unauthenticated') code = 'ERR_SESSION_EXPIRED';
    else if (backendCode === 'functions/not-found' || backendCode === 'not-found') code = 'ERR_REQUEST_NOT_FOUND';
    else if (backendCode === 'functions/already-exists' || backendCode === 'already-exists') code = fallbackCode;
    else if (backendCode === 'functions/failed-precondition' || backendCode === 'failed-precondition') code = fallbackCode;
    return new AppError(code, fallbackMessage || message, logger.getCorrelationId());
  }

  private setAdminConsoleSnapshot(snapshot: AdminConsoleSnapshotShape) {
    this.adminConsoleSnapshot = snapshot;
  }

  private upsertSnapshotUser(user: User) {
    this.adminConsoleSnapshot.users = [user, ...this.adminConsoleSnapshot.users.filter((entry) => entry.username !== user.username)];
  }

  private removeSnapshotUser(username: string) {
    this.adminConsoleSnapshot.users = this.adminConsoleSnapshot.users.filter((entry) => entry.username !== username);
  }

  private upsertSnapshotRequest(request: TokenRequest) {
    this.adminConsoleSnapshot.requests = [request, ...this.adminConsoleSnapshot.requests.filter((entry) => entry.id !== request.id)];
  }

  private checkUserRateLimit(actorId: string) {
    const now = Date.now();
    const timestamps = userRateLimits.get(actorId) || [];
    const recent = timestamps.filter(t => now - t < USER_RATE_LIMIT_WINDOW);
    
    if (recent.length >= USER_RATE_LIMIT_MAX) {
      throw new AppError('ERR_RATE_LIMIT', 'Too many requests from user. Please slow down.', logger.getCorrelationId());
    }
    
    recent.push(now);
    userRateLimits.set(actorId, recent);
  }

  private checkDestinationRateLimit(destination: string) {
    const now = Date.now();
    const timestamps = destinationRateLimits.get(destination) || [];
    const recent = timestamps.filter(t => now - t < DEST_RATE_LIMIT_WINDOW);
    
    if (recent.length >= DEST_RATE_LIMIT_MAX) {
      throw new AppError('ERR_RATE_LIMIT', 'Too many messages to this destination. Try again later.', logger.getCorrelationId());
    }
    
    recent.push(now);
    destinationRateLimits.set(destination, recent);
  }

  private getUsers(): User[] {
    this.assertLocalAuthority('authService.local.users.read');
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.USERS) || '[]'); } catch { return []; }
  }
  private saveUsers(users: User[]) {
    this.assertLocalAuthority('authService.local.users.write');
    localStorage.setItem(STORAGE_KEYS.USERS, JSON.stringify(users));
  }
  private getSessions(): Record<string, Session> {
    this.assertLocalAuthority('authService.local.sessions.read');
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.SESSIONS) || '{}'); } catch { return {}; }
  }
  private saveSessions(sessions: Record<string, Session>) {
    this.assertLocalAuthority('authService.local.sessions.write');
    localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessions));
  }
  private readRequests(): TokenRequest[] {
    this.assertLocalAuthority('authService.local.requests.read');
    try { 
      const reqs = JSON.parse(localStorage.getItem(STORAGE_KEYS.REQUESTS) || '[]'); 
      return reqs.sort((a: TokenRequest, b: TokenRequest) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } catch { return []; }
  }
  private saveRequests(reqs: TokenRequest[]) {
    this.assertLocalAuthority('authService.local.requests.write');
    localStorage.setItem(STORAGE_KEYS.REQUESTS, JSON.stringify(reqs));
  }
  private readAuditLogs(): AuditLogEntry[] {
    this.assertLocalAuthority('authService.local.audit.read');
    try { return JSON.parse(localStorage.getItem(STORAGE_KEYS.AUDIT) || '[]'); } catch { return []; }
  }
  private saveAuditLog(logs: AuditLogEntry[]) {
    this.assertLocalAuthority('authService.local.audit.write');
    localStorage.setItem(STORAGE_KEYS.AUDIT, JSON.stringify(logs));
  }

  private getBootstrapDocument(): { masterReady?: boolean; createdAt?: string; masterAdminId?: string; masterAdminUsername?: string } | null {
    this.assertLocalAuthority('authService.local.bootstrap.read');
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.BOOTSTRAP);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private saveBootstrapDocument(doc: { masterReady: boolean; createdAt: string; masterAdminId: string; masterAdminUsername: string }) {
    this.assertLocalAuthority('authService.local.bootstrap.write');
    localStorage.setItem(STORAGE_KEYS.BOOTSTRAP, JSON.stringify(doc));
  }

  private getRecoveryDocument(): RecoveryRecord | null {
    this.assertLocalAuthority('authService.local.recovery.read');
    try {
      const raw = localStorage.getItem(STORAGE_KEYS.RECOVERY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private saveRecoveryDocument(doc: RecoveryRecord | null) {
    this.assertLocalAuthority('authService.local.recovery.write');
    if (!doc) {
      localStorage.removeItem(STORAGE_KEYS.RECOVERY);
      return;
    }
    localStorage.setItem(STORAGE_KEYS.RECOVERY, JSON.stringify(doc));
  }

  private isRecoveryExpired(doc: RecoveryRecord) {
    return Date.now() > new Date(doc.expiresAt).getTime();
  }

  private sanitizeUsername(username: string, label = 'Username'): string {
    const sanitized = username.trim();
    if (!USERNAME_PATTERN.test(sanitized)) {
      throw new AppError('ERR_VALIDATION', `${label} must be 3-32 characters and use letters, numbers, dots, dashes, or underscores.`, logger.getCorrelationId());
    }
    return sanitized;
  }

  private sanitizeOptionalName(value?: string, label = 'Name'): string | undefined {
    if (!value) return undefined;
    const sanitized = value.trim().replace(/\s+/g, ' ');
    if (!sanitized) return undefined;
    if (!NAME_PATTERN.test(sanitized)) {
      throw new AppError('ERR_VALIDATION', `${label} contains unsupported characters.`, logger.getCorrelationId());
    }
    return sanitized;
  }

  private sanitizeTikTokHandle(value?: string): string | undefined {
    if (!value) return undefined;
    const sanitized = value.trim().replace(/^@+/, '');
    if (!sanitized) return undefined;
    if (!TIKTOK_PATTERN.test(sanitized)) {
      throw new AppError('ERR_VALIDATION', 'TikTok handle must use letters, numbers, periods, or underscores.', logger.getCorrelationId());
    }
    return sanitized;
  }

  private sanitizeOptionalEmail(value?: string): string | undefined {
    if (!value) return undefined;
    const email = value.trim().toLowerCase();
    if (!email) return undefined;
    if (!EMAIL_PATTERN.test(email)) {
      throw new AppError('ERR_VALIDATION', 'Please enter a valid email address.', logger.getCorrelationId());
    }
    return email;
  }

  private sanitizeOptionalNotes(value?: string): string | undefined {
    if (!value) return undefined;
    const notes = value.trim();
    return notes ? notes.slice(0, 500) : undefined;
  }

  private sanitizeUserStatus(status?: UserStatus): UserStatus {
    return status === 'REVOKED' ? 'REVOKED' : 'ACTIVE';
  }

  private toUsernameSeed(value: string): string {
    const base = value.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '.').replace(/\.{2,}/g, '.').replace(/^\.+|\.+$/g, '');
    const normalized = base || 'producer';
    return normalized.slice(0, 32).replace(/^(.{0,2})$/, `${normalized}01`);
  }

  private buildAvailableUsername(base: string, users = this.getUsers()): string {
    const seed = this.toUsernameSeed(base);
    const preferred = this.sanitizeUsername(seed.slice(0, 32), 'Username');
    if (!this.getUserByUsername(preferred, users)) return preferred;

    for (let suffix = 1; suffix < 1000; suffix += 1) {
      const candidate = this.sanitizeUsername(`${preferred.slice(0, Math.max(3, 32 - String(suffix).length))}${suffix}`, 'Username');
      if (!this.getUserByUsername(candidate, users)) {
        return candidate;
      }
    }

    throw new AppError('ERR_LIMIT_REACHED', 'Unable to generate a unique username right now.', logger.getCorrelationId());
  }

  private getChannelState(status: ChannelDeliveryState['status'] = 'PENDING', error?: string): ChannelDeliveryState {
    return {
      status,
      lastAttemptAt: new Date().toISOString(),
      error,
    };
  }

  private ensureCredentialSendNotCoolingDown(user: User, method: DeliveryMethod) {
    const lastState = user.credentialDelivery?.[method];
    const lastAttemptAt = lastState?.lastAttemptAt;
    if (!lastAttemptAt) return;
    if (lastState?.status === 'SENT' && Date.now() - new Date(lastAttemptAt).getTime() < DELIVERY_COOLDOWN_MS) {
      throw new AppError('ERR_RATE_LIMIT', `${method} credential delivery is cooling down. Please wait before resending.`, logger.getCorrelationId());
    }
  }

  private buildCredentialMessage(user: User, rawToken: string) {
    const firstName = user.profile.firstName || user.username;
    return {
      subject: 'Your CruzPham Studios Access Credentials',
      sms: `Hello ${firstName}, your CruzPham Trivia access is ready. Username: ${user.username}. Token: ${rawToken}`,
      email: `Hello ${firstName},\n\nYour CruzPham Trivia access has been created.\nUsername: ${user.username}\nToken: ${rawToken}\n\nKeep this token private and use it to sign in to the studio.`
    };
  }

  private async dispatchDelivery(method: DeliveryMethod, recipient: string, content: string, subject?: string): Promise<{ success: boolean; id?: string; error?: string }> {
    if (firebaseFunctions) {
      try {
        const callable = httpsCallable(firebaseFunctions, 'sendProvisioningNotification');
        const result = await callable({
          method,
          to: recipient,
          content,
          subject,
          correlationId: logger.getCorrelationId(),
        });
        const data = result.data as { success?: boolean; providerId?: string; error?: string };
        if (data?.success) {
          return { success: true, id: data.providerId };
        }
        return { success: false, error: data?.error || 'Cloud delivery failed' };
      } catch (error: any) {
        logger.warn('cloudDeliveryFailed', { method, recipient, error: error?.message || String(error) });
        if (this.useAuthoritativeBackend()) {
          logger.error('[RuntimeGuard] backend delivery fallback blocked', { method, recipient });
          throw this.mapCallableError(error, 'ERR_PROVIDER_DOWN', `${method} delivery unavailable.`);
        }
      }
    }

    this.assertLocalAuthority(`authService.local.delivery.${method.toLowerCase()}`);
    if (method === 'EMAIL') {
      return simulateEmailProvider(recipient, subject || 'CruzPham Studios', content);
    }
    return simulateSmsProvider(recipient, content);
  }

  private updateUserDeliveryState(user: User, log: DeliveryLog) {
    user.lastDelivery = log;
    user.credentialDelivery = user.credentialDelivery || {};

    if (log.purpose === 'CREDENTIALS') {
      user.credentialDelivery[log.method] = {
        status: log.status,
        sentAt: log.status === 'SENT' ? log.timestamp : user.credentialDelivery[log.method]?.sentAt,
        lastAttemptAt: log.timestamp,
        providerId: log.providerId,
        error: log.error,
      };
      user.credentialDelivery.lastIssuedAt = log.timestamp;
    }

    user.updatedAt = log.timestamp;
  }

  private getRequestAggregateDeliveryStatus(request: TokenRequest): TokenRequest['userNotifyStatus'] {
    const channels = Object.values(request.delivery || {});
    if (channels.length === 0) return 'SKIPPED';
    if (channels.some((channel) => channel?.status === 'SENT')) return 'SENT';
    if (channels.every((channel) => channel?.status === 'SKIPPED')) return 'SKIPPED';
    if (channels.some((channel) => channel?.status === 'FAILED')) return 'FAILED';
    return 'PENDING';
  }

  private claimRequestReviewLock(actorUsername: string, request: TokenRequest) {
    const now = Date.now();
    const lockExpiresAt = request.reviewLockExpiresAt ? new Date(request.reviewLockExpiresAt).getTime() : 0;
    if (request.reviewLockedBy && request.reviewLockedBy !== actorUsername && lockExpiresAt > now) {
      throw new AppError('ERR_REQUEST_LOCKED', `This request is currently being reviewed by ${request.reviewLockedBy}.`, logger.getCorrelationId());
    }

    request.reviewLockedBy = actorUsername;
    request.reviewLockExpiresAt = new Date(now + REQUEST_REVIEW_LOCK_MS).toISOString();
  }

  public suggestAvailableUsername(preferredUsername: string): string {
    const users = this.useAuthoritativeBackend() ? this.adminConsoleSnapshot.users : this.getUsers();
    return this.buildAvailableUsername(preferredUsername, users);
  }

  private getUserByUsername(username: string, users = this.getUsers()): User | undefined {
    const normalized = username.trim().toLowerCase();
    return users.find((u) => u.username.trim().toLowerCase() === normalized);
  }

  private getMasterAdminUser(users = this.getUsers()): User | undefined {
    return users.find((u) => u.role === 'MASTER_ADMIN');
  }

  private recordSecurityAudit(actor: User | string, action: SecurityAuditAction, details: string, metadata?: any, targetId?: string) {
    this.logAction(actor, action, details, metadata, targetId).catch((error) => {
      logger.warn('security_audit_failed', { action, details, message: error instanceof Error ? error.message : String(error) });
    });
  }

  private requireMasterAdmin(actorUsername: string, action: string, users = this.getUsers()): User {
    const actor = this.getUserByUsername(actorUsername, users);
    if (!actor || actor.status !== 'ACTIVE' || actor.role !== 'MASTER_ADMIN') {
      this.recordSecurityAudit(actorUsername || 'UNKNOWN', 'ADMIN_ACCESS_DENIED', `Denied ${action}`, {
        requestedBy: actorUsername || null,
        requiredRole: 'MASTER_ADMIN',
      });
      throw new AppError('ERR_FORBIDDEN', 'Master Admin privileges required.', logger.getCorrelationId());
    }
    return actor;
  }

  private sanitizeCreatableRole(role: UserRole): Exclude<UserRole, 'MASTER_ADMIN'> {
    if (role === 'MASTER_ADMIN') {
      throw new AppError('ERR_FORBIDDEN', 'Master Admin role can only be created during bootstrap or verified recovery.', logger.getCorrelationId());
    }
    return role === 'ADMIN' ? 'ADMIN' : 'PRODUCER';
  }

  private async logAction(actor: User | string, action: SecurityAuditAction, details: string, metadata?: any, targetId?: string) {
    const logs = this.readAuditLogs();
    const actorId = typeof actor === 'string' ? actor : actor.username;
    const actorRole = typeof actor === 'object' ? actor.role : 'SYSTEM';
    
    const entry: AuditLogEntry = {
      id: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      actorId,
      actorRole,
      targetId,
      action: action as AuditAction,
      details,
      metadata
    };
    logs.unshift(entry);
    this.saveAuditLog(logs);
    logger.info(`[Audit] ${action}: ${details}`, { ...metadata, actorId, targetId });
  }

  // --- BOOTSTRAP SYSTEM ---

  async getBootstrapStatus(): Promise<BootstrapStatusShape> {
    if (this.useAuthoritativeBackend()) {
      try {
        return await this.fetchBootstrapStatusFromBackend();
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw this.mapCallableError(error, 'ERR_NETWORK', 'Unable to load bootstrap state.');
      }
    }

    logger.info('bootstrapStatusCheck');
    await new Promise(r => setTimeout(r, 150));

    const users = this.getUsers();
    const bootstrapDoc = this.getBootstrapDocument();
    const masterUser = this.getMasterAdminUser(users);
    const recoveryDoc = this.getRecoveryDocument();

    if (recoveryDoc && this.isRecoveryExpired(recoveryDoc)) {
      this.saveRecoveryDocument(null);
    }

    const activeRecoveryDoc = this.getRecoveryDocument();

    return this.normalizeBootstrapStatus({
      masterReady: Boolean(bootstrapDoc?.masterReady || masterUser),
      masterAdminUsername: masterUser?.username || bootstrapDoc?.masterAdminUsername,
      recoveryArmed: Boolean(activeRecoveryDoc),
      recoveryExpiresAt: activeRecoveryDoc?.expiresAt || null,
    });
  }

  async bootstrapMasterAdmin(username: string): Promise<string> {
    if (this.useAuthoritativeBackend()) {
      try {
        const sanitizedUsername = this.sanitizeUsername(username, 'Master Admin username');
        const result = await this.callBackend<{ token: string }>('bootstrapSystem', { username: sanitizedUsername });
        logger.info('[Bootstrap] master admin created via backend', { username: sanitizedUsername });
        return result.token;
      } catch (error) {
        throw this.mapCallableError(error, 'ERR_BOOTSTRAP_COMPLETE', 'System already bootstrapped.');
      }
    }

    const sanitizedUsername = this.sanitizeUsername(username, 'Master Admin username');
    logger.info('bootstrapAttempt', { username: sanitizedUsername });

    if (this._bootstrapInProgress) {
      throw new AppError('ERR_RATE_LIMIT', 'Bootstrap already in progress.', logger.getCorrelationId());
    }

    // HARDENING: STRICT BOOTSTRAP CHECK
    // Check local storage directly for existing bootstrap or users to prevent race conditions or bypass
    // The "Master Bootstrap" must only work ONCE.
    const rawBootstrap = localStorage.getItem(STORAGE_KEYS.BOOTSTRAP);
    const rawUsers = localStorage.getItem(STORAGE_KEYS.USERS);
    
    let isAlreadyInitialized = !!rawBootstrap;
    
    if (!isAlreadyInitialized && rawUsers) {
        try {
            const parsedUsers = JSON.parse(rawUsers);
            if (Array.isArray(parsedUsers) && parsedUsers.length > 0) {
                isAlreadyInitialized = true;
            }
        } catch (e) {
            // If users data is corrupted, we assume it's NOT initialized or broken, 
            // but for security we should probably verify if we can recover or fail safe.
            // In a local-first app, existing but corrupt users key implies previous usage.
            // Let's assume initialized to be safe if key exists and has content.
            if (rawUsers.length > 2) isAlreadyInitialized = true;
        }
    }

    if (isAlreadyInitialized) {
        logger.warn('security_audit_bootstrap_blocked', { reason: 'System already initialized' });
        throw new AppError('ERR_BOOTSTRAP_COMPLETE', 'System already bootstrapped. Action blocked.', logger.getCorrelationId());
    }

    this._bootstrapInProgress = true;
    try {
      const currentStatus = await this.getBootstrapStatus();
      const users = this.getUsers();
      const existingMaster = this.getMasterAdminUser(users);
      const existingBootstrapDoc = this.getBootstrapDocument();

      if (currentStatus.masterReady || existingMaster || existingBootstrapDoc || users.length > 0) {
        this.recordSecurityAudit('SYSTEM', 'BOOTSTRAP_BLOCKED', 'Blocked duplicate bootstrap attempt', {
          username: sanitizedUsername,
          existingUsers: users.length,
          existingMaster: existingMaster?.username || null,
        });
        throw new AppError('ERR_BOOTSTRAP_COMPLETE', 'System already bootstrapped', logger.getCorrelationId());
      }

      const rawToken = generateSecret('mk', 32);
      const hash = await hashToken(rawToken);
      const nowIso = new Date().toISOString();

      const master: User = {
        id: crypto.randomUUID(),
        username: sanitizedUsername,
        tokenHash: hash,
        role: 'MASTER_ADMIN',
        status: 'ACTIVE',
        createdAt: nowIso,
        updatedAt: nowIso,
        createdBy: 'SYSTEM',
        profile: {
          source: 'MANUAL_CREATE',
          firstName: 'System',
          lastName: 'Admin'
        }
      };

      this.saveUsers([master]);
      this.saveBootstrapDocument({
        masterReady: true,
        createdAt: nowIso,
        masterAdminId: master.id,
        masterAdminUsername: master.username,
      });
      this.saveRecoveryDocument(null);

      await this.logAction('SYSTEM', 'BOOTSTRAP', 'Master Admin created', { username: master.username }, master.id);
      logger.info('bootstrapSuccess', { username: master.username });

      return rawToken;
    } finally {
      this._bootstrapInProgress = false;
    }
  }

  async issueMasterRecovery(actorUsername: string): Promise<MasterRecoveryIssueShape> {
    if (this.useAuthoritativeBackend()) {
      try {
        return await this.callBackend<MasterRecoveryIssueShape>('issueStudioMasterRecovery', {
          sessionId: this.requireActiveSessionId('Master recovery issuance'),
        });
      } catch (error) {
        throw this.mapCallableError(error, 'ERR_FORBIDDEN', 'Unable to issue recovery code.');
      }
    }

    const users = this.getUsers();
    const actor = this.requireMasterAdmin(actorUsername, 'master recovery issuance', users);
    const master = this.getMasterAdminUser(users);

    if (!master) {
      throw new AppError('ERR_UNKNOWN', 'Master Admin account unavailable.', logger.getCorrelationId());
    }

    const issuedAt = new Date().toISOString();
    const expiresAt = new Date(Date.now() + MASTER_RECOVERY_TTL_MS).toISOString();
    const recoveryCode = generateSecret('rc', 20);
    const codeHash = await hashToken(recoveryCode);

    this.saveRecoveryDocument({
      masterAdminId: master.id,
      masterAdminUsername: master.username,
      codeHash,
      issuedAt,
      expiresAt,
      issuedBy: actor.username,
    });

    await this.logAction(actor, 'MASTER_RECOVERY_ISSUED', 'Issued time-bound master recovery code', { issuedAt, expiresAt }, master.id);
    return { recoveryCode, issuedAt, expiresAt };
  }

  async completeMasterRecovery(username: string, recoveryCode: string): Promise<MasterRecoveryResultShape> {
    if (this.useAuthoritativeBackend()) {
      try {
        const result = await this.callBackend<MasterRecoveryResultShape>('completeStudioMasterRecovery', {
          username: this.sanitizeUsername(username, 'Master Admin username'),
          recoveryCode,
        });
        localStorage.removeItem('cruzpham_active_session_id');
        return result;
      } catch (error) {
        throw this.mapCallableError(error, 'ERR_RECOVERY_INVALID', 'Invalid or expired recovery code.');
      }
    }

    const sanitizedUsername = this.sanitizeUsername(username, 'Master Admin username');
    const users = this.getUsers();
    const master = this.getMasterAdminUser(users);
    const recoveryDoc = this.getRecoveryDocument();

    if (!master || !recoveryDoc) {
      this.recordSecurityAudit('SYSTEM', 'MASTER_RECOVERY_FAILED', `Master recovery failed for ${sanitizedUsername}`, { reason: 'missing_recovery_state' });
      throw new AppError('ERR_RECOVERY_INVALID', 'Invalid or expired recovery code.', logger.getCorrelationId());
    }

    if (this.isRecoveryExpired(recoveryDoc)) {
      this.saveRecoveryDocument(null);
      this.recordSecurityAudit('SYSTEM', 'MASTER_RECOVERY_FAILED', `Master recovery failed for ${sanitizedUsername}`, { reason: 'expired_code' }, master.id);
      throw new AppError('ERR_RECOVERY_INVALID', 'Invalid or expired recovery code.', logger.getCorrelationId());
    }

    if (master.username.trim().toLowerCase() !== sanitizedUsername.toLowerCase() || recoveryDoc.masterAdminUsername.trim().toLowerCase() !== sanitizedUsername.toLowerCase()) {
      this.recordSecurityAudit('SYSTEM', 'MASTER_RECOVERY_FAILED', `Master recovery failed for ${sanitizedUsername}`, { reason: 'username_mismatch' }, master.id);
      throw new AppError('ERR_RECOVERY_INVALID', 'Invalid or expired recovery code.', logger.getCorrelationId());
    }

    const inputHash = await hashToken(recoveryCode);
    if (inputHash !== recoveryDoc.codeHash) {
      this.recordSecurityAudit('SYSTEM', 'MASTER_RECOVERY_FAILED', `Master recovery failed for ${sanitizedUsername}`, { reason: 'invalid_code' }, master.id);
      throw new AppError('ERR_RECOVERY_INVALID', 'Invalid or expired recovery code.', logger.getCorrelationId());
    }

    const rawToken = generateSecret('mk', 32);
    master.tokenHash = await hashToken(rawToken);
    master.updatedAt = new Date().toISOString();
    this.saveUsers(users);

    const sessions = this.getSessions();
    Object.keys(sessions).forEach((key) => {
      if (sessions[key].username === master.username) delete sessions[key];
    });
    this.saveSessions(sessions);
    this.saveRecoveryDocument(null);
    localStorage.removeItem('cruzpham_active_session_id');

    await this.logAction('SYSTEM', 'MASTER_RECOVERY_COMPLETED', `Master recovery completed for ${master.username}`, {
      previousRecoveryIssuedAt: recoveryDoc.issuedAt,
      completedAt: master.updatedAt,
    }, master.id);

    return { username: master.username, rawToken };
  }

  // --- AUTH ---

  async login(username: string, token: string): Promise<AuthResponse> {
    if (this.useAuthoritativeBackend()) {
      try {
        const result = await this.callBackend<AuthResponse>('loginWithToken', {
          username: this.sanitizeUsername(username, 'Username'),
          token,
          userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        });
        if (result.success && result.session) {
          localStorage.setItem('cruzpham_active_session_id', result.session.id);
        }
        return result;
      } catch (error) {
        throw this.mapCallableError(error, 'ERR_INVALID_CREDENTIALS', 'Authentication failed.');
      }
    }

    await new Promise(r => setTimeout(r, 400)); // Latency

    const users = this.getUsers();
    const targetUser = users.find(u => u.username.toLowerCase() === username.trim().toLowerCase());

    if (!targetUser) {
      return { success: false, message: 'Invalid credentials.', code: 'ERR_INVALID_CREDENTIALS' };
    }

    if (targetUser.status === 'REVOKED') {
      return { success: false, message: 'Account access revoked.', code: 'ERR_FORBIDDEN' };
    }

    const inputHash = await hashToken(token);
    if (inputHash !== targetUser.tokenHash) {
      logger.warn(`Failed login attempt for ${username}`);
      return { success: false, message: 'Invalid credentials.', code: 'ERR_INVALID_CREDENTIALS' };
    }

    if (targetUser.expiresAt && Date.now() > new Date(targetUser.expiresAt).getTime()) {
      return { success: false, message: 'Access token expired.', code: 'ERR_SESSION_EXPIRED' };
    }

    const allSessions = this.getSessions();
    Object.keys(allSessions).forEach(key => {
      if (allSessions[key].username === targetUser.username) delete allSessions[key];
    });

    const sessionId = crypto.randomUUID();
    const newSession: Session = {
      id: sessionId,
      username: targetUser.username,
      role: targetUser.role,
      createdAt: Date.now(),
      userAgent: navigator.userAgent
    };

    allSessions[sessionId] = newSession;
    this.saveSessions(allSessions);

    // Keep auth persistence consistent for callers that use the service directly.
    localStorage.setItem('cruzpham_active_session_id', sessionId);

    await this.logAction(targetUser, 'LOGIN', 'User logged in', { userAgent: navigator.userAgent });
    return { success: true, session: newSession };
  }

  async logout(sessionId: string): Promise<void> {
    if (this.useAuthoritativeBackend()) {
      try {
        await this.callBackend<{ success: boolean }>('logoutStudioSession', { sessionId });
      } catch (error) {
        logger.warn('[Auth] logout callable failed; clearing client session anyway', {
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (localStorage.getItem('cruzpham_active_session_id') === sessionId) {
          localStorage.removeItem('cruzpham_active_session_id');
        }
      }
      return;
    }

    const sessions = this.getSessions();
    if (sessions[sessionId]) {
      delete sessions[sessionId];
      this.saveSessions(sessions);
    }

    if (localStorage.getItem('cruzpham_active_session_id') === sessionId) {
      localStorage.removeItem('cruzpham_active_session_id');
    }
  }

  async restoreSession(sessionId: string): Promise<AuthResponse> {
    if (this.useAuthoritativeBackend()) {
      try {
        const result = await this.callBackend<AuthResponse>('restoreStudioSession', { sessionId });
        if (result.success && result.session) {
          localStorage.setItem('cruzpham_active_session_id', result.session.id);
        } else if (this.getActiveSessionId() === sessionId) {
          localStorage.removeItem('cruzpham_active_session_id');
        }
        return result;
      } catch (error) {
        if (this.getActiveSessionId() === sessionId) {
          localStorage.removeItem('cruzpham_active_session_id');
        }
        return { success: false, message: this.mapCallableError(error, 'ERR_SESSION_EXPIRED', 'Session expired.').message, code: 'ERR_SESSION_EXPIRED' };
      }
    }

    const bsStatus = await this.getBootstrapStatus();
    if (!bsStatus.masterReady) {
      return { success: false, code: 'ERR_UNKNOWN' };
    }

    const sessions = this.getSessions();
    const session = sessions[sessionId];
    if (!session) {
      return { success: false, message: 'Session expired', code: 'ERR_SESSION_EXPIRED' };
    }
    
    const users = this.getUsers();
    const user = users.find(u => u.username === session.username);
    if (!user) {
      return { success: false, message: 'User invalid', code: 'ERR_INVALID_CREDENTIALS' };
    }

    if (user.status === 'REVOKED') {
      return { success: false, message: 'Access revoked', code: 'ERR_FORBIDDEN' };
    }

    if (user.expiresAt && Date.now() > new Date(user.expiresAt).getTime()) {
      delete sessions[sessionId];
      this.saveSessions(sessions);
      return { success: false, message: 'Session expired', code: 'ERR_SESSION_EXPIRED' };
    }

    if (session.role !== user.role) {
      sessions[sessionId] = { ...session, role: user.role };
      this.saveSessions(sessions);
      return { success: true, session: sessions[sessionId] };
    }

    return { success: true, session };
  }

  // --- ADMIN USER MANAGEMENT ---

  getAllUsers(actorUsername: string): User[] {
    if (this.useAuthoritativeBackend()) {
      void actorUsername;
      return this.adminConsoleSnapshot.users;
    }
    this.requireMasterAdmin(actorUsername, 'read users');
    return this.getUsers();
  }

  getRequests(actorUsername: string): TokenRequest[] {
    if (this.useAuthoritativeBackend()) {
      void actorUsername;
      return this.adminConsoleSnapshot.requests;
    }
    this.requireMasterAdmin(actorUsername, 'read token requests');
    return this.readRequests();
  }

  getAuditLogs(actorUsername: string): AuditLogEntry[] {
    if (this.useAuthoritativeBackend()) {
      void actorUsername;
      return this.adminConsoleSnapshot.auditLogs;
    }
    this.requireMasterAdmin(actorUsername, 'read audit logs');
    return this.readAuditLogs();
  }

  async loadAdminConsoleSnapshot(actorUsername: string): Promise<AdminConsoleSnapshotShape> {
    if (this.useAuthoritativeBackend()) {
      void actorUsername;
      try {
        const snapshot = await this.callBackend<AdminConsoleSnapshotShape>('getAdminConsoleSnapshot', {
          sessionId: this.requireActiveSessionId('Admin console access'),
        });
        this.setAdminConsoleSnapshot(snapshot);
        return snapshot;
      } catch (error) {
        throw this.mapCallableError(error, 'ERR_FORBIDDEN', 'Unable to load admin console data.');
      }
    }

    const users = this.getAllUsers(actorUsername);
    const requests = this.getRequests(actorUsername);
    const auditLogs = this.getAuditLogs(actorUsername);
    const snapshot = { users, requests, auditLogs };
    this.setAdminConsoleSnapshot(snapshot);
    return snapshot;
  }

  async getPendingRequestCount(actorUsername: string): Promise<number> {
    if (this.useAuthoritativeBackend()) {
      const snapshot = await this.loadAdminConsoleSnapshot(actorUsername);
      return snapshot.requests.filter((request) => request.status === 'PENDING').length;
    }
    return this.getRequests(actorUsername).filter((request) => request.status === 'PENDING').length;
  }

  subscribeToRequests(callback: (requests: TokenRequest[]) => void): () => void {
    if (this.useAuthoritativeBackend()) {
      callback(this.adminConsoleSnapshot.requests);
      return () => {};
    }
    callback(this.readRequests());
    return () => {};
  }

  async beginRequestReview(actorUsername: string, reqId: string): Promise<TokenRequest> {
    if (this.useAuthoritativeBackend()) {
      try {
        const request = await this.callBackend<TokenRequest>('beginStudioRequestReview', {
          sessionId: this.requireActiveSessionId('Request review'),
          reqId,
        });
        this.upsertSnapshotRequest(request);
        return request;
      } catch (error) {
        throw this.mapCallableError(error, 'ERR_REQUEST_LOCKED', 'Unable to open request review.');
      }
    }

    const users = this.getUsers();
    const actor = this.requireMasterAdmin(actorUsername, 'review token requests', users);
    const requests = this.readRequests();
    const request = requests.find((entry) => entry.id === reqId);

    if (!request) {
      throw new AppError('ERR_REQUEST_NOT_FOUND', 'Request not found', logger.getCorrelationId());
    }
    if (request.status !== 'PENDING') {
      throw new AppError('ERR_REQUEST_ALREADY_PROCESSED', 'Request is not pending', logger.getCorrelationId());
    }

    this.claimRequestReviewLock(actor.username, request);
    request.reviewedBy = actor.username;
    request.reviewedAt = new Date().toISOString();
    this.saveRequests(requests);

    await this.logAction(actor, 'REQUEST_REVIEW_STARTED', `Master Admin opened ${request.firstName} ${request.lastName}'s access request for review.`, { requestId: reqId }, reqId);
    return request;
  }

  async createUser(actorUsername: string, userData: Partial<User> & { profile?: Partial<UserProfile> }, role: UserRole, durationMinutes?: number): Promise<string> {
    if (this.useAuthoritativeBackend()) {
      try {
        const result = await this.callBackend<{ rawToken: string; user: User }>('createStudioUser', {
          sessionId: this.requireActiveSessionId('User creation'),
          userData,
          role,
          durationMinutes,
        });
        this.upsertSnapshotUser(result.user);
        return result.rawToken;
      } catch (error) {
        throw this.mapCallableError(error, 'ERR_FORBIDDEN', 'Unable to create user.');
      }
    }

    this.checkUserRateLimit(actorUsername);
    const users = this.getUsers();
    const actor = this.requireMasterAdmin(actorUsername, 'create users', users);
    const sanitizedRole = this.sanitizeCreatableRole(role);
    const sanitizedUsername = this.sanitizeUsername(userData.username || '', 'Username');
    const sanitizedStatus = this.sanitizeUserStatus(userData.status);

    let normalizedPhone = userData.phone?.trim();
    if (normalizedPhone) {
      normalizedPhone = validateAndNormalizePhone(normalizedPhone);
    }

    const email = this.sanitizeOptionalEmail(userData.email);
    const firstName = this.sanitizeOptionalName(userData.profile?.firstName, 'First name');
    const lastName = this.sanitizeOptionalName(userData.profile?.lastName, 'Last name');
    const tiktokHandle = this.sanitizeTikTokHandle(userData.profile?.tiktokHandle);
    const notes = this.sanitizeOptionalNotes(userData.profile?.notes);

    if (durationMinutes !== undefined && (!Number.isFinite(durationMinutes) || durationMinutes <= 0)) {
      throw new AppError('ERR_VALIDATION', 'Duration must be a positive number of minutes.', logger.getCorrelationId());
    }

    if (users.find(u => u.username.toLowerCase() === sanitizedUsername.toLowerCase())) {
      throw new AppError('ERR_FORBIDDEN', 'Username taken', logger.getCorrelationId());
    }

    if (normalizedPhone && users.some((user) => user.phone === normalizedPhone)) {
      throw new AppError('ERR_FORBIDDEN', 'Phone number already assigned to another user.', logger.getCorrelationId());
    }

    if (email && users.some((user) => user.email?.toLowerCase() === email)) {
      throw new AppError('ERR_FORBIDDEN', 'Email address already assigned to another user.', logger.getCorrelationId());
    }

    const rawToken = generateSecret(sanitizedRole === 'ADMIN' ? 'ak' : 'pk', 16);
    const hash = await hashToken(rawToken);

    let expiresAt: string | null = null;
    if (durationMinutes) {
      expiresAt = new Date(Date.now() + durationMinutes * 60000).toISOString();
    }

    const newUser: User = {
      id: crypto.randomUUID(),
      username: sanitizedUsername,
      tokenHash: hash,
      role: sanitizedRole,
      status: sanitizedStatus,
      email,
      phone: normalizedPhone,
      
      profile: {
        firstName,
        lastName,
        tiktokHandle,
        notes,
        source: userData.profile?.source || ('MANUAL_CREATE' as UserSource),
        originalRequestId: userData.profile?.originalRequestId,
        preferredUsername: userData.profile?.preferredUsername,
      },

      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt,
      createdBy: actor.username,
      credentialDelivery: {}
    };

    users.push(newUser);
    this.saveUsers(users);
    
    const actionType = sanitizedRole === 'ADMIN' ? 'ADMIN_CREATED' : 'USER_CREATED';
    await this.logAction(actor, actionType, `Username ${newUser.username} was created for ${firstName || newUser.username}${lastName ? ` ${lastName}` : ''}.`, { role: sanitizedRole, expiresAt, status: sanitizedStatus }, newUser.username);
    await this.logAction(actor, 'TOKEN_ISSUED', `A secure access token was generated for ${newUser.username}.`, { role: sanitizedRole }, newUser.username);

    return rawToken;
  }

  async refreshToken(actorUsername: string, targetUsername: string): Promise<string> {
    if (this.useAuthoritativeBackend()) {
      try {
        const result = await this.callBackend<{ rawToken: string; user: User }>('refreshStudioUserToken', {
          sessionId: this.requireActiveSessionId('Token rotation'),
          targetUsername,
        });
        this.upsertSnapshotUser(result.user);
        return result.rawToken;
      } catch (error) {
        throw this.mapCallableError(error, 'ERR_UNKNOWN', 'Unable to rotate token.');
      }
    }

    this.checkUserRateLimit(actorUsername);
    const users = this.getUsers();
    const actor = this.requireMasterAdmin(actorUsername, 'refresh user tokens', users);
    const sanitizedTargetUsername = this.sanitizeUsername(targetUsername, 'Target username');
    const targetIdx = users.findIndex(u => u.username === sanitizedTargetUsername);
    
    if (targetIdx === -1) throw new AppError('ERR_UNKNOWN', 'User not found', logger.getCorrelationId());
    const target = users[targetIdx];

    if (target.role === 'MASTER_ADMIN' && actor?.role !== 'MASTER_ADMIN') {
      throw new AppError('ERR_FORBIDDEN', 'Cannot modify Master Admin', logger.getCorrelationId());
    }

    const rawToken = generateSecret(target.role === 'ADMIN' ? 'ak' : 'pk', 16);
    const hash = await hashToken(rawToken);
    target.tokenHash = hash;
    target.updatedAt = new Date().toISOString();
    
    const sessions = this.getSessions();
    Object.keys(sessions).forEach(k => {
      if (sessions[k].username === sanitizedTargetUsername) delete sessions[k];
    });
    this.saveSessions(sessions);

    users[targetIdx] = target;
    this.saveUsers(users);

    await this.logAction(actor, 'TOKEN_REFRESHED', `Rotated token for ${sanitizedTargetUsername}`, { action: 'ROTATE' }, sanitizedTargetUsername);
    return rawToken;
  }

  async sendUserCredentials(actorUsername: string, targetUsername: string, rawToken: string, channels?: DeliveryMethod[]): Promise<{ user: User; delivery: Partial<Record<DeliveryMethod, ChannelDeliveryState>> }> {
    if (this.useAuthoritativeBackend()) {
      try {
        const result = await this.callBackend<{ user: User; delivery: Partial<Record<DeliveryMethod, ChannelDeliveryState>> }>('sendStudioUserCredentials', {
          sessionId: this.requireActiveSessionId('Credential delivery'),
          targetUsername,
          rawToken,
          channels,
        });
        this.upsertSnapshotUser(result.user);
        return result;
      } catch (error) {
        throw this.mapCallableError(error, 'ERR_PROVIDER_DOWN', 'Credential delivery failed.');
      }
    }

    this.checkUserRateLimit(actorUsername);
    const users = this.getUsers();
    const actor = this.requireMasterAdmin(actorUsername, 'send user credentials', users);
    const sanitizedTargetUsername = this.sanitizeUsername(targetUsername, 'Target username');
    const targetIdx = users.findIndex((u) => u.username === sanitizedTargetUsername);

    if (targetIdx === -1) {
      throw new AppError('ERR_UNKNOWN', 'User not found', logger.getCorrelationId());
    }

    const target = users[targetIdx];
    const selectedChannels = (channels && channels.length ? channels : ['SMS', 'EMAIL']).filter((channel, index, array) => array.indexOf(channel) === index);
    const credentialMessage = this.buildCredentialMessage(target, rawToken);
    const delivery: Partial<Record<DeliveryMethod, ChannelDeliveryState>> = {};

    for (const method of selectedChannels) {
      const recipient = method === 'EMAIL' ? target.email : target.phone;
      if (!recipient) {
        delivery[method] = this.getChannelState('SKIPPED', `User has no ${method === 'EMAIL' ? 'email' : 'phone'} on file.`);
        continue;
      }

      this.ensureCredentialSendNotCoolingDown(target, method);
      this.checkDestinationRateLimit(recipient);

      const result = await this.dispatchDelivery(method, recipient, method === 'EMAIL' ? credentialMessage.email : credentialMessage.sms, credentialMessage.subject);
      const timestamp = new Date().toISOString();
      const log: DeliveryLog = {
        id: crypto.randomUUID(),
        method,
        status: result.success ? 'SENT' : 'FAILED',
        timestamp,
        providerId: result.id,
        error: result.error,
        purpose: 'CREDENTIALS',
        recipient,
      };

      this.updateUserDeliveryState(target, log);
      target.credentialDelivery = target.credentialDelivery || {};
      target.credentialDelivery.lastIssuedBy = actor.username;
      delivery[method] = target.credentialDelivery[method];

      if (result.success) {
        await this.logAction(actor, method === 'EMAIL' ? 'MESSAGE_SENT_EMAIL' : 'MESSAGE_SENT_SMS', `Access token was sent to ${target.profile.firstName || target.username} by ${method}.`, { status: 'SENT' }, target.username);
      } else {
        await this.logAction(actor, 'DELIVERY_FAILED', `${method} delivery failed for ${target.profile.firstName || target.username} — retry available.`, { method, error: result.error }, target.username);
      }
    }

    users[targetIdx] = target;
    this.saveUsers(users);

    return { user: target, delivery };
  }

  async resendUserCredentials(actorUsername: string, targetUsername: string, channels?: DeliveryMethod[]): Promise<{ rawToken: string; user: User; delivery: Partial<Record<DeliveryMethod, ChannelDeliveryState>> }> {
    if (this.useAuthoritativeBackend()) {
      try {
        const result = await this.callBackend<{ rawToken: string; user: User; delivery: Partial<Record<DeliveryMethod, ChannelDeliveryState>> }>('resendStudioUserCredentials', {
          sessionId: this.requireActiveSessionId('Credential resend'),
          targetUsername,
          channels,
        });
        this.upsertSnapshotUser(result.user);
        return result;
      } catch (error) {
        throw this.mapCallableError(error, 'ERR_PROVIDER_DOWN', 'Credential resend failed.');
      }
    }

    const rawToken = await this.refreshToken(actorUsername, targetUsername);
    const result = await this.sendUserCredentials(actorUsername, targetUsername, rawToken, channels);
    await this.logAction(actorUsername, 'CREDENTIALS_RESENT', `Credential resend triggered for ${targetUsername}.`, { channels: channels || ['SMS', 'EMAIL'] }, targetUsername);
    return { rawToken, user: result.user, delivery: result.delivery };
  }

  async toggleAccess(actorUsername: string, targetUsername: string, revoke: boolean) {
    if (this.useAuthoritativeBackend()) {
      try {
        const result = await this.callBackend<{ user: User }>('toggleStudioUserAccess', {
          sessionId: this.requireActiveSessionId('Access update'),
          targetUsername,
          revoke,
        });
        this.upsertSnapshotUser(result.user);
        return;
      } catch (error) {
        throw this.mapCallableError(error, 'ERR_FORBIDDEN', 'Unable to update access.');
      }
    }

    const users = this.getUsers();
    const actor = this.requireMasterAdmin(actorUsername, 'toggle account access', users);
    const sanitizedTargetUsername = this.sanitizeUsername(targetUsername, 'Target username');
    const targetIdx = users.findIndex(u => u.username === sanitizedTargetUsername);
    if (targetIdx === -1) return;
    const target = users[targetIdx];

    if (target.role === 'MASTER_ADMIN') throw new AppError('ERR_FORBIDDEN', 'Cannot revoke Master Admin', logger.getCorrelationId());
    if (target.role === 'ADMIN' && actor?.role !== 'MASTER_ADMIN') {
       throw new AppError('ERR_FORBIDDEN', 'Only Master Admin can modify Admins', logger.getCorrelationId());
    }

    target.status = revoke ? 'REVOKED' : 'ACTIVE';
    target.updatedAt = new Date().toISOString();
    
    if (revoke) {
      const sessions = this.getSessions();
      Object.keys(sessions).forEach(k => {
        if (sessions[k].username === sanitizedTargetUsername) delete sessions[k];
      });
      this.saveSessions(sessions);
    }

    users[targetIdx] = target;
    this.saveUsers(users);

    const action = revoke ? 'ACCESS_REVOKED' : 'ACCESS_GRANTED';
    await this.logAction(actor, action, `${revoke ? 'Revoked' : 'Granted'} access for ${sanitizedTargetUsername}`, null, sanitizedTargetUsername);
  }

  async deleteUser(actorUsername: string, targetUsername: string) {
    if (this.useAuthoritativeBackend()) {
      try {
        await this.callBackend<{ success: boolean }>('deleteStudioUser', {
          sessionId: this.requireActiveSessionId('User deletion'),
          targetUsername,
        });
        this.removeSnapshotUser(targetUsername);
        return;
      } catch (error) {
        throw this.mapCallableError(error, 'ERR_FORBIDDEN', 'Unable to delete user.');
      }
    }

    let users = this.getUsers();
    const actor = this.requireMasterAdmin(actorUsername, 'delete users', users);
    const sanitizedTargetUsername = this.sanitizeUsername(targetUsername, 'Target username');
    const target = users.find(u => u.username === sanitizedTargetUsername);
    if (!target) return;

    if (target.role === 'MASTER_ADMIN') throw new AppError('ERR_FORBIDDEN', 'Cannot delete Master Admin', logger.getCorrelationId());
    if (target.role === 'ADMIN' && actor?.role !== 'MASTER_ADMIN') {
      throw new AppError('ERR_FORBIDDEN', 'Only Master Admin can delete Admins', logger.getCorrelationId());
    }

    users = users.filter(u => u.username !== sanitizedTargetUsername);
    this.saveUsers(users);
    
    const sessions = this.getSessions();
    Object.keys(sessions).forEach(k => {
      if (sessions[k].username === sanitizedTargetUsername) delete sessions[k];
    });
    this.saveSessions(sessions);

    await this.logAction(actor, 'USER_DELETED', `Deleted user ${sanitizedTargetUsername}`, { role: target.role }, sanitizedTargetUsername);
  }

  // --- DELIVERY SYSTEM ---

  async sendMessage(actorUsername: string, targetUsername: string, method: 'EMAIL' | 'SMS', content: string) {
    if (this.useAuthoritativeBackend()) {
      try {
        const result = await this.callBackend<{ user: User; deliveryLog: DeliveryLog }>('sendStudioMessage', {
          sessionId: this.requireActiveSessionId(`${method} delivery`),
          targetUsername,
          method,
          content,
        });
        this.upsertSnapshotUser(result.user);
        return result.deliveryLog;
      } catch (error) {
        throw this.mapCallableError(error, 'ERR_PROVIDER_DOWN', 'Message delivery failed.');
      }
    }

    this.checkUserRateLimit(actorUsername);
    
    const users = this.getUsers();
    const actor = this.requireMasterAdmin(actorUsername, `send ${method} messages`, users);
    const sanitizedTargetUsername = this.sanitizeUsername(targetUsername, 'Target username');
    const targetIdx = users.findIndex(u => u.username === sanitizedTargetUsername);
    
    if (targetIdx === -1) throw new AppError('ERR_UNKNOWN', 'User not found', logger.getCorrelationId());
    const target = users[targetIdx];

    const destination = method === 'EMAIL' ? target.email : target.phone;
    if (!destination) {
        throw new AppError('ERR_VALIDATION', `User has no ${method === 'EMAIL' ? 'email' : 'phone'} on file`, logger.getCorrelationId());
    }

    // Rate Limit Destination
    this.checkDestinationRateLimit(destination);

    const result = await this.dispatchDelivery(method, destination, content, 'CruzPham Studios');

    const log: DeliveryLog = {
      id: crypto.randomUUID(),
      method,
      status: result.success ? 'SENT' : 'FAILED',
      timestamp: new Date().toISOString(),
      providerId: result.id,
      error: result.error,
      purpose: 'GENERIC_MESSAGE',
      recipient: destination,
    };
    
    this.updateUserDeliveryState(target, log);
    users[targetIdx] = target;
    this.saveUsers(users);

    const action = method === 'EMAIL' ? 'MESSAGE_SENT_EMAIL' : 'MESSAGE_SENT_SMS';
    if (result.success) {
      await this.logAction(actor, action, `Sent ${method} to ${sanitizedTargetUsername}`, { status: log.status }, sanitizedTargetUsername);
    } else {
      await this.logAction(actor, 'DELIVERY_FAILED', `${method} delivery failed for ${sanitizedTargetUsername} — retry available.`, { status: log.status, error: log.error }, sanitizedTargetUsername);
    }

    if (!result.success) throw new AppError('ERR_PROVIDER_DOWN', result.error || 'Sending failed', logger.getCorrelationId());
    return log;
  }

  // --- REQUEST MANAGEMENT ---
  
  async submitTokenRequest(data: Omit<TokenRequest, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'approvedAt' | 'rejectedAt' | 'reviewedAt' | 'reviewedBy' | 'rejectionReason' | 'linkedUserId' | 'reviewLockExpiresAt' | 'reviewLockedBy' | 'userId' | 'adminNotifyStatus' | 'userNotifyStatus' | 'adminNotifyError' | 'userNotifyError' | 'delivery'>): Promise<TokenRequest> {
    if (this.useAuthoritativeBackend()) {
      try {
        return await this.callBackend<TokenRequest>('submitStudioTokenRequest', { ...data });
      } catch (error) {
        throw this.mapCallableError(error, 'ERR_DUPLICATE_REQUEST', 'Unable to submit access request.');
      }
    }

    const timestamp = new Date().toISOString();
    const firstName = this.sanitizeOptionalName(data.firstName, 'First name');
    const lastName = this.sanitizeOptionalName(data.lastName, 'Last name');
    const tiktokHandle = this.sanitizeTikTokHandle(data.tiktokHandle);
    const preferredUsername = this.sanitizeUsername(this.toUsernameSeed(data.preferredUsername), 'Preferred username');
    const email = this.sanitizeOptionalEmail(data.email);

    if (!firstName || !lastName || !tiktokHandle) {
      throw new AppError('ERR_VALIDATION', 'Please complete all required request fields.', logger.getCorrelationId());
    }
    
    // Validate Phone strictly E.164
    let e164: string;
    try {
      e164 = validateAndNormalizePhone(data.phoneE164);
      logger.info('phoneNormalizeSuccess', { input: data.phoneE164, output: e164 });
    } catch (e: any) {
      logger.warn('phoneNormalizeFail', { input: data.phoneE164, error: e.message });
      throw new AppError('ERR_VALIDATION', 'Please enter a valid phone number (include country code).', logger.getCorrelationId());
    }

    const requests = this.readRequests();
    const duplicatePending = requests.find((request) => {
      if (request.status !== 'PENDING') return false;
      const age = Date.now() - new Date(request.createdAt).getTime();
      if (age > REQUEST_DEDUP_WINDOW_MS) return false;
      return request.phoneE164 === e164 || request.preferredUsername.toLowerCase() === preferredUsername.toLowerCase();
    });

    if (duplicatePending) {
      throw new AppError('ERR_DUPLICATE_REQUEST', 'A pending access request already exists for this phone number or username.', logger.getCorrelationId());
    }

    // 1. Persist IMMEDIATELY
    const newRequest: TokenRequest = {
      id: crypto.randomUUID().split('-')[0].toUpperCase(),
      firstName,
      lastName,
      tiktokHandle,
      preferredUsername,
      phoneE164: e164,
      email,
      status: 'PENDING',
      createdAt: timestamp,
      updatedAt: timestamp,
      adminNotifyStatus: 'PENDING',
      userNotifyStatus: 'PENDING',
      delivery: {}
    };
    
    logger.info('requestCreateAttempt', { reqId: newRequest.id });

    requests.unshift(newRequest);
    this.saveRequests(requests);

    await this.logAction('SYSTEM', 'REQUEST_SUBMITTED', `${firstName} ${lastName.charAt(0)}. requested producer access.`, { preferredUsername, phoneE164: e164 }, newRequest.id);

    // 2. Trigger Async Email Notification
    this.notifyAdmins(newRequest.id).catch(err => {
        logger.error('Background notifyAdmins failed', err);
    });

    return newRequest;
  }

  async notifyAdmins(reqId: string) {
    logger.info('notifyAdminsAttempt', { reqId });
    
    const requests = this.readRequests();
    const idx = requests.findIndex(r => r.id === reqId);
    if (idx === -1) return;

    const req = requests[idx];
    const recipients = ['cruzphamnetwork@gmail.com', 'eldecoder@gmail.com'];
    
    try {
        const subject = `[ACTION REQUIRED] New Token Request: ${req.preferredUsername}`;
          const body = `User: ${req.firstName} ${req.lastName}\nTikTok: ${req.tiktokHandle}\nPhone: ${req.phoneE164}${req.email ? `\nEmail: ${req.email}` : ''}\n\nPlease review in Admin Console.`;
        
        let successCount = 0;
        for (const email of recipients) {
            const res = await simulateEmailProvider(email, subject, body);
            if (res.success) successCount++;
        }

        if (successCount > 0) {
            req.adminNotifyStatus = 'SENT';
            req.adminNotifyError = undefined;
            await this.logAction('SYSTEM', 'ADMIN_NOTIFIED', `Admins notified for ${reqId}`);
        } else {
             req.adminNotifyStatus = 'FAILED';
             req.adminNotifyError = 'All provider attempts failed';
             logger.error('notifyAdminsFail', { reqId, error: req.adminNotifyError });
        }
    } catch (e: any) {
        req.adminNotifyStatus = 'FAILED';
        req.adminNotifyError = e.message || "Provider Error";
        logger.error('notifyAdminsFail', { error: e });
    }

    requests[idx] = req;
    this.saveRequests(requests);
  }

  async retryAdminNotification(actorUsername: string, reqId: string) {
      if (this.useAuthoritativeBackend()) {
        try {
          await this.callBackend<{ success: boolean; request: TokenRequest }>('retryStudioAdminNotification', {
            sessionId: this.requireActiveSessionId('Admin notification retry'),
            reqId,
          });
          return;
        } catch (error) {
          throw this.mapCallableError(error, 'ERR_PROVIDER_DOWN', 'Unable to retry admin notification.');
        }
      }

      this.requireMasterAdmin(actorUsername, 'retry admin notification');
      return this.notifyAdmins(reqId);
  }

  // APPROVAL WORKFLOW
  async approveRequest(actorUsername: string, reqId: string, customUsernameOrOptions?: string | { username?: string; email?: string; role?: Exclude<UserRole, 'MASTER_ADMIN'>; sendSms?: boolean; sendEmail?: boolean; notes?: string }): Promise<{ rawToken: string, user: User; delivery: Partial<Record<DeliveryMethod, ChannelDeliveryState>> }> {
    if (this.useAuthoritativeBackend()) {
      try {
        const options = typeof customUsernameOrOptions === 'string'
          ? { username: customUsernameOrOptions }
          : (customUsernameOrOptions || {});
        const result = await this.callBackend<{ rawToken: string; user: User; delivery: Partial<Record<DeliveryMethod, ChannelDeliveryState>>; request: TokenRequest }>('approveStudioRequest', {
          sessionId: this.requireActiveSessionId('Request approval'),
          reqId,
          options,
        });
        this.upsertSnapshotUser(result.user);
        this.upsertSnapshotRequest(result.request);
        return { rawToken: result.rawToken, user: result.user, delivery: result.delivery };
      } catch (error) {
        throw this.mapCallableError(error, 'ERR_REQUEST_ALREADY_PROCESSED', 'Unable to approve request.');
      }
    }

    const users = this.getUsers();
    const actor = this.requireMasterAdmin(actorUsername, 'approve requests', users);

    const requests = this.readRequests();
    const reqIndex = requests.findIndex(r => r.id === reqId);
    if (reqIndex === -1) throw new AppError('ERR_REQUEST_NOT_FOUND', 'Request not found', logger.getCorrelationId());
    const req = requests[reqIndex];

    if (req.status !== 'PENDING') {
       throw new AppError('ERR_REQUEST_ALREADY_PROCESSED', 'Request is not pending', logger.getCorrelationId());
    }

    this.claimRequestReviewLock(actor.username, req);

    const options = typeof customUsernameOrOptions === 'string'
      ? { username: customUsernameOrOptions }
      : (customUsernameOrOptions || {});
    const requestedUsername = options.username?.trim() || req.preferredUsername;
    const strictUsername = Boolean(options.username?.trim());
    const existingUsernames = this.getUsers();
    let finalUsername = this.sanitizeUsername(this.toUsernameSeed(requestedUsername), 'Assigned username');

    if (this.getUserByUsername(finalUsername, existingUsernames)) {
      if (strictUsername) {
        throw new AppError('ERR_FORBIDDEN', 'Assigned username is already taken.', logger.getCorrelationId());
      }
      finalUsername = this.buildAvailableUsername(requestedUsername, existingUsernames);
    }

    const finalRole = options.role || 'PRODUCER';
    const approvalNotes = this.sanitizeOptionalNotes(options.notes);

    // 1. Create User
    const rawToken = await this.createUser(actorUsername, {
      username: finalUsername,
      email: options.email || req.email,
      phone: req.phoneE164,
      profile: {
        firstName: req.firstName,
        lastName: req.lastName,
        tiktokHandle: req.tiktokHandle,
        source: 'REQUEST_APPROVAL',
        originalRequestId: req.id,
        preferredUsername: req.preferredUsername,
        notes: approvalNotes,
      }
    }, finalRole);

    // Reload users after creation
    const updatedUsers = this.getUsers();
    const newUser = updatedUsers.find(u => u.username === finalUsername)!;

    // 2. Update Request Status & Link
    req.status = 'APPROVED';
    req.updatedAt = new Date().toISOString();
    req.approvedAt = new Date().toISOString();
    req.reviewedAt = req.updatedAt;
    req.reviewedBy = actor.username;
    req.userId = newUser.id;
    req.linkedUserId = newUser.id;
    req.reviewLockedBy = undefined;
    req.reviewLockExpiresAt = undefined;

    // 3. User Notification
    const requestedChannels: DeliveryMethod[] = [];
    if (options.sendSms !== false) requestedChannels.push('SMS');
    if (options.sendEmail !== false) requestedChannels.push('EMAIL');
    const deliveryResult = await this.sendUserCredentials(actorUsername, newUser.username, rawToken, requestedChannels);

    req.delivery = deliveryResult.delivery;
    req.userNotifyStatus = this.getRequestAggregateDeliveryStatus(req);
    req.userNotifyError = req.userNotifyStatus === 'FAILED'
      ? Object.values(deliveryResult.delivery).map((entry) => entry?.error).filter(Boolean).join('; ')
      : undefined;
    requests[reqIndex] = req;
    this.saveRequests(requests);
    
    await this.logAction(actor, 'REQUEST_APPROVED', `Master Admin approved ${req.firstName} ${req.lastName}'s access request. Username ${finalUsername} was created.`, { requestId: reqId, deliveryStatus: req.userNotifyStatus }, newUser.id);

    return { rawToken, user: newUser, delivery: deliveryResult.delivery };
  }

  // REJECTION WORKFLOW
  async rejectRequest(actorUsername: string, reqId: string, reason?: string) {
    if (this.useAuthoritativeBackend()) {
      try {
        const request = await this.callBackend<TokenRequest>('rejectStudioRequest', {
          sessionId: this.requireActiveSessionId('Request rejection'),
          reqId,
          reason,
        });
        this.upsertSnapshotRequest(request);
        return;
      } catch (error) {
        throw this.mapCallableError(error, 'ERR_REQUEST_NOT_FOUND', 'Unable to reject request.');
      }
    }

    const users = this.getUsers();
    const actor = this.requireMasterAdmin(actorUsername, 'reject requests', users);

    const requests = this.readRequests();
    const req = requests.find(r => r.id === reqId);
    if (req) {
      if (req.status !== 'PENDING') {
         throw new AppError('ERR_REQUEST_ALREADY_PROCESSED', 'Request is not pending', logger.getCorrelationId());
      }
      this.claimRequestReviewLock(actor.username, req);
      req.status = 'REJECTED';
      req.updatedAt = new Date().toISOString();
      req.rejectedAt = new Date().toISOString();
      req.reviewedAt = req.updatedAt;
      req.reviewedBy = actor.username;
      req.rejectionReason = this.sanitizeOptionalNotes(reason);
      req.reviewLockedBy = undefined;
      req.reviewLockExpiresAt = undefined;
      this.saveRequests(requests);
      await this.logAction(actor, 'REQUEST_REJECTED', `Master Admin rejected ${req.firstName} ${req.lastName}'s access request.${req.rejectionReason ? ` Reason: ${req.rejectionReason}` : ''}`, { requestId: reqId }, reqId);
    } else {
      throw new AppError('ERR_REQUEST_NOT_FOUND', 'Request not found', logger.getCorrelationId());
    }
  }
}

export const authService = new AuthService();
