import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { authService } from './services/authService';

vi.mock('./services/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    getCorrelationId: () => 'test-id',
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
    playSound: vi.fn(),
    setMute: vi.fn(),
    getMute: vi.fn().mockReturnValue(false),
    setVolume: vi.fn(),
    getVolume: vi.fn().mockReturnValue(0.5),
  },
}));

vi.mock('./services/geminiService', () => ({
  generateTriviaGame: vi.fn().mockResolvedValue([]),
  generateSingleQuestion: vi.fn().mockResolvedValue({ text: 'AI Q', answer: 'AI A' }),
  getGeminiConfigHealth: vi.fn().mockReturnValue({
    hasApiKey: true,
    source: 'test',
    status: 'ready',
    keyPreview: 'mock-key',
  }),
}));

window.scrollTo = vi.fn();
window.confirm = vi.fn(() => true);

const setupQuickTimedGame = async (modeLabel: '1 Player' | '2 Players') => {
  const token = await authService.bootstrapMasterAdmin('admin');
  await authService.login('admin', token);

  render(<App />);

  await waitFor(() => screen.getByText(/Select Production/i));

  fireEvent.change(screen.getByPlaceholderText(/New Show Title/i), {
    target: { value: `Quick Timer ${modeLabel}` },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));

  await waitFor(() => screen.getByText(/Template Library/i));
  fireEvent.click(screen.getByRole('button', { name: /^Create Template$/i }));

  await waitFor(() => screen.getByPlaceholderText(/e\.g\. Science Night 2024/i));
  fireEvent.change(screen.getByPlaceholderText(/e\.g\. Science Night 2024/i), {
    target: { value: `Quick-${modeLabel}` },
  });

  fireEvent.click(screen.getByRole('button', { name: modeLabel }));
  fireEvent.click(screen.getByRole('button', { name: /^Timed$/i }));
  fireEvent.click(screen.getByRole('button', { name: /^5s$/i }));

  fireEvent.click(screen.getByRole('button', { name: /Start Manual Studio Building/i }));

  await waitFor(() => screen.getByRole('button', { name: /Save Template/i }));
  fireEvent.click(screen.getByRole('button', { name: /Save Template/i }));

  await waitFor(() => screen.getByRole('button', { name: /Play Show/i }));
  fireEvent.click(screen.getByRole('button', { name: /Play Show/i }));

  await waitFor(() => screen.getByRole('button', { name: /End Show/i }));
  await waitFor(() => screen.getByTestId('scoreboard-session-timer-controls'));
};

const setupQuickTimedGameWithCustomDuration = async (
  modeLabel: '1 Player' | '2 Players',
  customSeconds: number,
) => {
  const token = await authService.bootstrapMasterAdmin('admin');
  await authService.login('admin', token);

  render(<App />);

  await waitFor(() => screen.getByText(/Select Production/i));

  fireEvent.change(screen.getByPlaceholderText(/New Show Title/i), {
    target: { value: `Quick Timer Custom ${modeLabel}` },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));

  await waitFor(() => screen.getByText(/Template Library/i));
  fireEvent.click(screen.getByRole('button', { name: /^Create Template$/i }));

  await waitFor(() => screen.getByPlaceholderText(/e\.g\. Science Night 2024/i));
  fireEvent.change(screen.getByPlaceholderText(/e\.g\. Science Night 2024/i), {
    target: { value: `Quick-Custom-${modeLabel}` },
  });

  fireEvent.click(screen.getByRole('button', { name: modeLabel }));
  fireEvent.click(screen.getByRole('button', { name: /^Timed$/i }));
  fireEvent.change(screen.getByTestId('custom-session-timer-input'), { target: { value: String(customSeconds) } });
  fireEvent.click(screen.getByTestId('custom-session-timer-apply'));

  fireEvent.click(screen.getByRole('button', { name: /Start Manual Studio Building/i }));

  await waitFor(() => screen.getByRole('button', { name: /Save Template/i }));
  fireEvent.click(screen.getByRole('button', { name: /Save Template/i }));

  await waitFor(() => screen.getByRole('button', { name: /Play Show/i }));
  fireEvent.click(screen.getByRole('button', { name: /Play Show/i }));

  await waitFor(() => screen.getByRole('button', { name: /End Show/i }));
  await waitFor(() => screen.getByTestId('scoreboard-session-timer-controls'));
};

const setupQuickTimedGameWithDefaultDuration = async (modeLabel: '1 Player' | '2 Players') => {
  const token = await authService.bootstrapMasterAdmin('admin');
  await authService.login('admin', token);

  render(<App />);

  await waitFor(() => screen.getByText(/Select Production/i));

  fireEvent.change(screen.getByPlaceholderText(/New Show Title/i), {
    target: { value: `Quick Timer Default ${modeLabel}` },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));

  await waitFor(() => screen.getByText(/Template Library/i));
  fireEvent.click(screen.getByRole('button', { name: /^Create Template$/i }));

  await waitFor(() => screen.getByPlaceholderText(/e\.g\. Science Night 2024/i));
  fireEvent.change(screen.getByPlaceholderText(/e\.g\. Science Night 2024/i), {
    target: { value: `Quick-Default-${modeLabel}` },
  });

  fireEvent.click(screen.getByRole('button', { name: modeLabel }));
  fireEvent.click(screen.getByRole('button', { name: /^Timed$/i }));

  fireEvent.click(screen.getByRole('button', { name: /Start Manual Studio Building/i }));

  await waitFor(() => screen.getByRole('button', { name: /Save Template/i }));
  fireEvent.click(screen.getByRole('button', { name: /Save Template/i }));

  await waitFor(() => screen.getByRole('button', { name: /Play Show/i }));
  fireEvent.click(screen.getByRole('button', { name: /Play Show/i }));

  await waitFor(() => screen.getByRole('button', { name: /End Show/i }));
  await waitFor(() => screen.getByTestId('scoreboard-session-timer-controls'));
};

const getDisplayedSessionSeconds = () => {
  const timerText = screen.getByTestId('scoreboard-session-timer').textContent || '';
  const timerMatch = timerText.match(/(\d+):(\d{2})/);
  if (!timerMatch) return 0;
  return Number(timerMatch[1]) * 60 + Number(timerMatch[2]);
};

describe('Quick game session timer expiry integration', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const assertAutoEndsWithoutPrompt = async () => {
    const controls = screen.getByTestId('scoreboard-session-timer-controls');
    const timerText = screen.getByTestId('scoreboard-session-timer').textContent || '';
    const timerMatch = timerText.match(/(\d+):(\d{2})/);
    const displayedSeconds = timerMatch
      ? Number(timerMatch[1]) * 60 + Number(timerMatch[2])
      : 10;
    // Buffer for render/interval drift and state transitions back to template dashboard.
    const waitMs = Math.min(Math.max((displayedSeconds + 4) * 1000, 9000), 20000);

    fireEvent.click(within(controls).getByRole('button', { name: 'Start' }));

    await waitFor(() => {
      expect(screen.getByTestId('endgame-celebration-modal')).toBeInTheDocument();
    }, { timeout: waitMs });

    expect(screen.queryByText(/Template Library/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Game time expired\. Continue or end the game\./i)).not.toBeInTheDocument();
  };

  it('auto-ends single player quick timed game when session timer expires', async () => {
    await setupQuickTimedGame('1 Player');
    await assertAutoEndsWithoutPrompt();
  }, 30000);

  it('auto-ends two player quick timed game when session timer expires', async () => {
    await setupQuickTimedGame('2 Players');
    await assertAutoEndsWithoutPrompt();
  }, 30000);

  it('uses custom applied timer duration after save/load/launch in runtime scoreboard', async () => {
    await setupQuickTimedGameWithCustomDuration('2 Players', 17);
    expect(getDisplayedSessionSeconds()).toBe(17);
  }, 30000);

  it('falls back to 10 seconds only when no custom duration is saved', async () => {
    await setupQuickTimedGameWithDefaultDuration('1 Player');
    expect(getDisplayedSessionSeconds()).toBe(10);
  }, 30000);
});

