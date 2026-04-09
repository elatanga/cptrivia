/**
 * Unit tests for sessionTimerUtils.ts
 *
 * Covers normalization, validation, and resolution logic for
 * the Session Game Timer helper functions.
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeCustomTimerToSeconds,
  resolveSessionTimerDuration,
  SESSION_TIMER_PRESET_SECONDS,
  MAX_SESSION_TIMER_SECONDS,
} from './sessionTimerUtils';

// ─────────────────────────────────────────────────────────────────────────────
// normalizeCustomTimerToSeconds
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeCustomTimerToSeconds', () => {
  // ── seconds ──────────────────────────────────────────────────────────────

  it('normalizes seconds correctly', () => {
    expect(normalizeCustomTimerToSeconds('10', 'seconds')).toBe(10);
  });

  it('normalizes fractional seconds by flooring', () => {
    expect(normalizeCustomTimerToSeconds('9.9', 'seconds')).toBe(9);
  });

  it('normalizes maximum valid seconds (86400)', () => {
    expect(normalizeCustomTimerToSeconds('86400', 'seconds')).toBe(86400);
  });

  // ── minutes ──────────────────────────────────────────────────────────────

  it('normalizes 5 minutes to 300 seconds', () => {
    expect(normalizeCustomTimerToSeconds('5', 'minutes')).toBe(300);
  });

  it('normalizes 10 minutes to 600 seconds', () => {
    expect(normalizeCustomTimerToSeconds('10', 'minutes')).toBe(600);
  });

  it('normalizes 1.5 minutes to 90 seconds', () => {
    expect(normalizeCustomTimerToSeconds('1.5', 'minutes')).toBe(90);
  });

  // ── hours ─────────────────────────────────────────────────────────────────

  it('normalizes 1 hour to 3600 seconds', () => {
    expect(normalizeCustomTimerToSeconds('1', 'hours')).toBe(3600);
  });

  it('normalizes 2 hours to 7200 seconds', () => {
    expect(normalizeCustomTimerToSeconds('2', 'hours')).toBe(7200);
  });

  it('normalizes 24 hours (max allowed) to 86400 seconds', () => {
    expect(normalizeCustomTimerToSeconds('24', 'hours')).toBe(86400);
  });

  // ── invalid inputs ────────────────────────────────────────────────────────

  it('rejects zero', () => {
    expect(normalizeCustomTimerToSeconds('0', 'seconds')).toBeNull();
  });

  it('rejects negative values', () => {
    expect(normalizeCustomTimerToSeconds('-5', 'seconds')).toBeNull();
  });

  it('rejects non-numeric string', () => {
    expect(normalizeCustomTimerToSeconds('abc', 'seconds')).toBeNull();
  });

  it('rejects empty string', () => {
    expect(normalizeCustomTimerToSeconds('', 'seconds')).toBeNull();
  });

  it('rejects values over 24 hours in seconds', () => {
    expect(normalizeCustomTimerToSeconds('86401', 'seconds')).toBeNull();
  });

  it('rejects values over 24 hours in minutes', () => {
    // 1441 minutes > 24 hours
    expect(normalizeCustomTimerToSeconds('1441', 'minutes')).toBeNull();
  });

  it('rejects values over 24 hours in hours', () => {
    expect(normalizeCustomTimerToSeconds('25', 'hours')).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolveSessionTimerDuration
// ─────────────────────────────────────────────────────────────────────────────

describe('resolveSessionTimerDuration', () => {
  it('returns valid positive integer as-is', () => {
    expect(resolveSessionTimerDuration(10)).toBe(10);
  });

  it('floors non-integer values', () => {
    expect(resolveSessionTimerDuration(9.9)).toBe(9);
  });

  it('returns the fallback for 0', () => {
    expect(resolveSessionTimerDuration(0, 15)).toBe(15);
  });

  it('returns the fallback for negative values', () => {
    expect(resolveSessionTimerDuration(-5, 10)).toBe(10);
  });

  it('returns the fallback for non-numeric input', () => {
    expect(resolveSessionTimerDuration('abc', 10)).toBe(10);
  });

  it('returns the fallback for null', () => {
    expect(resolveSessionTimerDuration(null, 10)).toBe(10);
  });

  it('returns the fallback for undefined', () => {
    expect(resolveSessionTimerDuration(undefined, 10)).toBe(10);
  });

  it('returns the fallback for values over MAX_SESSION_TIMER_SECONDS', () => {
    expect(resolveSessionTimerDuration(MAX_SESSION_TIMER_SECONDS + 1, 10)).toBe(10);
  });

  it('accepts MAX_SESSION_TIMER_SECONDS itself', () => {
    expect(resolveSessionTimerDuration(MAX_SESSION_TIMER_SECONDS)).toBe(MAX_SESSION_TIMER_SECONDS);
  });

  it('accepts all SESSION_TIMER_PRESET_SECONDS values', () => {
    SESSION_TIMER_PRESET_SECONDS.forEach((s) => {
      expect(resolveSessionTimerDuration(s)).toBe(s);
    });
  });

  it('uses default fallback of 10 when none provided and value is invalid', () => {
    expect(resolveSessionTimerDuration(0)).toBe(10);
  });
});

