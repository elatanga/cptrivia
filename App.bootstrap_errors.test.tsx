import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import App from './App';
import { authService } from './services/authService';
import { logger } from './services/logger';

// --- MOCKS ---

vi.mock('./services/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    getCorrelationId: () => 'test-correlation-id',
    maskPII: (v: any) => v,
  },
}));

vi.mock('./services/soundService', () => ({
  soundService: {
    playSelect: vi.fn(),
    playReveal: vi.fn(),
    playAward: vi.fn(),
    playSteal: vi.fn(),
    playVoid: vi.fn(),
    playDoubleOrNothing: vi.fn(),
    playClick: vi.fn(),
    playTimerTick: vi.fn(),
    playTimerAlarm: vi.fn(),
    playToast: vi.fn(),
    setMute: vi.fn(),
    getMute: vi.fn().mockReturnValue(false),
    setVolume: vi.fn(),
    getVolume: vi.fn().mockReturnValue(0.5),
  },
}));

vi.mock('./services/geminiService', () => ({
  generateTriviaGame: vi.fn().mockResolvedValue([]),
  generateSingleQuestion: vi.fn().mockResolvedValue({ text: 'AI Q', answer: 'AI A' }),
}));

describe('Bootstrap Error Handling & Transport Distinction', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- 1. SUCCESSFUL STATUS FETCH ---

  it('1) Renders Bootstrap when status fetch succeeds with masterReady=false', async () => {
    vi.spyOn(authService, 'getBootstrapStatus').mockResolvedValue({ masterReady: false });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/SYSTEM BOOTSTRAP/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/Unable to Verify Studio Status/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Loading Studio/i)).not.toBeInTheDocument();
  });

  it('2) Renders Login when status fetch succeeds with masterReady=true', async () => {
    const bootstrapState = {
      masterReady: true,
      bootstrapCompleted: true,
      initializedAt: new Date().toISOString(),
    };
    localStorage.setItem('cruzpham_sys_bootstrap', JSON.stringify(bootstrapState));

    vi.spyOn(authService, 'getBootstrapStatus').mockResolvedValue(bootstrapState);

    render(<App />);

    await waitFor(() => {
      expect(screen.queryByText(/SYSTEM BOOTSTRAP/i)).not.toBeInTheDocument();
      expect(screen.getByText(/Studio Access/i)).toBeInTheDocument();
    });
  });

  // --- 2. TRANSPORT FAILURES (NETWORK / CORS) ---

  it('3) Shows Bootstrap (not fatal error) when fetch throws network error', async () => {
    const networkError = new Error('Failed to fetch');
    networkError.name = 'TypeError';

    vi.spyOn(authService, 'getBootstrapStatus').mockRejectedValue(networkError);

    render(<App />);

    // Wait for authChecked to become true
    await waitFor(() => {
      expect(screen.getByText(/SYSTEM BOOTSTRAP/i)).toBeInTheDocument();
    });

    // Should NOT show fatal error
    expect(screen.queryByText(/Unable to Verify Studio Status/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Bootstrap is hidden until/i)).not.toBeInTheDocument();
  });

  it('4) Shows Bootstrap when fetch throws CORS error', async () => {
    const corsError = new Error('Cross-Origin Request Blocked');
    corsError.name = 'TypeError';

    vi.spyOn(authService, 'getBootstrapStatus').mockRejectedValue(corsError);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/SYSTEM BOOTSTRAP/i)).toBeInTheDocument();
    });

    // Should NOT show fatal error
    expect(screen.queryByText(/Unable to Verify Studio Status/i)).not.toBeInTheDocument();
  });

  it('5) Shows Bootstrap when backend endpoint is unreachable (ERR_NETWORK)', async () => {
    const { AppError } = await import('./types');
    const networkError = new AppError('ERR_NETWORK', 'Cannot reach the system backend. Check your connection and try again.');

    vi.spyOn(authService, 'getBootstrapStatus').mockRejectedValue(networkError);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/SYSTEM BOOTSTRAP/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/Unable to Verify Studio Status/i)).not.toBeInTheDocument();
  });

  // --- 3. UNEXPECTED ERRORS (should show fatal screen) ---

  it('6) Shows fatal error screen for unexpected errors (non-ERR_NETWORK)', async () => {
    const { AppError } = await import('./types');
    const unexpectedError = new AppError('ERR_UNKNOWN', 'Something went wrong', 'test-id');

    vi.spyOn(authService, 'getBootstrapStatus').mockRejectedValue(unexpectedError);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Unable to Verify Studio Status/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/Retry Status Check/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Contact Support/i })).toBeInTheDocument();
  });

  it('7) Shows fatal error screen for backend validation errors', async () => {
    const { AppError } = await import('./types');
    const validationError = new AppError('ERR_VALIDATION', 'Invalid bootstrap response');

    vi.spyOn(authService, 'getBootstrapStatus').mockRejectedValue(validationError);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Unable to Verify Studio Status/i)).toBeInTheDocument();
    });
  });

  // --- 4. RETRY FLOW ---

  it('8) Allows retry of status check from fatal error screen', async () => {
    const { AppError } = await import('./types');
    let callCount = 0;

    vi.spyOn(authService, 'getBootstrapStatus').mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        throw new AppError('ERR_UNKNOWN', 'First attempt failed');
      }
      return { masterReady: false };
    });

    render(<App />);

    // First render shows error
    await waitFor(() => {
      expect(screen.getByText(/Unable to Verify Studio Status/i)).toBeInTheDocument();
    });

    // Click retry
    const retryButton = screen.getByText(/Retry Status Check/i);
    retryButton.click();

    // Second render should succeed (but still loading)
    await waitFor(
      () => {
        expect(screen.getByText(/SYSTEM BOOTSTRAP/i)).toBeInTheDocument();
      },
      { timeout: 5000 }
    );
  });

  // --- 5. LOGGING VERIFICATION ---

  it('9) Logs transport errors distinctly from backend errors', async () => {
    const { AppError } = await import('./types');
    const networkError = new AppError('ERR_NETWORK', 'Cannot reach backend');

    vi.spyOn(authService, 'getBootstrapStatus').mockRejectedValue(networkError);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/SYSTEM BOOTSTRAP/i)).toBeInTheDocument();
    });

    expect(logger.error).toHaveBeenCalledWith(
      'bootstrap_error_occurred',
      expect.objectContaining({
        code: 'ERR_NETWORK',
      })
    );

    expect(logger.warn).toHaveBeenCalledWith(
      'bootstrap_network_unavailable_using_local',
      expect.objectContaining({
        fallbackMode: 'local_authority',
        isTransport: true,
        message: 'Cannot reach backend',
      })
    );
  });

  it('10) Logs unexpected errors for investigation', async () => {
    const { AppError } = await import('./types');
    const unexpectedError = new AppError('ERR_UNKNOWN', 'Unexpected error');

    vi.spyOn(authService, 'getBootstrapStatus').mockRejectedValue(unexpectedError);

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/Unable to Verify Studio Status/i)).toBeInTheDocument();
    });

    expect(logger.error).toHaveBeenCalledWith(
      'bootstrap_unexpected_error',
      expect.objectContaining({
        code: 'ERR_UNKNOWN',
      })
    );
  });

  // --- 6. NON-OK RESPONSE HANDLING ---

  it('11) Handles non-200 responses gracefully', async () => {
    const { AppError } = await import('./types');
    const backendError = new AppError(
      'ERR_NETWORK',
      'Backend returned an error. Try again shortly.'
    );

    vi.spyOn(authService, 'getBootstrapStatus').mockRejectedValue(backendError);

    render(<App />);

    // Since it's ERR_NETWORK, should show Bootstrap, not error screen
    await waitFor(() => {
      expect(screen.getByText(/SYSTEM BOOTSTRAP/i)).toBeInTheDocument();
    });

    expect(screen.queryByText(/Unable to Verify Studio Status/i)).not.toBeInTheDocument();
  });

  // --- 7. RECOVERY FROM TEMPORARY FAILURES ---

  it('12) Allows user to proceed with Bootstrap even when backend unavailable', async () => {
    const { AppError } = await import('./types');

    vi.spyOn(authService, 'getBootstrapStatus').mockRejectedValue(
      new AppError('ERR_NETWORK', 'Cannot reach backend')
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByText(/SYSTEM BOOTSTRAP/i)).toBeInTheDocument();
    });

    // User can still see the bootstrap form and should be able to interact
    expect(screen.getByPlaceholderText(/e.g. master_admin/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Initialize Studio/i })).toBeInTheDocument();
  });
});

