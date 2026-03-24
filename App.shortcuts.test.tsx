import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App from './App';
import { authService } from './services/authService';
import { soundService } from './services/soundService';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// --- MOCKS ---

// Mock Logger
vi.mock('./services/logger', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), getCorrelationId: () => 'test-id', maskPII: (v:any) => v }
}));

// Mock SoundService
vi.mock('./services/soundService', () => ({
  soundService: {
    playSelect: vi.fn(), playReveal: vi.fn(), playAward: vi.fn(),
    playSteal: vi.fn(), playVoid: vi.fn(), playDoubleOrNothing: vi.fn(),
    playClick: vi.fn(), playTimerTick: vi.fn(), playTimerAlarm: vi.fn(),
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

// Mock window.confirm
const originalConfirm = window.confirm;
const mockConfirm = vi.fn();

describe('CRUZPHAM TRIVIA - Shortcuts & Styling Tests', () => {
  beforeAll(() => {
    window.confirm = mockConfirm;
    // Mock ScrollTo
    window.scrollTo = vi.fn();
  });

  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    mockConfirm.mockReturnValue(true); // Default Yes
  });

  const setupAuthenticatedApp = async () => {
    // 1. Bootstrap
    const token = await authService.bootstrapMasterAdmin('admin');
    // 2. Login
    const loginRes = await authService.login('admin', token);
    localStorage.setItem('cruzpham_active_session_id', loginRes.session!.id);
    
    // 3. Render
    const utils = render(<App />);
    
    // 4. Wait for Dashboard
    await waitFor(() => screen.getByText(/Select Production/i));
    
    return utils;
  };

  const createAndPlayShow = async () => {
    // Create Show
    const titleInput = screen.getByPlaceholderText(/New Show Title/i);
    fireEvent.change(titleInput, { target: { value: 'Test Show' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    
    await waitFor(() => screen.getByText(/Template Library/i));
    
    // Create Template
    fireEvent.click(screen.getByText(/Create Template/i));
    await waitFor(() => screen.getByPlaceholderText(/e.g. Science Night 2024/i));
    
    const templateTitle = screen.getByPlaceholderText(/e.g. Science Night 2024/i);
    fireEvent.change(templateTitle, { target: { value: 'Test Template' } });
    
    fireEvent.click(screen.getByText(/Start Manual Studio Building/i));
    
    // Save
    await waitFor(() => screen.getByText(/Save/i));
    fireEvent.click(screen.getByText(/Save/i));
    
    // Play
    await waitFor(() => screen.getByText(/Play Show/i));
    fireEvent.click(screen.getByText(/Play Show/i));
    
    // Wait for Board
    await waitFor(() => screen.getByText(/End Show/i));
  };

  test('1) Board View Settings: Director scaling control can be selected', async () => {
    await setupAuthenticatedApp();
    await createAndPlayShow();

    // Switch to Director
    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    await waitFor(() => screen.getByText(/Settings/i, { selector: 'button' }));
    fireEvent.click(screen.getByText(/Settings/i, { selector: 'button' }));

    // Change Font Scale to XL (Scale 1.35)
    const scaleXL = screen.getAllByText('XL')[0];
    fireEvent.click(scaleXL);

    // Switch back to Board
    fireEvent.click(screen.getByText(/^Board$/i, { selector: 'button' }));
    await waitFor(() => screen.getByText(/End Show/i));
  });

  test('2) Reveal Answer Styling: Roboto font and full-screen classes applied', async () => {
    await setupAuthenticatedApp();
    await createAndPlayShow();

    // Open a question
    const qBtn = screen.getAllByText('100')[0];
    fireEvent.click(qBtn);
    
    await waitFor(() => screen.getByTitle(/Reveal Answer/i));
    
    const modalRoot = screen.getByTitle(/Reveal Answer/i).closest('.fixed');
    expect(modalRoot).toHaveClass('font-roboto');
    expect(modalRoot).toHaveClass('inset-0');
  });

  test('3) Reveal Answer Logic: Buttons locked until reveal', async () => {
    await setupAuthenticatedApp();
    await createAndPlayShow();

    // Open a question
    const qBtn = screen.getAllByText('100')[0];
    fireEvent.click(qBtn);
    
    await waitFor(() => screen.getByTitle(/Reveal Answer/i));
    
    const stealBeforeReveal = screen.getByTitle(/Steal \(S\)/i);
    expect(stealBeforeReveal).toBeDisabled();
    
    // Reveal controls remain mounted and accessible while countdown is active.
    // The current UX keeps these actions disabled until timer/reveal conditions are met.
    expect(screen.getByTitle(/Award \(ENTER\)/i)).toBeInTheDocument();
    expect(screen.getByTitle(/Steal \(S\)/i)).toBeInTheDocument();
  });

  test('4) Arrow Shortcuts: Player Selection works', async () => {
    await setupAuthenticatedApp();
    await createAndPlayShow();

    fireEvent.keyDown(window, { code: 'ArrowDown', key: 'ArrowDown' });
    expect(soundService.playSelect).toHaveBeenCalled();
  });
});


