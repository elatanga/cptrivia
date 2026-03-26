



import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import { authService } from './services/authService';
import { normalizePlayerName } from './services/utils';

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

describe('Player Name Normalization (Fix Verification)', () => {
  beforeEach(async () => {
    localStorage.clear();
    jest.clearAllMocks();
    
    // Auth setup
    const token = await authService.bootstrapMasterAdmin('admin');
    await authService.login('admin', token);
  });

  const setupActiveGame = async () => {
    render(<App />);
    await waitFor(() => screen.getByText(/Select Production/i));
    
    fireEvent.change(screen.getByPlaceholderText(/New Show Title/i), { target: { value: 'Normalization Show' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    await waitFor(() => screen.getByText(/Template Library/i));
    
    fireEvent.click(screen.getByRole('button', { name: /^Create Template$/i }));
    await waitFor(() => screen.getByPlaceholderText(/e\.g\. Science Night 2024/i));
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Science Night 2024/i), { target: { value: 'Norm Game' } });
    fireEvent.click(screen.getByText(/Start Manual Studio Building/i));
    await waitFor(() => screen.getByTestId('save-template-button'));
    fireEvent.click(screen.getByTestId('save-template-button'));
    await waitFor(() => screen.getByText(/Play Show/i));
    fireEvent.click(screen.getByText(/Play Show/i));
    await waitFor(() => screen.getByText(/End Show/i));
  };

  test('A) UNIT: normalizePlayerName correctly transforms inputs', () => {
    expect(normalizePlayerName('  john  doe ')).toBe('JOHN DOE');
    expect(normalizePlayerName('él')).toBe('ÉL');
    expect(normalizePlayerName('')).toBe('');
    expect(normalizePlayerName('   ')).toBe('');
  });

  test('B) UI: Add Player stores and displays names as UPPERCASE', async () => {
    await setupActiveGame();

    // Open Director -> Players and add a contestant
    fireEvent.click(screen.getByRole('button', { name: /^Director$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Players$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Add Player$/i }));

    const input = screen.getByPlaceholderText(/ENTER PLAYER NAME/i);
    fireEvent.change(input, { target: { value: 'mister el' } });
    const confirmBtn = input.parentElement?.querySelector('.check-icon')?.closest('button');
    expect(confirmBtn).toBeTruthy();
    fireEvent.click(confirmBtn!);

    // Verification
    await waitFor(() => {
      expect(screen.getByDisplayValue('MISTER EL')).toBeInTheDocument();
    });

    // Persistent state check
    const state = JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');
    const p = state.players.find((x: any) => x.name === 'MISTER EL');
    expect(p).toBeDefined();
  });

  test('C) UI: Rename Player in Director stores UPPERCASE', async () => {
    await setupActiveGame();

    // Open Director -> Players
    fireEvent.click(screen.getByRole('button', { name: /^Director$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Players$/i }));

    // Rename existing "PLAYER 1" to "mahfo"
    const input = screen.getByDisplayValue('PLAYER 1');
    fireEvent.change(input, { target: { value: 'mahfo' } });
    
    // Move to another tab to simulate normal operator flow
    fireEvent.click(screen.getByRole('button', { name: /^Board$/i }));

    // Verify board/scoreboard via state
    const state = JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');
    const p = state.players.find((x: any) => x.name === 'MAHFO');
    expect(p).toBeDefined();
    
    // Close director and check display
    fireEvent.click(screen.getByRole('button', { name: /^Close$/i }));
    await waitFor(() => {
      expect(screen.getByText('MAHFO')).toBeInTheDocument();
    });
  });

  test('D) VALIDATION: Empty input shows toast and skips add', async () => {
    await setupActiveGame();

    fireEvent.click(screen.getByRole('button', { name: /^Director$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Players$/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Add Player$/i }));

    const input = screen.getByPlaceholderText(/ENTER PLAYER NAME/i);
    fireEvent.change(input, { target: { value: '   ' } });
    const confirmBtn = input.parentElement?.querySelector('.check-icon')?.closest('button');
    expect(confirmBtn).toBeTruthy();
    fireEvent.click(confirmBtn!);

    await waitFor(() => {
      expect(screen.getByText(/Enter a valid name/i)).toBeInTheDocument();
    });

    // Ensure no new player was added (should still have default 4)
    const state = JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');
    expect(state.players).toHaveLength(4);
  });
});

