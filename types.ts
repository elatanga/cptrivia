
export interface Question {
  id: string;
  text: string;
  points: number;
  answer: string;
  options?: string[];
  isRevealed: boolean;
  isAnswered: boolean;
  isVoided?: boolean;
  isDoubleOrNothing?: boolean;
  specialMoveType?: SpecialMoveType;
}

export interface Category {
  id: string;
  title: string;
  questions: Question[];
}

export type SizeScale = 'XS' | 'S' | 'M' | 'L' | 'XL';

export interface Player {
  id: string;
  name: string;
  score: number;
  color: string;
  wildcardsUsed?: number; 
  wildcardActive?: boolean; 
  stealsCount?: number; 
  questionsAnswered?: number;
  lostOrVoidedCount?: number;
  specialMovesUsedCount?: number;
  specialMovesUsedNames?: string[];
}

export type PlayMode = 'INDIVIDUALS' | 'TEAMS';
export type TeamPlayStyle = 'TEAM_PLAYS_AS_ONE' | 'TEAM_MEMBERS_TAKE_TURNS';

export interface TeamMember {
  id: string;
  name: string;
  score?: number;
  orderIndex?: number;
  stealsCount?: number;
  questionsAnswered?: number;
  lostOrVoidedCount?: number;
  specialMovesUsedCount?: number;
  specialMovesUsedNames?: string[];
}

export interface Team {
  id: string;
  name: string;
  members: TeamMember[];
  score: number;
  activeMemberId?: string;
}

export interface TeamModeConfig {
  enabled: boolean;
  teamPlayStyle: TeamPlayStyle;
}

export interface GameTimer {
  duration: number; 
  endTime: number | null; 
  isRunning: boolean;
}

export interface BoardViewSettings {
  // Canonical Sizing Model
  categoryTitleScale: SizeScale;
  playerNameScale: SizeScale;
  tileScale: SizeScale;
  
  // Layout Controls
  scoreboardScale: number; // Width multiplier (0.8 - 1.4)
  tilePaddingScale: number; // Spacing multiplier (0.5 - 1.5)
  
  // Question Modal Display Settings
  questionModalSize: 'Small' | 'Medium' | 'Large' | 'ExtraLarge'; // Modal size preset
  questionMaxWidthPercent: number; // Max content width (60-100% of modal)
  questionFontScale: number; // Font size multiplier (0.8 - 1.5)
  questionContentPadding: number; // Padding around question (4-24px)
  multipleChoiceColumns: 'auto' | '1' | '2'; // Grid column mode
  
  // Metadata
  updatedAt: string;
}

export interface PlayEvent {
  id: string;
  atIso: string;
  atMs: number;
  action: 'AWARD' | 'STEAL' | 'VOID' | 'RETURN';
  tileId: string;
  categoryIndex?: number;
  categoryName?: string;
  rowIndex?: number;
  basePoints?: number;
  effectivePoints?: number;
  attemptedPlayerId?: string;
  attemptedPlayerName?: string;
  awardedPlayerId?: string;
  awardedPlayerName?: string;
  stealerPlayerId?: string;
  stealerPlayerName?: string;
  notes?: string;
}

export type AnalyticsEventType = 
  | 'SESSION_STARTED' 
  | 'SESSION_ENDED'
  | 'TILE_OPENED'
  | 'ANSWER_REVEALED'
  | 'POINTS_AWARDED'
  | 'POINTS_STOLEN'
  | 'TILE_VOIDED'
  | 'QUESTION_RETURNED'
  | 'QUESTION_EDITED'
  | 'AI_TILE_REPLACE_START'
  | 'AI_TILE_REPLACE_APPLIED'
  | 'AI_TILE_REPLACE_FAILED'
  | 'AI_CATEGORY_REPLACE_START'
  | 'AI_CATEGORY_REPLACE_APPLIED'
  | 'AI_CATEGORY_REPLACE_FAILED'
  | 'AI_BOARD_REGEN_START'
  | 'AI_BOARD_REGEN_APPLIED'
  | 'AI_BOARD_REGEN_FAILED'
  | 'PLAYER_ADDED'
  | 'PLAYER_REMOVED'
  | 'PLAYER_EDITED'
  | 'PLAYER_SELECTED'
  | 'SCORE_ADJUSTED'
  | 'WILDCARD_USED'
  | 'WILDCARD_RESET'
  | 'TIMER_CONFIG_CHANGED'
  | 'TIMER_STARTED'
  | 'TIMER_STOPPED'
  | 'TIMER_RESET'
  | 'TIMER_FINISHED'
  | 'VIEW_SETTINGS_CHANGED'
  | 'CATEGORY_RENAMED'
  | 'SPECIAL_MOVE_ARMED'
  | 'SPECIAL_MOVE_ARMORY_CLEARED'
  | 'QUESTION_COUNTDOWN_START'
  | 'QUESTION_COUNTDOWN_STOPPED'
  | 'SESSION_TIMER_START'
  | 'SESSION_TIMER_EXPIRED'
  | 'SESSION_TIMER_PAUSED'
  | 'SESSION_TIMER_RESUMED';

export interface GameAnalyticsEvent {
  id: string;
  ts: number;
  iso: string;
  type: AnalyticsEventType;
  actor?: {
    role: 'director' | 'system' | 'player';
    playerId?: string;
    playerName?: string;
  };
  context: {
    showId?: string;
    templateId?: string;
    tileId?: string;
    playerId?: string;
    categoryIndex?: number;
    rowIndex?: number;
    categoryName?: string;
    points?: number;
    playerName?: string;
    delta?: number;
    before?: any;
    after?: any;
    message?: string;
    note?: string;
    specialMoveType?: SpecialMoveType;
    specialMoveName?: string;
    teamMemberId?: string;
    teamMemberName?: string;
  };
}

export interface GameState {
  showTitle: string;
  isGameStarted: boolean;
  categories: Category[];
  players: Player[];
  playMode?: PlayMode;
  teamPlayStyle?: TeamPlayStyle;
  teams?: Team[];
  activeQuestionId: null | string;
  activeCategoryId: null | string;
  selectedPlayerId: null | string;
  history: string[];
  timer: GameTimer;
  viewSettings: BoardViewSettings;
  lastPlays: PlayEvent[];
  events: GameAnalyticsEvent[]; 
}

export interface QuestionCountdownTimer {
  durationSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
  isStopped: boolean;
  startedAt: number | null;
  endsAt: number | null;
  activeQuestionId: string | null;
}

export interface SessionGameTimer {
  durationSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
  isStopped: boolean;
  startedAt: number | null;
  endsAt: number | null;
  selectedPreset: '15m' | '30m' | '1h' | '1h30m' | '2h' | null;
}

export interface TimerAudioSettings {
  enabled: boolean;
  muted: boolean;
  volume: number;
  tickSoundEnabled: boolean;
  endSoundEnabled: boolean;
}

export type SoundCategory = 'TIMERS' | 'GAMEPLAY' | 'UI' | 'SYSTEM';

export type SoundKey =
  | 'timerTick'
  | 'timerEnd'
  | 'sessionCue'
  | 'steal'
  | 'award'
  | 'void'
  | 'reveal'
  | 'correct'
  | 'wrong'
  | 'buzzer'
  | 'doubleOrNothing'
  | 'click'
  | 'select'
  | 'tileOpen'
  | 'modalOpen'
  | 'toastSuccess'
  | 'toastError'
  | 'toastInfo';

export interface SoundControlState {
  enabled: boolean;
  muted: boolean;
  volume: number;
}

export interface SoundBoardState {
  masterEnabled: boolean;
  masterMuted: boolean;
  masterVolume: number;
  sounds: Record<SoundKey, SoundControlState>;
}

export interface SoundDefinition {
  key: SoundKey;
  label: string;
  category: SoundCategory;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  correlationId: string;
  data?: any;
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export type ErrorCode = 
  | 'ERR_INVALID_CREDENTIALS' 
  | 'ERR_RATE_LIMIT' 
  | 'ERR_FORBIDDEN' 
  | 'ERR_PROVIDER_DOWN'
  | 'ERR_NETWORK'
  | 'ERR_AI_GENERATION'
  | 'ERR_LIMIT_REACHED'
  | 'ERR_UNKNOWN'
  | 'ERR_SESSION_EXPIRED'
  | 'ERR_BOOTSTRAP_COMPLETE'
  | 'ERR_VALIDATION'
  | 'ERR_REQUEST_NOT_FOUND'
  | 'ERR_REQUEST_ALREADY_PROCESSED'
  | 'ERR_DUPLICATE_REQUEST'
  | 'ERR_REQUEST_LOCKED'
  | 'ERR_RECOVERY_INVALID';

export interface BootstrapStatus {
  bootstrapCompleted?: boolean;
  masterReady: boolean;
  masterAdminUserId?: string | null;
  initializedAt?: string | null;
  masterAdminUsername?: string;
  recoveryArmed?: boolean;
  recoveryExpiresAt?: string | null;
}

export interface MasterRecoveryIssue {
  recoveryCode: string;
  issuedAt: string;
  expiresAt: string;
}

export interface MasterRecoveryResult {
  username: string;
  rawToken: string;
}

export class AppError extends Error {
  public code: ErrorCode;
  public correlationId: string;
  
  constructor(code: ErrorCode, message: string, correlationId?: string) {
    super(message);
    this.code = code;
    this.correlationId = correlationId || 'unknown';
    this.name = 'AppError';
  }
}

export type UserRole = 'MASTER_ADMIN' | 'ADMIN' | 'PRODUCER';
export type UserSource = 'MANUAL_CREATE' | 'REQUEST_APPROVAL';
export type UserStatus = 'ACTIVE' | 'REVOKED';
export type DeliveryMethod = 'EMAIL' | 'SMS';
export type DeliveryStatus = 'PENDING' | 'SENT' | 'FAILED' | 'SKIPPED';

export interface DeliveryLog {
  id: string;
  method: DeliveryMethod;
  status: DeliveryStatus;
  timestamp: string;
  providerId?: string;
  error?: string;
  purpose?: 'CREDENTIALS' | 'ADMIN_NOTIFICATION' | 'GENERIC_MESSAGE';
  recipient?: string;
}

export interface ChannelDeliveryState {
  status: DeliveryStatus;
  sentAt?: string;
  lastAttemptAt?: string;
  providerId?: string;
  error?: string;
}

export interface CredentialDeliveryState {
  SMS?: ChannelDeliveryState;
  EMAIL?: ChannelDeliveryState;
  lastIssuedAt?: string;
  lastIssuedBy?: string;
}

export interface UserProfile {
  firstName?: string;
  lastName?: string;
  tiktokHandle?: string;
  preferredUsername?: string;
  notes?: string;
  source: UserSource;
  originalRequestId?: string;
}

export interface User {
  id: string;
  username: string;
  tokenHash: string; 
  role: UserRole;
  status: UserStatus;
  email?: string;
  phone?: string; 
  profile: UserProfile;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string | null; 
  createdBy?: string;
  lastDelivery?: DeliveryLog;
  credentialDelivery?: CredentialDeliveryState;
}

export interface Session {
  id: string;
  username: string;
  role: UserRole;
  createdAt: number;
  userAgent: string;
}

export interface TokenRequest {
  id: string;
  firstName: string;
  lastName: string;
  tiktokHandle: string;
  preferredUsername: string;
  phoneE164: string;
  email?: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string; 
  updatedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  reviewedAt?: string;
  reviewedBy?: string;
  rejectionReason?: string;
  linkedUserId?: string;
  reviewLockExpiresAt?: string;
  reviewLockedBy?: string;
  userId?: string; 
  adminNotifyStatus: DeliveryStatus;
  adminNotifyError?: string;
  userNotifyStatus: DeliveryStatus;
  userNotifyError?: string;
  delivery?: Partial<Record<DeliveryMethod, ChannelDeliveryState>>;
}

export interface AuthResponse {
  success: boolean;
  session?: Session;
  message?: string;
  code?: ErrorCode;
}

export type AuditAction = 
  | 'BOOTSTRAP' 
  | 'BOOTSTRAP_BLOCKED'
  | 'LOGIN' 
  | 'TOKEN_ISSUED' 
  | 'TOKEN_REFRESHED' 
  | 'TOKEN_REVOKED' 
  | 'ACCESS_GRANTED' 
  | 'ACCESS_REVOKED' 
  | 'USER_CREATED' 
  | 'USER_UPDATED' 
  | 'USER_DELETED' 
  | 'ADMIN_CREATED' 
  | 'MESSAGE_SENT_EMAIL' 
  | 'MESSAGE_SENT_SMS' 
  | 'REQUEST_APPROVED' 
  | 'REQUEST_REJECTED' 
  | 'REQUEST_SUBMITTED' 
  | 'ADMIN_NOTIFIED'
  | 'REQUEST_REVIEW_STARTED'
  | 'CREDENTIALS_RESENT'
  | 'DELIVERY_FAILED'
  | 'ADMIN_ACCESS_DENIED'
  | 'MASTER_RECOVERY_ISSUED'
  | 'MASTER_RECOVERY_COMPLETED'
  | 'MASTER_RECOVERY_FAILED';

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorId: string;
  actorRole?: string;
  targetId?: string;
  action: AuditAction;
  details: string;
  metadata?: any;
}

export interface Show {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
}

export type Difficulty = 'easy' | 'medium' | 'hard' | 'mixed';

export interface TemplateConfig {
  playerCount: number;
  playerNames?: string[];
  playMode?: PlayMode;
  teamPlayStyle?: TeamPlayStyle;
  teams?: Team[];
  categoryCount: number;
  rowCount: number;
  pointScale?: number;
  quickGameMode?: 'single_player' | 'two_player' | null;
  quickTimerMode?: 'timed' | 'untimed' | null;
  quickTimerDurationSeconds?: number | null;
}

export interface GameTemplate {
  id: string;
  showId: string;
  topic: string;
  config: TemplateConfig;
  categories: Category[];
  createdAt: string;
  lastModified?: string;
}

export type SpecialMoveType =
  | 'DOUBLE_TROUBLE'
  | 'TRIPLE_THREAT'
  | 'SABOTAGE'
  | 'MEGA_STEAL'
  | 'DOUBLE_WINS_OR_NOTHING'
  | 'TRIPLE_WINS_OR_NOTHING'
  | 'SAFE_BET'
  | 'LOCKOUT'
  | 'SUPER_SAVE'
  | 'GOLDEN_GAMBLE'
  | 'SHIELD_BOOST'
  | 'FINAL_SHOT';

export interface SMSDeployment {
  moveType: SpecialMoveType;
  status: 'ARMED' | 'TRIGGERED';
  armedBy: string;
  armedAt: number;
  triggeredAt?: number;
}

export interface SMSActiveMoveContext {
  tileId: string;
  moveType: SpecialMoveType;
  appliedAt: number;
  restrictions: {
    stealAllowed: boolean;
    failAllowed: boolean;
  };
}

export interface SpecialMovesState {
  version: string;
  deployments: Record<string, SMSDeployment>; 
  activeMove: SMSActiveMoveContext | null;
  updatedAt: number;
}
