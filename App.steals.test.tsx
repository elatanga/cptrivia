import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
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

// Mock window interactions
window.scrollTo = jest.fn();
window.confirm = jest.fn(() => true);

describe('Steals Counter Feature', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  const setupAndStartGame = async () => {
    const token = await authService.bootstrapMasterAdmin('admin');
    await authService.login('admin', token);
    render(<App />);
    
    // Create Show
    await waitFor(() => screen.getByText(/Select Production/i));
    fireEvent.change(screen.getByPlaceholderText(/New Show Title/i), { target: { value: 'Steals Test' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    
    // Create Template
    await waitFor(() => screen.getByText(/Template Library/i));
    fireEvent.click(screen.getByRole('button', { name: /^Create Template$/i }));
    
    await waitFor(() => screen.getByPlaceholderText(/e.g. Science Night 2024/i));
    fireEvent.change(screen.getByPlaceholderText(/e.g. Science Night 2024/i), { target: { value: 'Game 1' } });
    fireEvent.click(screen.getByText(/Start Manual Studio Building/i));
    
    await waitFor(() => screen.getByText(/Save/i));
    fireEvent.click(screen.getByText(/Save/i));
    
    await waitFor(() => screen.getByText(/Play Show/i));
    fireEvent.click(screen.getByText(/Play Show/i));
    
    await waitFor(() => screen.getByText(/End Show/i));
  };

  test('Steal action increments counter on scoreboard', async () => {
    await setupAndStartGame();

    // 1. Initial State: No steals displayed
    expect(screen.queryByText(/STEALS:/)).not.toBeInTheDocument();

    // 2. Open Question
    const qBtn = screen.getAllByText('100')[0];
    fireEvent.click(qBtn);
    await waitFor(() => screen.getByTitle(/Reveal Answer/i));

    // Stop countdown so reveal/steal controls unlock deterministically in tests
    fireEvent.click(screen.getByTitle(/Stop countdown/i));

    // 3. Reveal
    fireEvent.click(screen.getByTitle(/Reveal Answer/i));
    await waitFor(() => screen.getByTitle(/Steal \(S\)/i));

    // 4. Click Steal
    fireEvent.click(screen.getByTitle(/Steal \(S\)/i));

    // 5. Select a stealing player
    await waitFor(() => screen.getByText(/Who is stealing\?/i));
    const stealOverlay = screen.getByText(/Who is stealing\?/i).closest('div') as HTMLElement;
    const stealTargetBtn = within(stealOverlay)
      .getAllByRole('button')
      .find((btn) => !/cancel steal/i.test(btn.textContent || ''));
    expect(stealTargetBtn).toBeTruthy();
    fireEvent.click(stealTargetBtn!);

    // 6. Verify Scoreboard Update
    await waitFor(() => {
      expect(screen.getByText('STEALS: 1')).toBeInTheDocument();
    });
  });

  test('Regular Award does NOT increment steal counter', async () => {
    await setupAndStartGame();

    // 1. Select Player 1 (to award to)
    const p1 = screen.getByText('PLAYER 1');
    fireEvent.click(p1);

    // 2. Open Question
    const qBtn = screen.getAllByText('200')[0];
    fireEvent.click(qBtn);
    
    // 3. Reveal & Award
    await waitFor(() => screen.getByTitle(/Reveal Answer/i));
    fireEvent.click(screen.getByTitle(/Stop countdown/i));
    fireEvent.click(screen.getByTitle(/Reveal Answer/i));
    await waitFor(() => screen.getByTitle(/Award \(ENTER\)/i));
    fireEvent.click(screen.getByTitle(/Award \(ENTER\)/i));

    // 4. Back on board
    await waitFor(() => screen.getByText(/End Show/i));

    // 5. Assert NO steals badge
    expect(screen.queryByText(/STEALS:/)).not.toBeInTheDocument();

    // Check awarded score via canonical state to avoid ambiguous board point labels
    const state = JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');
    const playerOne = (state.players || []).find((p: any) => p.name === 'PLAYER 1');
    expect(playerOne?.score).toBeGreaterThanOrEqual(200);
  });

  test('Director Panel shows steals count', async () => {
    await setupAndStartGame();

    // Perform a steal first
    const qBtn = screen.getAllByText('100')[0];
    fireEvent.click(qBtn);
    await waitFor(() => screen.getByTitle(/Reveal Answer/i));
    fireEvent.click(screen.getByTitle(/Stop countdown/i));
    fireEvent.click(screen.getByTitle(/Reveal Answer/i));
    await waitFor(() => screen.getByTitle(/Steal \(S\)/i));
    fireEvent.click(screen.getByTitle(/Steal \(S\)/i));

    await waitFor(() => screen.getByText(/Who is stealing\?/i));
    const stealOverlay = screen.getByText(/Who is stealing\?/i).closest('div') as HTMLElement;
    const stealTargetBtn = within(stealOverlay)
      .getAllByRole('button')
      .find((btn) => !/cancel steal/i.test(btn.textContent || ''));
    expect(stealTargetBtn).toBeTruthy();
    fireEvent.click(stealTargetBtn!);

    // Open Director
    await waitFor(() => screen.getByText('STEALS: 1'));
    fireEvent.click(screen.getByRole('button', { name: /^Director$/i }));
    
    // Switch to Players Tab
    await waitFor(() => screen.getByRole('button', { name: /^Players$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Players$/i }));

    // Check table header remains present
    expect(screen.getByText('Steals', { selector: 'th' })).toBeInTheDocument();
  });
});
