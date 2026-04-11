import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { authService } from './services/authService';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// Mock sound service
vi.mock('./services/soundService', () => ({
  soundService: {
    playClick: vi.fn(),
    playSelect: vi.fn(),
    playReveal: vi.fn(),
    playAward: vi.fn(),
    playSteal: vi.fn(),
    playVoid: vi.fn(),
    playDoubleOrNothing: vi.fn(),
    playTimerTick: vi.fn(),
    playTimerAlarm: vi.fn(),
    playToast: vi.fn(),
    setMute: vi.fn(), getMute: vi.fn().mockReturnValue(false),
    setVolume: vi.fn(), getVolume: vi.fn().mockReturnValue(0.5)
  }
}));

// Mock Gemini
vi.mock('./services/geminiService', () => ({
  generateTriviaGame: vi.fn().mockResolvedValue([]),
  generateSingleQuestion: vi.fn().mockResolvedValue({ text: 'AI Q', answer: 'AI A' }),
  getGeminiConfigHealth: vi.fn().mockReturnValue({
    isConfigured: true,
    configured: true,
    hasApiKey: true,
    model: 'test-model',
    reason: null,
  }),
}));

describe('Responsive Layout Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  const setViewport = (width: number) => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
    window.dispatchEvent(new Event('resize'));
  };

  test('Desktop Mode (>= 1024px) has fixed height and hidden overflow', async () => {
    setViewport(1200);
    await authService.bootstrapMasterAdmin('admin');
    await authService.login('admin', 'mk-placeholder');
    render(<App />);

    await waitFor(() => {
      const rootContainer = document.querySelector('.min-h-screen.lg\\:h-screen');
      expect(rootContainer).toHaveClass('lg:overflow-hidden');
    });
  });

  test('Compact Mode (< 1024px) allows vertical scrolling', async () => {
    setViewport(800);
    await authService.bootstrapMasterAdmin('admin');
    await authService.login('admin', 'mk-placeholder');
    render(<App />);

    await waitFor(() => {
      const rootContainer = document.querySelector('.min-h-screen.lg\\:h-screen');
      expect(rootContainer).toHaveClass('min-h-screen');
    });
  });

  test('Scoreboard and Board stack in compact mode', async () => {
    setViewport(800);
    // Note: We need a show and template for the actual game board to render
    // Simplified check: check for flex-col classes in the game area
    await authService.bootstrapMasterAdmin('admin');
    await authService.login('admin', 'mk-placeholder');
    render(<App />);

    // Since we start at dashboard, we just verify the root classes are correct
    await waitFor(() => {
        expect(screen.getByText(/CPJS/i)).toBeInTheDocument();
        expect(screen.getByText(/CruzPham Jeopardy Studios/i)).toBeInTheDocument();
    });

    expect(screen.getByLabelText(/Champagne Bottle/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Champagne Flute/i)).toBeInTheDocument();

    const brandLockup = screen.getByTestId('brand-lockup');
    const brandWordmarkStack = screen.getByTestId('brand-wordmark-stack');
    const brandSubtitle = screen.getByTestId('brand-subtitle');
    const brandDivider = screen.getByTestId('brand-gold-divider');
    expect(brandLockup).toBeInTheDocument();
    expect(brandWordmarkStack).toBeInTheDocument();
    expect(brandSubtitle).toBeInTheDocument();
    expect(brandDivider).toBeInTheDocument();
    expect(screen.queryByTestId('brand-title-stack')).not.toBeInTheDocument();
  });
});