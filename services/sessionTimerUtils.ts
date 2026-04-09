/**
 * Session Game Timer Utilities
 *
 * Normalization helpers for session timer duration configuration.
 * Keeps unit-conversion and validation logic isolated and unit-testable.
 * These are used by both the TemplateBuilder config UI and by App.tsx at game-start.
 */

export type SessionTimerUnit = 'seconds' | 'minutes' | 'hours';

/** Quick preset durations (in seconds) shown in the Session Game Timer section. */
export const SESSION_TIMER_PRESET_SECONDS = [5, 10, 15, 20, 30, 45, 60] as const;
export type SessionTimerPresetSeconds = (typeof SESSION_TIMER_PRESET_SECONDS)[number];

/** Maximum allowed session timer duration: 24 hours in seconds. */
export const MAX_SESSION_TIMER_SECONDS = 86400;

/**
 * Normalize a custom numeric entry and time unit to a raw seconds value.
 * Returns null if the input is invalid (non-numeric, zero, negative, or exceeds 24 h).
 */
export const normalizeCustomTimerToSeconds = (
  value: string,
  unit: SessionTimerUnit,
): number | null => {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;

  let seconds: number;
  switch (unit) {
    case 'seconds':
      seconds = Math.floor(n);
      break;
    case 'minutes':
      seconds = Math.floor(n * 60);
      break;
    case 'hours':
      seconds = Math.floor(n * 3600);
      break;
    default:
      return null;
  }

  if (seconds <= 0 || seconds > MAX_SESSION_TIMER_SECONDS) return null;
  return seconds;
};

/**
 * Safely resolve a session timer duration from a raw (possibly unknown) value.
 * Unlike the question countdown resolver, this accepts any positive integer
 * (not restricted to a fixed preset list).
 *
 * @param rawSeconds - The raw value from template config or custom input.
 * @param fallback   - Value to return if rawSeconds is invalid (default 10).
 */
export const resolveSessionTimerDuration = (
  rawSeconds: unknown,
  fallback = 10,
): number => {
  const n = Number(rawSeconds);
  if (Number.isFinite(n) && n > 0 && n <= MAX_SESSION_TIMER_SECONDS) {
    return Math.floor(n);
  }
  return fallback > 0 ? fallback : 10;
};

