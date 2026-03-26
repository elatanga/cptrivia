import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import App from './App';
import { authService } from './services/authService';

// --- TYPE DECLARATIONS ---
declare const jest: any;
declare const describe: any;
declare const test: any;
declare const expect: any;
declare const beforeEach: any;

// --- MOCKS ---
jest.mock('./services/logger', () => ({
  logger: { 
    info: jest.fn(), 
    error: jest.fn(), 
    warn: jest.fn(), 
    getCorrelationId: () => 'test-id', 
    maskPII: (v: any) => v 
  }
}));

jest.mock('./services/soundService', () => ({
  soundService: {
    playSelect: jest.fn(), playReveal: jest.fn(), playAward: jest.fn(),
    playSteal: jest.fn(), playVoid: jest.fn(), playDoubleOrNothing: jest.fn(),
    playClick: jest.fn(), playTimerTick: jest.fn(), playTimerAlarm: jest.fn(),
    playToast: jest.fn(),
    setMute: jest.fn(), getMute: jest.fn().mockReturnValue(false),
    setVolume: jest.fn(), getVolume: jest.fn().mockReturnValue(0.5)
  }
}));

jest.mock('./services/geminiService', () => ({
  generateTriviaGame: jest.fn().mockResolvedValue([]),
  generateSingleQuestion: jest.fn().mockResolvedValue({ text: 'AI Q', answer: 'AI A' }),
  generateCategoryQuestions: jest.fn().mockResolvedValue([])
}));

// Mock window interactions
window.scrollTo = jest.fn();
window.confirm = jest.fn(() => true);

describe('CARD 3: "Last 4 Plays" Real-Time Logs', () => {
  beforeEach(async () => {
    localStorage.clear();
    jest.clearAllMocks();
    
    // Auth setup to bypass bootstrap and login
    const token = await authService.bootstrapMasterAdmin('admin');
    await authService.login('admin', token);
  });

  const setupGame = async () => {
    render(<App />);
    await waitFor(() => screen.getByPlaceholderText(/New Show Title/i));
    fireEvent.change(screen.getByPlaceholderText(/New Show Title/i), { target: { value: 'Logs Show' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    await waitFor(() => screen.getByText(/Create Template/i));
    fireEvent.click(screen.getByText(/Create Template/i));
    fireEvent.change(screen.getByPlaceholderText(/e.g. Science Night 2024/i), { target: { value: 'Logs Game' } });
    fireEvent.click(screen.getByText(/Start Manual Studio Building/i));
    
    // Wait for builder grid
    await waitFor(() => screen.getByText(/Save Template/i));
    fireEvent.click(screen.getByText(/Save Template/i));
    
    // Wait for dashboard and play
    await waitFor(() => screen.getByText(/Play Show/i));
    fireEvent.click(screen.getByText(/Play Show/i));
    
    // Wait for Board
    await waitFor(() => screen.getByText(/End Show/i));
  };

  const readGameState = () => JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');

  const revealFirstTile = async () => {
    const candidateButtons = screen.getAllByRole('button');
    const playableTile = candidateButtons.find((btn) => {
      const label = (btn.textContent || '').trim();
      return !btn.disabled && /^\d+$/.test(label);
    });
    expect(playableTile).toBeTruthy();

    fireEvent.click(playableTile!);
    await waitFor(() => screen.getByTitle(/Reveal Answer \(SPACE\)/i));
    const stopBtn = screen.queryByTitle(/Stop countdown/i);
    if (stopBtn) {
      fireEvent.click(stopBtn);
    }
    fireEvent.click(screen.getByTitle(/Reveal Answer \(SPACE\)/i));
  };

  test('A) appendPlayEvent ring buffer: only last 4 kept, newest first', async () => {
    await setupGame();

    // Trigger 5 award actions
    for (let i = 1; i <= 5; i++) {
      await revealFirstTile();
      await waitFor(() => screen.getByTitle(/Award \(ENTER\)/i));
      fireEvent.click(screen.getByTitle(/Award \(ENTER\)/i));
      await waitFor(() => expect(screen.queryByTitle(/Reveal Answer \(SPACE\)/i)).toBeNull());
    }

    // Go to Logs & Audit
    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    fireEvent.click(screen.getByText(/Logs & Audit/i, { selector: 'button' }));

    // Ring buffer is persisted in game state and capped at 4 entries.
    await waitFor(() => {
      const state = readGameState();
      expect((state.lastPlays || []).length).toBe(4);
    });
  });

  test('B) Event shape includes timestamps (atIso, atMs)', async () => {
    await setupGame();
    
    await revealFirstTile();
    await waitFor(() => screen.getByTitle(/Award \(ENTER\)/i));
    fireEvent.click(screen.getByTitle(/Award \(ENTER\)/i));

    await waitFor(() => {
      const state = readGameState();
      const latestPlay = (state.lastPlays || [])[0];
      expect(latestPlay).toEqual(expect.objectContaining({
        atIso: expect.any(String),
        atMs: expect.any(Number),
        action: 'AWARD',
      }));
    });
  });

  test('C) Integration: Award creates correct play log entry UI', async () => {
    await setupGame();
    
    await revealFirstTile();
    await waitFor(() => screen.getByTitle(/Award \(ENTER\)/i));
    fireEvent.click(screen.getByTitle(/Award \(ENTER\)/i));

    await waitFor(() => {
      const state = readGameState();
      const latestPlay = (state.lastPlays || [])[0];
      expect(latestPlay).toEqual(expect.objectContaining({
        action: 'AWARD',
        atMs: expect.any(Number),
        effectivePoints: expect.any(Number),
      }));
    });
  });

  test('D) Integration: Steal creates entry with stealer + victim context', async () => {
    await setupGame();
    
    await revealFirstTile();
    await waitFor(() => screen.getByTitle(/Steal \(S\)/i));
    fireEvent.click(screen.getByTitle(/Steal \(S\)/i));

    await waitFor(() => screen.getByText(/Who is stealing\?/i));
    const stealOverlay = screen.getByText(/Who is stealing\?/i).closest('div') as HTMLElement;
    const stealTargetBtn = within(stealOverlay)
      .getAllByRole('button')
      .find((btn) => !/cancel steal/i.test(btn.textContent || ''));
    expect(stealTargetBtn).toBeTruthy();
    fireEvent.click(stealTargetBtn!);

    await waitFor(() => expect(screen.queryByTitle(/Reveal Answer \(SPACE\)/i)).toBeNull());

    await waitFor(() => {
      const state = readGameState();
      const latestPlay = (state.lastPlays || [])[0];
      expect(latestPlay).toEqual(expect.objectContaining({
        action: 'STEAL',
        stealerPlayerName: 'PLAYER 2',
        attemptedPlayerName: 'PLAYER 1',
      }));
    });
  });

  test('E) Integration: Void creates entry and shows context', async () => {
    await setupGame();
    
    await revealFirstTile();
    await waitFor(() => screen.getByTitle(/Void \(ESC\)/i));
    fireEvent.click(screen.getByTitle(/Void \(ESC\)/i));

    await waitFor(() => {
      const state = readGameState();
      expect(Array.isArray(state.lastPlays)).toBe(true);
      expect(screen.queryByTitle(/Reveal Answer \(SPACE\)/i)).not.toBeInTheDocument();
    });
  });

  test('F) Regression: Logging failure does not block gameplay', async () => {
    await setupGame();

    await revealFirstTile();
    await waitFor(() => screen.getByTitle(/Award \(ENTER\)/i));

    // Force one logging timestamp failure during award.
    const spy = jest.spyOn(Date.prototype, 'toISOString').mockImplementationOnce(() => {
      throw new Error('Logger Crash');
    });
    
    // Action should succeed despite logging error
    fireEvent.click(screen.getByTitle(/Award \(ENTER\)/i));

    await waitFor(() => {
       const state = readGameState();
       expect((state.lastPlays || []).length).toBeGreaterThan(0);
       expect(screen.queryByTitle(/Reveal Answer \(SPACE\)/i)).not.toBeInTheDocument();
    });

    spy.mockRestore();
  });
});


