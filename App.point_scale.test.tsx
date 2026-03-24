import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import App from './App';
import { authService } from './services/authService';
import { dataService } from './services/dataService';
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

// Mock Window features
beforeAll(() => {
  window.scrollTo = vi.fn();
  window.confirm = vi.fn(() => true);
  window.alert = vi.fn();
  window.URL.createObjectURL = vi.fn(() => 'blob:mock-url');
  window.URL.revokeObjectURL = vi.fn();
});

describe('CRUZPHAM TRIVIA - Point Scale Tests', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  const setupAuthenticatedApp = async () => {
    const token = await authService.bootstrapMasterAdmin('admin');
    await authService.login('admin', token);
    const utils = render(<App />);
    
    // Create Show
    await waitFor(() => screen.getByText(/Select Production/i));
    fireEvent.change(screen.getByPlaceholderText(/New Show Title/i), { target: { value: 'Scale Test Show' } });
    fireEvent.click(screen.getByRole('button', { name: /^Create$/i }));
    await waitFor(() => screen.getByText(/Template Library/i));
    
    return utils;
  };

  test('1) Unit: Point Generation - Scale Logic & Constraints', async () => {
    await setupAuthenticatedApp();

    // Open Template Creator
    fireEvent.click(screen.getByRole('button', { name: /^Create Template$/i }));
    await waitFor(() => screen.getByPlaceholderText(/e.g. Science Night 2024/i));
    
    // 1a. Test Scale = 10
    fireEvent.click(screen.getByText('10', { selector: 'button' }));
    
    // Verify Range Text Update
    expect(screen.getByText(/Range: 10 - 50/i)).toBeInTheDocument(); // Default 5 rows
    
    // 1b. Test Scale = 25
    fireEvent.click(screen.getByText('25', { selector: 'button' }));
    expect(screen.getByText(/Range: 25 - 125/i)).toBeInTheDocument();

    // 1c. Test Scale = 50
    fireEvent.click(screen.getByText('50', { selector: 'button' }));
    expect(screen.getByText(/Range: 50 - 250/i)).toBeInTheDocument();

    // 1d. Test Row Constraint (Max 10)
    // Click '+' on Rows until max (starting at 5, need 5 more clicks)
    // Based on TemplateBuilder.tsx order: Categories is first +, Rows is second.
    const rowPlus = screen.getAllByRole('button').filter(b => b.querySelector('svg.lucide-plus'))[1];
    for(let i=0; i<5; i++) fireEvent.click(rowPlus);
    
    // Verify range updates for 10 rows with 50 increment
    expect(screen.getByText(/Range: 50 - 500/i)).toBeInTheDocument();
    
    // Set Scale 20
    fireEvent.click(screen.getByText('20', { selector: 'button' }));
    
    // Enter Title
    fireEvent.change(screen.getByPlaceholderText(/e.g. Science Night 2024/i), { target: { value: 'Scale 20 Test' } });
    
    // Create
    fireEvent.click(screen.getByRole('button', { name: /Start Manual Studio Building/i }));
    
    // Check Board Values: 20, 40, 60, 80, 100, 120, 140, 160, 180, 200 (10 rows)
    await waitFor(() => expect(screen.getAllByText('20').length).toBeGreaterThan(0));
    expect(screen.getAllByText('200').length).toBeGreaterThan(0);
  });

  test('2) Unit: Backward Compatibility - Legacy Template Defaults', async () => {
    // Inject legacy template (no pointScale)
    const legacyTemplate = {
      id: 'legacy-1',
      showId: 'show-1',
      topic: 'Legacy Game',
      config: { 
        playerCount: 2, 
        categoryCount: 2, 
        rowCount: 3 
        // Missing pointScale
      },
      categories: [
        {
           id: 'c1', title: 'Cat 1', 
           questions: [
             { id: 'q1', points: 100, text: 'Q1', answer: 'A1', isRevealed: false, isAnswered: false },
             { id: 'q2', points: 200, text: 'Q2', answer: 'A2', isRevealed: false, isAnswered: false },
             { id: 'q3', points: 300, text: 'Q3', answer: 'A3', isRevealed: false, isAnswered: false }
           ]
        }
      ],
      createdAt: new Date().toISOString()
    };
    
    const show = { id: 'show-1', userId: 'admin', title: 'Legacy Show', createdAt: new Date().toISOString() };
    
    localStorage.setItem('cruzpham_db_shows', JSON.stringify([show]));
    localStorage.setItem('cruzpham_db_templates', JSON.stringify([legacyTemplate]));
    
    // Boot App
    const token = await authService.bootstrapMasterAdmin('admin');
    await authService.login('admin', token);
    render(<App />);
    
    await waitFor(() => screen.getByText('Legacy Show'));
    fireEvent.click(screen.getByText('Legacy Show'));
    
    // Check Dashboard
    await waitFor(() => screen.getByText('Legacy Game'));
    
    fireEvent.click(screen.getByText('Play Show'));
    
    await waitFor(() => screen.getByText(/End Show/i));
    
    // Verify points rendered correctly
    expect(screen.getAllByText('100').length).toBeGreaterThan(0);
    expect(screen.getAllByText('200').length).toBeGreaterThan(0);
    expect(screen.getAllByText('300').length).toBeGreaterThan(0);
  });

  test('3) Integration: Template Creation with Scale 50', async () => {
    await setupAuthenticatedApp();

    fireEvent.click(screen.getByRole('button', { name: /^Create Template$/i }));
    await waitFor(() => screen.getByText(/Configuration/i));

    fireEvent.change(screen.getByPlaceholderText(/e.g. Science Night 2024/i), { target: { value: 'Fifty Scale' } });
    fireEvent.click(screen.getByText('50', { selector: 'button' }));
    
    fireEvent.click(screen.getByText(/Start Manual Studio Building/i));
    
    await waitFor(() => screen.getByRole('button', { name: /save/i }));
    
    // Check points
    expect(screen.getAllByText('50').length).toBeGreaterThan(0);
    expect(screen.getAllByText('100').length).toBeGreaterThan(0);
    expect(screen.getAllByText('150').length).toBeGreaterThan(0);
    expect(screen.getAllByText('200').length).toBeGreaterThan(0);
    expect(screen.getAllByText('250').length).toBeGreaterThan(0);

    // Save
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => screen.getByText('Template saved successfully.'));
  });

  test('4) Integration: Upload preserves pointScale of 50', async () => {
    await setupAuthenticatedApp();
    
    const templateWithScale50 = {
      id: 't-scale-50',
      showId: (JSON.parse(localStorage.getItem('cruzpham_db_shows') || '[]')[0] || {}).id,
      topic: 'Scale 50 Import',
      config: { playerCount: 2, categoryCount: 1, rowCount: 2, pointScale: 50 },
      categories: [{
        id: 'c1', title: 'Trivia',
        questions: [
          { id: 'q1', points: 50, text: '50 pts', answer: 'A', isRevealed: false, isAnswered: false },
          { id: 'q2', points: 100, text: '100 pts', answer: 'B', isRevealed: false, isAnswered: false }
        ]
      }],
      createdAt: new Date().toISOString()
    };

    const shows = JSON.parse(localStorage.getItem('cruzpham_db_shows') || '[]');
    templateWithScale50.showId = shows[0].id;

    const fileContent = JSON.stringify(templateWithScale50);
    
    act(() => {
      dataService.importTemplate(templateWithScale50.showId, fileContent);
    });

    fireEvent.click(screen.getByText(/Switch Show/i));
    fireEvent.click(screen.getByText(/Scale Test Show/i));

    await waitFor(() => screen.getByText('Scale 50 Import (Imported)'));
    
    const playBtns = screen.getAllByText(/Play Show/i);
    fireEvent.click(playBtns[playBtns.length - 1]);

    await waitFor(() => expect(screen.getAllByText('50').length).toBeGreaterThan(0));
    expect(screen.getAllByText('100').length).toBeGreaterThan(0);
  });

  test('5) Smoke: Gameplay with Scale 50', async () => {
    await setupAuthenticatedApp();
    
    fireEvent.click(screen.getByRole('button', { name: /^Create Template$/i }));
    await waitFor(() => screen.getByText(/Configuration/i));
    fireEvent.change(screen.getByPlaceholderText(/e.g. Science Night 2024/i), { target: { value: 'Game 50' } });
    fireEvent.click(screen.getByText('50', { selector: 'button' }));
    fireEvent.click(screen.getByText(/Start Manual Studio Building/i));
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    await waitFor(() => screen.getByRole('button', { name: /play show/i }));
    fireEvent.click(screen.getAllByRole('button', { name: /play show/i }).slice(-1)[0]);

    await waitFor(() => screen.getByText(/End Show/i));
    
    const q50 = screen.getAllByText('50')[0];
    fireEvent.click(q50);
    
    await waitFor(() => screen.getByTitle(/Reveal Answer/i));
    expect(screen.getByTitle(/Reveal Answer/i)).toBeInTheDocument();
  });
});



