import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

window.scrollTo = vi.fn();
window.confirm = vi.fn(() => true);

describe('Director Stats Dashboard', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  const setupAndStartGame = async () => {
    const token = await authService.bootstrapMasterAdmin('admin');
    await authService.login('admin', token);
    render(<App />);
    
    // Create Show
    await waitFor(() => screen.getByText(/Select Production/i));
    fireEvent.change(screen.getByPlaceholderText(/New Show Title/i), { target: { value: 'Stats Test' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    
    // Create Template
    await waitFor(() => screen.getByText(/Template Library/i));
    fireEvent.click(screen.getByRole('button', { name: /^Create Template$/i }));
    await waitFor(() => screen.getByPlaceholderText(/e.g. Science Night 2024/i));
    fireEvent.change(screen.getByPlaceholderText(/e.g. Science Night 2024/i), { target: { value: 'Stats Game' } });
    fireEvent.click(screen.getByText(/Start Manual Studio Building/i));
    
    await waitFor(() => screen.getByText(/Save/i));
    fireEvent.click(screen.getByText(/Save/i));
    
    await waitFor(() => screen.getByText(/Play Show/i));
    fireEvent.click(screen.getByText(/Play Show/i));
    
    await waitFor(() => screen.getByText(/End Show/i));
  };

  test('Director Logs & Audit view is accessible and shows history panel', async () => {
    await setupAndStartGame();

    // Open Director and Logs tab
    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    await waitFor(() => screen.getByText(/Logs & Audit/i, { selector: 'button' }));
    fireEvent.click(screen.getByText(/Logs & Audit/i, { selector: 'button' }));

    await waitFor(() => expect(screen.getByTestId('full-history-log-list')).toBeInTheDocument());
    expect(screen.getByTestId('audit-log-list')).toBeInTheDocument();
  });

  test('Logs & Audit updates in real-time when tiles are played', async () => {
    await setupAndStartGame();

    // Play a tile
    fireEvent.click(screen.getAllByText('100')[0]);
    await waitFor(() => screen.getByTitle(/Reveal Answer/i));
    fireEvent.click(screen.getByTitle(/Reveal Answer/i));
    await waitFor(() => screen.getByTitle(/Award \(ENTER\)/i));
    fireEvent.click(screen.getByTitle(/Award \(ENTER\)/i));

    // Open Director and Logs
    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    fireEvent.click(screen.getByText(/Logs & Audit/i, { selector: 'button' }));

    await waitFor(() => {
      const history = screen.getByTestId('full-history-log-list');
      expect(history.textContent || '').toMatch(/session started|stepped up|points awarded|question countdown/i);
    });
  });

  test('Privacy: Logs view does not leak tile coordinate-style internals', async () => {
    await setupAndStartGame();

    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    fireEvent.click(screen.getByText(/Logs & Audit/i, { selector: 'button' }));

    const bodyText = document.body.textContent || '';
    expect(bodyText).not.toContain(' A1 ');
    expect(bodyText).not.toContain(' B1 ');
  });
});



