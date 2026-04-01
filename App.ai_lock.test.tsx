
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from './App';
import { authService } from './services/authService';
import * as geminiService from './services/geminiService';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// --- TYPE DECLARATIONS ---
// --- MOCKS ---

vi.mock('./services/logger', () => ({
  logger: { 
    info: vi.fn(), 
    error: vi.fn(), 
    warn: vi.fn(), 
    getCorrelationId: () => 'test-id', 
    maskPII: (v:any) => v 
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

vi.mock('./services/geminiService', async () => {
  const actual = await vi.importActual<any>('./services/geminiService');
  return {
    ...actual,
    generateTriviaGame: vi.fn(),
    generateSingleQuestion: vi.fn().mockResolvedValue({ text: 'AI Q', answer: 'AI A' }),
    getGeminiConfigHealth: vi.fn().mockReturnValue({
      isConfigured: true,
      configured: true,
      hasApiKey: true,
      model: 'test-model',
      reason: null,
    }),
  };
});

const mockGenerateTriviaGame = vi.spyOn(geminiService, 'generateTriviaGame');

describe('AI Generation Locks & Atomic Updates', () => {
  beforeEach(async () => {
    localStorage.clear();
    vi.clearAllMocks();
    
    const token = await authService.bootstrapMasterAdmin('admin');
    await authService.login('admin', token);
  });

  const setupBuilder = async () => {
    render(<App />);
    await waitFor(() => screen.getByText(/Select Production/i));
    
    fireEvent.change(screen.getByPlaceholderText(/New Show Title/i), { target: { value: 'AI Lock Test' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    await waitFor(() => screen.getByText(/Template Library/i));
    
    fireEvent.click(screen.getByText(/Create Template/i));
    await waitFor(() => screen.getByPlaceholderText(/e\.g\. Science Night 2024/i));
    
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. Science Night 2024/i), { target: { value: 'AI Test Board' } });
  };

  test('UI Locks user mutations while allowing internal AI apply', async () => {
    await setupBuilder();
    
    let resolveGen: (value: any) => void;
    const genPromise = new Promise((resolve) => { resolveGen = resolve; });
    mockGenerateTriviaGame.mockReturnValue(genPromise);

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. 90s Pop Culture/i), { target: { value: 'Science' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Complete Board/i }));

    await waitFor(() => expect(screen.getByText(/AI Studio Working/i)).toBeInTheDocument());
    
    // Ensure generation overlay is active while request is in-flight.
    const titleInput = screen.getByDisplayValue('AI Test Board') as HTMLInputElement;
    expect(titleInput).toBeInTheDocument();

    const mockResult = [
      { id: 'cat-1', title: 'Physics', questions: [{ id: 'q-1', text: 'Gravity?', answer: 'Yes', points: 100, isRevealed: false, isAnswered: false, isDoubleOrNothing: false }] }
    ];
    
    await act(async () => {
      resolveGen!(mockResult);
    });

    await waitFor(() => expect(screen.queryByText(/AI Studio Working/i)).not.toBeInTheDocument());
    expect(screen.getByText(/Live Builder Preview/i)).toBeInTheDocument();
    expect(titleInput).toBeInTheDocument();
  });

  test('Stale generation results are discarded via currentGenIdRef', async () => {
    await setupBuilder();
    
    let resolveA: (value: any) => void;
    const promiseA = new Promise((resolve) => { resolveA = resolve; });
    
    let resolveB: (value: any) => void;
    const promiseB = new Promise((resolve) => { resolveB = resolve; });

    mockGenerateTriviaGame.mockReturnValueOnce(promiseA);
    fireEvent.change(screen.getByPlaceholderText(/e\.g\. 90s Pop Culture/i), { target: { value: 'Biology' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Complete Board/i }));
    
    await waitFor(() => expect(screen.getByText(/AI Studio Working/i)).toBeInTheDocument());

    mockGenerateTriviaGame.mockReturnValueOnce(promiseB);
    
    await act(async () => {
      resolveA!([{ id: 'old', title: 'Old Cat', questions: [] }]);
    });

    expect(screen.queryByText('Old Cat')).not.toBeInTheDocument();
    
    await act(async () => {
      resolveB!([{ id: 'new', title: 'New Cat', questions: [] }]);
    });
    
    await waitFor(() => expect(screen.queryByText(/AI Studio Working/i)).not.toBeInTheDocument());
  });

  test('Parser robustness: extracts JSON from markdown', async () => {
    await setupBuilder();
    
    const markdownResponse = "Here is your JSON: \n```json\n[{\n  \"categoryName\": \"Markdown Cat\",\n  \"questions\": []\n}]\n```";
    mockGenerateTriviaGame.mockResolvedValueOnce([
        { id: 'cat-md', title: 'Markdown Cat', questions: [] }
    ]);

    fireEvent.change(screen.getByPlaceholderText(/e\.g\. 90s Pop Culture/i), { target: { value: 'Markdown' } });
    fireEvent.click(screen.getByRole('button', { name: /Generate Complete Board/i }));

    await waitFor(() => expect(screen.queryByText(/AI Studio Working/i)).not.toBeInTheDocument());
    expect(screen.queryByText(/AI Studio Working/i)).not.toBeInTheDocument();
  });

  test('Rollback on failure restores snapshot', async () => {
    await setupBuilder();
    
    fireEvent.click(screen.getByText(/Start Manual Studio Building/i));
    await waitFor(() => screen.getByDisplayValue('Category 1'));
    
    let rejectGen: (error: any) => void;
    const genPromise = new Promise((_, reject) => { rejectGen = reject; });
    mockGenerateTriviaGame.mockReturnValue(genPromise);
    
    fireEvent.change(screen.getByPlaceholderText(/Enter board topic/i), { target: { value: 'Failure' } });
    fireEvent.click(screen.getByRole('button', { name: /Re-populate All/i }));
    
    await waitFor(() => expect(screen.getByText(/AI Studio Working/i)).toBeInTheDocument());
    
    await act(async () => {
      rejectGen!(new Error('AI Crashed'));
    });
    
    await waitFor(() => expect(screen.queryByText(/AI Studio Working/i)).not.toBeInTheDocument());
    expect(screen.getByText(/Live Builder Preview/i)).toBeInTheDocument();
  });
});




