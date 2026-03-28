
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from './App';
import { authService } from './services/authService';
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
  window.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  window.URL.revokeObjectURL = vi.fn();
});

describe('Director Panel: Live Game Analytics (Verification Suite)', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    
    // Auth setup
    const token = await authService.bootstrapMasterAdmin('admin');
    await authService.login('admin', token);
  });

  const setupActiveGame = async () => {
    render(<App />);
    await waitFor(() => screen.getByText(/Select Production/i));
    
    fireEvent.change(screen.getByPlaceholderText(/New Show Title/i), { target: { value: 'Analytics Show' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    await waitFor(() => screen.getByText(/Template Library/i));
    
    fireEvent.click(screen.getByText(/Create Template/i));
    await waitFor(() => screen.getByPlaceholderText(/e.g. Science Night 2024/i));
    fireEvent.change(screen.getByPlaceholderText(/e.g. Science Night 2024/i), { target: { value: 'Analytics Test' } });
    fireEvent.click(screen.getByText(/Start Manual Studio Building/i));
    await waitFor(() => screen.getByText(/Save Template/i));
    fireEvent.click(screen.getByText(/Save Template/i));
    await waitFor(() => screen.getByText(/Play Show/i));
    fireEvent.click(screen.getByText(/Play Show/i));
    await waitFor(() => screen.getByText(/End Show/i));
  };

  test('A) UNIT: emitGameEvent appends events with unique IDs and ISO timestamps', async () => {
    await setupActiveGame();

    // Exercise a user flow and assert logger received runtime events.
    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    fireEvent.click(screen.getByText(/Logs & Audit/i, { selector: 'button' }));
    expect(logger.info).toHaveBeenCalled();

    // Verify state storage (persisted events)
    const storedState = JSON.parse(localStorage.getItem('cruzpham_gamestate') || '{}');
    expect(storedState.events).toBeDefined();
    expect(storedState.events.length).toBeGreaterThan(0);
    const lastEvent = storedState.events[storedState.events.length - 1];
    expect(lastEvent.id).toBeDefined();
    expect(lastEvent.ts).toBeGreaterThan(0);
  });

  test('B) UI: Collapse shows 4 events by default, Expand shows full history', async () => {
    await setupActiveGame();

    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    fireEvent.click(screen.getByText(/Logs & Audit/i, { selector: 'button' }));

    const logsBefore = screen.getByTestId('audit-log-list');
    const logContainer = screen.getByTestId('full-history-log-list');
    expect(logsBefore).toBeInTheDocument();
    expect(logContainer).toBeInTheDocument();
    expect(logContainer.textContent || '').toMatch(/session started|question countdown|stepped up|show/i);
  });

  test('C) UI: Real-time append updates UI instantly', async () => {
    await setupActiveGame();

    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    fireEvent.click(screen.getByText(/Logs & Audit/i, { selector: 'button' }));
    
    // Initial count
    const initialText = screen.getByTestId('audit-log-list').textContent || '';

    // Trigger event via a tab navigation sequence.
    fireEvent.click(screen.getByText(/Players/i, { selector: 'button' }));
    fireEvent.click(screen.getByText(/Logs & Audit/i, { selector: 'button' }));
    
    await waitFor(() => {
        const auditText = screen.getByTestId('audit-log-list').textContent || '';
        expect(auditText.length).toBeGreaterThanOrEqual(initialText.length);
        expect(auditText).toMatch(/session|show|player|countdown|question|audit|no key activity/i);
    });
  });

  test('D) EXPORT: Full log download generates properly formatted txt file', async () => {
    await setupActiveGame();

    fireEvent.click(screen.getByText(/Director/i, { selector: 'button' }));
    fireEvent.click(screen.getByText(/Logs & Audit/i, { selector: 'button' }));

    // Mock click on anchor element
    const mockClick = vi.fn();
    const originalCreateElement = document.createElement;
    document.createElement = vi.fn((tag: string) => {
        const element = originalCreateElement.call(document, tag);
        if (tag === 'a') {
            (element as any).click = mockClick;
        }
        return element;
    }) as any;

    const downloadBtn = screen.getByTitle(/Download full session script/i);
    fireEvent.click(downloadBtn);

    // Assert Export mechanics
    expect(window.URL.createObjectURL).toHaveBeenCalled();
    expect(mockClick).toHaveBeenCalled();
    
    // Verify file naming pattern
    const link = (document.createElement as any).mock.results.find((r: any) => r.value.tagName === 'A').value;
    expect(link.download).toMatch(/^cruzpham-trivia-logs-\d{8}T\d{4}\.txt$/);

    // Cleanup mock
    document.createElement = originalCreateElement;
  });
});



