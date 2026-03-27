import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

window.scrollTo = jest.fn();
window.confirm = jest.fn(() => true);

describe('Director Panel: Add Player Feature', () => {
  beforeEach(() => {
    localStorage.clear();
    jest.clearAllMocks();
  });

  const setupAndStartGame = async (playerCount = 4) => {
    const token = await authService.bootstrapMasterAdmin('admin');
    await authService.login('admin', token);
    render(<App />);
    
    // Create Show
    await waitFor(() => screen.getByText(/Select Production/i));
    fireEvent.change(screen.getByPlaceholderText(/New Show Title/i), { target: { value: 'Add Player Test' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    
    // Create Template
    await waitFor(() => screen.getByText(/Template Library/i));
    fireEvent.click(screen.getByRole('button', { name: /^Create Template$/i }));
    await waitFor(() => screen.getByPlaceholderText(/e.g. Science Night 2024/i));
    
    fireEvent.change(screen.getByPlaceholderText(/e.g. Science Night 2024/i), { target: { value: 'Add Game' } });
    
    // Adjust player count if needed (default is 4)
    // Rows and columns logic...
    
    fireEvent.click(screen.getByText(/Start Manual Studio Building/i));
    await waitFor(() => screen.getByRole('button', { name: /Save Template/i }));
    fireEvent.click(screen.getByRole('button', { name: /Save Template/i }));
    await waitFor(() => screen.getByText(/Play Show/i));
    fireEvent.click(screen.getByText(/Play Show/i));
    await waitFor(() => screen.getByText(/End Show/i));
  };

  test('Director can add a new player successfully', async () => {
    await setupAndStartGame(2); // Start with some players

    // 1. Open Director & Players Tab
    fireEvent.click(screen.getByRole('button', { name: /^Director$/i }));
    await waitFor(() => screen.getByRole('button', { name: /^Players$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Players$/i }));

    // 2. Click Add Player
    fireEvent.click(screen.getByRole('button', { name: /^Add Player$/i }));

    // 3. Fill Name
    const input = screen.getByPlaceholderText(/ENTER PLAYER NAME/i);
    fireEvent.change(input, { target: { value: 'New Contestant' } });
    
    // 4. Submit via the green check action in add-player row
    const confirmBtn = input.parentElement?.querySelector('.check-icon')?.closest('button');
    expect(confirmBtn).toBeTruthy();
    fireEvent.click(confirmBtn!);

    // 5. Verify UI (names are normalized to uppercase)
    await waitFor(() => {
      expect(screen.getByDisplayValue('NEW CONTESTANT')).toBeInTheDocument();
    });

    // 6. Verify Scoreboard
    fireEvent.click(screen.getByRole('button', { name: /^Close$/i }));
    await waitFor(() => {
      expect(screen.getByText('NEW CONTESTANT')).toBeInTheDocument();
    });
  });

  test('Director cannot add more than 8 players', async () => {
    // Start with 7 players to quickly reach limit
    // (Simulated by starting game and adding manually)
    await setupAndStartGame();
    
    fireEvent.click(screen.getByRole('button', { name: /^Director$/i }));
    await waitFor(() => screen.getByRole('button', { name: /^Players$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Players$/i }));

    // Add until 8
    const addPlayerToLimit = async (name: string) => {
        fireEvent.click(screen.getByRole('button', { name: /^Add Player$/i }));
        const input = screen.getByPlaceholderText(/ENTER PLAYER NAME/i);
        fireEvent.change(input, { target: { value: name } });
        const confirmBtn = input.parentElement?.querySelector('.check-icon')?.closest('button');
        expect(confirmBtn).toBeTruthy();
        fireEvent.click(confirmBtn!);
        await waitFor(() => expect(screen.queryByPlaceholderText(/ENTER PLAYER NAME/i)).not.toBeInTheDocument());
    };

    // Assuming 4 default players from setupAndStartGame
    await addPlayerToLimit('P5');
    await addPlayerToLimit('P6');
    await addPlayerToLimit('P7');
    await addPlayerToLimit('P8');

    // Button should be disabled now
    const addBtn = screen.getByRole('button', { name: /^Add Player$/i });
    expect(addBtn).toBeDisabled();
  });

  test('Adding duplicate names preserves normalized values in state', async () => {
    await setupAndStartGame();

    fireEvent.click(screen.getByRole('button', { name: /^Director$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Players$/i }));

    // PLAYER 1 already exists
    fireEvent.click(screen.getByRole('button', { name: /^Add Player$/i }));
    const input = screen.getByPlaceholderText(/ENTER PLAYER NAME/i);
    fireEvent.change(input, { target: { value: 'Player 1' } });
    const confirmBtn = input.parentElement?.querySelector('.check-icon')?.closest('button');
    expect(confirmBtn).toBeTruthy();
    fireEvent.click(confirmBtn!);

    await waitFor(() => {
      const state = JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');
      const matchingPlayers = (state.players || []).filter((p: any) => p.name === 'PLAYER 1');
      expect(matchingPlayers.length).toBeGreaterThanOrEqual(2);
    });
  });
});

