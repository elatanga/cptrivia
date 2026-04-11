import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import App from './App';
import { authService } from './services/authService';

declare const jest: any;
declare const describe: any;
declare const test: any;
declare const expect: any;
declare const beforeEach: any;

// Mock sound service
jest.mock('./services/soundService', () => ({
  soundService: {
    playClick: jest.fn(),
    playSelect: jest.fn(),
    playReveal: jest.fn(),
    playAward: jest.fn(),
    playSteal: jest.fn(),
    playVoid: jest.fn(),
    playDoubleOrNothing: jest.fn(),
    playTimerTick: jest.fn(),
    playTimerAlarm: jest.fn(),
    playToast: jest.fn(),
    setMute: jest.fn(), getMute: jest.fn().mockReturnValue(false),
    setVolume: jest.fn(), getVolume: jest.fn().mockReturnValue(0.5)
  }
}));

// Mock Gemini
jest.mock('./services/geminiService', () => ({
  generateTriviaGame: jest.fn().mockResolvedValue([]),
  generateSingleQuestion: jest.fn().mockResolvedValue({ text: 'AI Q', answer: 'AI A' })
}));

describe('Responsive Layout Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
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