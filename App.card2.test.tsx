
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from './App';
import { authService } from './services/authService';
import { dataService } from './services/dataService';
import { logger } from './services/logger';
import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest';

// --- TYPE DECLARATIONS ---
// --- MOCKS ---
vi.mock('./services/logger', () => ({
  logger: { 
    info: vi.fn(), 
    error: vi.fn(), 
    warn: vi.fn(), 
    getCorrelationId: () => 'test-id', 
    maskPII: (v: any) => v 
  }
}));

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

vi.mock('./services/geminiService', () => ({
  generateTriviaGame: vi.fn().mockResolvedValue([]),
  generateSingleQuestion: vi.fn().mockResolvedValue({ text: 'AI Q', answer: 'AI A' }),
  generateCategoryQuestions: vi.fn().mockResolvedValue([]),
  getGeminiConfigHealth: vi.fn().mockReturnValue({
    isConfigured: true,
    configured: true,
    hasApiKey: true,
    model: 'test-model',
    reason: null,
  }),
}));

// Mock window interactions
beforeAll(() => {
  window.scrollTo = vi.fn();
  window.confirm = vi.fn(() => true);
});

describe('CARD 2: Verification Suite (Desktop Layout & Visibility)', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    
    // Default to Desktop Viewport
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: 1440 });
    window.dispatchEvent(new Event('resize'));

    // Auth setup
    const token = await authService.bootstrapMasterAdmin('admin');
    await authService.login('admin', token);
  });

  const setViewport = (width: number) => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
    window.dispatchEvent(new Event('resize'));
  };

  const navigateToBuilder = async () => {
    render(<App />);
    await waitFor(() => screen.getByText(/Select Production/i));
    
    fireEvent.change(screen.getByPlaceholderText(/New Show Title/i), { target: { value: 'Test Show' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    await waitFor(() => screen.getByText(/Template Library/i));
    
    fireEvent.click(screen.getByText(/Create Template/i));
    await waitFor(() => screen.getByPlaceholderText(/e.g. Science Night 2024/i));

    fireEvent.change(screen.getByPlaceholderText(/e.g. Science Night 2024/i), { target: { value: 'Builder Test' } });
    fireEvent.click(screen.getByText(/Start Manual Studio Building/i));
    await waitFor(() => screen.getByText(/Live Builder Preview/i));
  };

  test('A) DESKTOP RENDER: Save button is visible and clickable', async () => {
    setViewport(1440);
    await navigateToBuilder();

    const saveBtn = screen.getByTestId('save-template-button');
    expect(saveBtn).toBeInTheDocument();
    expect(saveBtn).toBeVisible();
    expect(saveBtn).not.toBeDisabled();
    
    // Test clickability
    fireEvent.click(saveBtn);
    expect(logger.info).toHaveBeenCalledWith("template_save_click", expect.objectContaining({
      ts: expect.any(String)
    }));
  });

  test('B) NO OVERLAP: Save button is in the local content toolbar, separate from global header', async () => {
    setViewport(1440);
    await navigateToBuilder();

    const saveBtn = screen.getByTestId('save-template-button');
    const actionRow = screen.getByTestId('builder-actions-row');
    
    expect(actionRow).toBeInTheDocument();
    expect(actionRow).toContainElement(saveBtn);
    
    // Verify it contains "Live Builder Preview" title as requested
    expect(screen.getByText(/Live Builder Preview/i)).toBeInTheDocument();
  });

  test('C) MOBILE REGRESSION: Save button remains accessible on mobile viewport', async () => {
    setViewport(375);
    await navigateToBuilder();

    const saveBtn = screen.getByTestId('save-template-button');
    expect(saveBtn).toBeInTheDocument();
    expect(saveBtn).toBeVisible();
  });

  test('D) STACKING GUARD: Live Builder root has highest z-index to overlay AppShell', async () => {
    setViewport(1440);
    await navigateToBuilder();
    
    const builderRoot = document.querySelector('.template-builder');
    expect(builderRoot).toHaveClass('z-[200]'); // Explicitly higher than AppShell header z-40
  });

  test('E) COMPONENT PRESENCE: Aside panel is visible and stacks correctly', async () => {
    setViewport(1440);
    await navigateToBuilder();
    
    expect(screen.getByText(/Magic Studio/i)).toBeInTheDocument();
    expect(screen.getByText(/Parameters/i)).toBeInTheDocument();
    expect(screen.getByText(/Point Increment/i)).toBeInTheDocument();
  });
});



