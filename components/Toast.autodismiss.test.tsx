/**
 * Toast Auto-Dismiss Tests
 *
 * Phase 8 additive tests covering:
 *   A) Log popup appears and auto-dismisses in under 1 second
 *   B) Repeated toasts do not remain stuck
 *   C) Regression lock: popup lifetime is brief and non-disruptive
 */

import React from 'react';
import { render, screen, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ToastContainer } from './Toast';
import { ToastMessage } from '../types';

vi.mock('../services/soundService', () => ({
  soundService: { playToast: vi.fn() },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const makeToast = (id: string, type: ToastMessage['type'] = 'info'): ToastMessage => ({
  id,
  type,
  message: `Test toast ${id}`,
});

// ─────────────────────────────────────────────────────────────────────────────
// A) AUTO-DISMISS UNDER 1 SECOND
// ─────────────────────────────────────────────────────────────────────────────

describe('A) Toast auto-dismiss under 1 second', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('A1: toast is visible immediately after render', () => {
    const removeToast = vi.fn();
    render(
      <ToastContainer toasts={[makeToast('t1')]} removeToast={removeToast} />
    );
    expect(screen.getByText('Test toast t1')).toBeInTheDocument();
  });

  it('A2: removeToast is NOT called before 750ms', () => {
    const removeToast = vi.fn();
    render(
      <ToastContainer toasts={[makeToast('t2')]} removeToast={removeToast} />
    );
    act(() => { vi.advanceTimersByTime(749); });
    expect(removeToast).not.toHaveBeenCalled();
  });

  it('A3: removeToast IS called at 750ms', () => {
    const removeToast = vi.fn();
    render(
      <ToastContainer toasts={[makeToast('t3')]} removeToast={removeToast} />
    );
    act(() => { vi.advanceTimersByTime(750); });
    expect(removeToast).toHaveBeenCalledWith('t3');
    expect(removeToast).toHaveBeenCalledTimes(1);
  });

  it('A4: removeToast is called no more than once per toast', () => {
    const removeToast = vi.fn();
    render(
      <ToastContainer toasts={[makeToast('t4')]} removeToast={removeToast} />
    );
    act(() => { vi.advanceTimersByTime(5000); });
    expect(removeToast).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B) MULTIPLE TOASTS DON'T REMAIN STUCK
// ─────────────────────────────────────────────────────────────────────────────

describe('B) Multiple toasts dismiss independently', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('B1: each toast fires its own removeToast callback at 750ms', () => {
    const removeToast = vi.fn();
    const toasts: ToastMessage[] = [
      makeToast('ta', 'success'),
      makeToast('tb', 'error'),
      makeToast('tc', 'info'),
    ];
    render(<ToastContainer toasts={toasts} removeToast={removeToast} />);

    expect(screen.getByText('Test toast ta')).toBeInTheDocument();
    expect(screen.getByText('Test toast tb')).toBeInTheDocument();
    expect(screen.getByText('Test toast tc')).toBeInTheDocument();

    act(() => { vi.advanceTimersByTime(750); });

    expect(removeToast).toHaveBeenCalledTimes(3);
    expect(removeToast).toHaveBeenCalledWith('ta');
    expect(removeToast).toHaveBeenCalledWith('tb');
    expect(removeToast).toHaveBeenCalledWith('tc');
  });

  it('B2: toast timer is cleaned up on unmount (no timer leak)', () => {
    const removeToast = vi.fn();
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = render(
      <ToastContainer toasts={[makeToast('tu')]} removeToast={removeToast} />
    );
    unmount();
    // clearTimeout should have been called during cleanup
    expect(clearTimeoutSpy).toHaveBeenCalled();
    clearTimeoutSpy.mockRestore();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C) REGRESSION LOCKS
// ─────────────────────────────────────────────────────────────────────────────

describe('C) Regression locks — toast lifetime', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('C1: toast does NOT auto-dismiss in under 700ms (brief visibility preserved)', () => {
    const removeToast = vi.fn();
    render(
      <ToastContainer toasts={[makeToast('r1')]} removeToast={removeToast} />
    );
    act(() => { vi.advanceTimersByTime(700); });
    expect(removeToast).not.toHaveBeenCalled();
  });

  it('C2: toast DOES auto-dismiss at or after 750ms', () => {
    const removeToast = vi.fn();
    render(
      <ToastContainer toasts={[makeToast('r2')]} removeToast={removeToast} />
    );
    act(() => { vi.advanceTimersByTime(750); });
    expect(removeToast).toHaveBeenCalledWith('r2');
  });

  it('C3: success/error/info toast types all auto-dismiss in under 1 second', () => {
    const types: Array<ToastMessage['type']> = ['success', 'error', 'info'];
    types.forEach((type) => {
      const removeToast = vi.fn();
      const { unmount } = render(
        <ToastContainer toasts={[makeToast(`type-${type}`, type)]} removeToast={removeToast} />
      );
      act(() => { vi.advanceTimersByTime(750); });
      expect(removeToast).toHaveBeenCalledWith(`type-${type}`);
      unmount();
    });
  });
});

