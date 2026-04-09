import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TemplateBuilder } from './TemplateBuilder';
import { dataService } from '../services/dataService';
import * as geminiService from '../services/geminiService';

// --- DETERMINISTIC STUBS ---

const mockUUIDs = Array.from({ length: 100 }, (_, i) => `uuid-${i}`);
let uuidIndex = 0;

// Fix: Added global declaration to resolve "Cannot find name 'global'" error in Vitest/JSDOM environment.
declare const global: any;

// Handle environment global safely
const globalObj = typeof global !== 'undefined' ? global : window;

Object.defineProperty(globalObj, 'crypto', {
  value: {
    randomUUID: () => mockUUIDs[uuidIndex++]
  },
  writable: true,
  configurable: true
});

vi.spyOn(Math, 'random').mockReturnValue(0.5);

// --- SERVICE MOCKS ---

vi.mock('../services/dataService', () => ({
  dataService: {
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
  }
}));

vi.mock('../services/soundService', () => ({
  soundService: {
    playClick: vi.fn(),
    playSelect: vi.fn(),
  }
}));

vi.mock('../services/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    getCorrelationId: () => 'test-correlation-id'
  }
}));

vi.mock('../services/geminiService', () => ({
  generateTriviaGame: vi.fn(),
  generateSingleQuestion: vi.fn(),
  generateCategoryQuestions: vi.fn(),
  getGeminiConfigHealth: vi.fn(() => ({ ready: true, message: 'AI ready' })),
}));

describe('TemplateBuilder: Component Lock & Regression Suite', () => {
  const mockOnClose = vi.fn();
  const mockOnSave = vi.fn();
  const mockAddToast = vi.fn();

  const setViewport = (width: number, height = 800) => {
    Object.defineProperty(window, 'innerWidth', { writable: true, configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { writable: true, configurable: true, value: height });
    window.dispatchEvent(new Event('resize'));
  };

  const defaultProps = {
    showId: 'show-123',
    onClose: mockOnClose,
    onSave: mockOnSave,
    addToast: mockAddToast
  };

  beforeEach(() => {
    vi.clearAllMocks();
    uuidIndex = 0;
  });

  describe('PHASE 1: Configuration Step', () => {
    it('renders baseline configuration UI', () => {
      render(<TemplateBuilder {...defaultProps} />);
      expect(screen.getByText(/New Template Configuration/i)).toBeInTheDocument();
      expect(screen.getByText(/Start Manual Studio Building/i)).toBeInTheDocument();
      expect(screen.getByTestId('ai-config-health')).toBeInTheDocument();
      expect(screen.getByTestId('template-session-timer-section')).toBeInTheDocument();
    });

    it('enforces title requirement before building', () => {
      render(<TemplateBuilder {...defaultProps} />);
      const buildBtn = screen.getByText(/Start Manual Studio Building/i);
      fireEvent.click(buildBtn);
      expect(mockAddToast).toHaveBeenCalledWith('error', 'Title is required');
    });

    it('clamps player roster at 8 maximum', () => {
      render(<TemplateBuilder {...defaultProps} />);
      const addBtn = screen.getByText(/ADD PLAYER/i);
      
      // Default is 4 players. Click 4 more times to reach 8.
      for (let i = 0; i < 4; i++) fireEvent.click(addBtn);
      
      expect(screen.getAllByPlaceholderText('ENTER NAME')).toHaveLength(8);
      expect(screen.getByText(/MAX 8 REACHED/i)).toBeInTheDocument();
      expect(screen.getByText(/MAX 8 REACHED/i)).toBeDisabled();
      expect(mockAddToast).not.toHaveBeenCalledWith('error', expect.stringContaining('Max 8'));
    });

    it('clamps player roster at 1 minimum', () => {
      render(<TemplateBuilder {...defaultProps} />);
      // Default is 4. Delete 3.
      const deleteBtns = document.querySelectorAll('.lucide-trash2');
      fireEvent.click(deleteBtns[0].parentElement!);
      fireEvent.click(deleteBtns[1].parentElement!);
      fireEvent.click(deleteBtns[2].parentElement!);
      
      // Attempt to delete the 4th (last)
      const lastDelete = document.querySelectorAll('.lucide-trash2')[0];
      fireEvent.click(lastDelete.parentElement!);

      expect(screen.getAllByPlaceholderText('ENTER NAME')).toHaveLength(1);
      expect(mockAddToast).toHaveBeenCalledWith('error', expect.stringContaining('At least 1'));
    });

    it('quick setup mode applies 1-player and 2-player defaults and stays editable', () => {
      render(<TemplateBuilder {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: '1 Player' }));
      expect(screen.getAllByPlaceholderText('ENTER NAME')).toHaveLength(1);
      expect(screen.getByTestId('template-row-count')).toHaveTextContent('10');
      expect(screen.getByTestId('template-cat-count')).toHaveTextContent('1');
      expect(screen.getByTestId('template-session-timer-duration')).toHaveTextContent('10');
      expect(screen.getByRole('button', { name: '10' })).toHaveClass('bg-gold-600');
      expect(screen.getByRole('button', { name: 'Timed' })).toHaveClass('bg-purple-600');

      fireEvent.click(screen.getByRole('button', { name: '2 Players' }));
      expect(screen.getAllByPlaceholderText('ENTER NAME')).toHaveLength(2);
      expect(screen.getByTestId('template-row-count')).toHaveTextContent('10');
      expect(screen.getByTestId('template-cat-count')).toHaveTextContent('2');

      fireEvent.click(screen.getByRole('button', { name: '5s' }));
      expect(screen.getByTestId('template-session-timer-duration')).toHaveTextContent('5');

      const categoryCount = screen.getByTestId('template-cat-count');
      const categoryControl = categoryCount.parentElement as HTMLElement;
      const categoryDecrementButton = categoryControl.querySelectorAll('button')[0] as HTMLButtonElement;
      fireEvent.click(categoryDecrementButton);
      expect(screen.getByTestId('template-cat-count')).toHaveTextContent('1');
    });

    it('enforces Teams and Quick setup as mutually exclusive in the UI', () => {
      render(<TemplateBuilder {...defaultProps} />);

      const teamsButton = screen.getByRole('button', { name: 'Teams' });
      const quickOneButton = screen.getByRole('button', { name: '1 Player' });
      const quickTwoButton = screen.getByRole('button', { name: '2 Players' });

      fireEvent.click(teamsButton);
      expect(quickOneButton).toBeDisabled();
      expect(quickTwoButton).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: 'Individuals' }));
      expect(quickOneButton).not.toBeDisabled();
      expect(quickTwoButton).not.toBeDisabled();

      fireEvent.click(quickOneButton);
      expect(teamsButton).toBeDisabled();

      fireEvent.click(screen.getByRole('button', { name: 'Individuals' }));
      expect(teamsButton).not.toBeDisabled();
    });

    it('keeps Individuals + Quick Setup + Session Timer controls rendered in compact width', () => {
      setViewport(375, 740);
      render(<TemplateBuilder {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: '1 Player' }));

      expect(screen.getByRole('button', { name: 'Individuals' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '1 Player' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '2 Players' })).toBeInTheDocument();
      expect(screen.getByTestId('template-session-timer-section')).toBeInTheDocument();
      expect(screen.getByTestId('custom-session-timer-input')).toBeInTheDocument();
      expect(screen.getByTestId('custom-session-timer-apply')).toBeInTheDocument();
    });

    it('keeps Teams configuration controls rendered with multiple teams and members', () => {
      setViewport(768, 900);
      render(<TemplateBuilder {...defaultProps} />);

      fireEvent.click(screen.getByRole('button', { name: 'Teams' }));
      fireEvent.click(screen.getByRole('button', { name: /ADD TEAM/i }));
      fireEvent.click(screen.getByRole('button', { name: /ADD TEAM/i }));
      fireEvent.click(screen.getAllByText('+ MEMBER')[0]);
      fireEvent.click(screen.getAllByText('+ MEMBER')[1]);

      expect(screen.getByText(/Teams Setup/i)).toBeInTheDocument();
      expect(screen.getAllByDisplayValue(/TEAM \d/i).length).toBeGreaterThanOrEqual(2);
      expect(screen.getAllByDisplayValue(/MEMBER \d/i).length).toBeGreaterThanOrEqual(4);
      expect(screen.getByRole('button', { name: /Team plays as one/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Team members take turns/i })).toBeInTheDocument();
    });

    it('keeps AI generation controls rendered and accessible in config layout', () => {
      setViewport(1280, 900);
      render(<TemplateBuilder {...defaultProps} />);

      expect(screen.getByText(/AI Magic Studio/i)).toBeInTheDocument();
      expect(screen.getByPlaceholderText(/e.g. 90s Pop Culture/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Generate Complete Board/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Start Manual Studio Building/i })).toBeInTheDocument();
    });

    it('uses desktop no-scroll container strategy while keeping key config sections visible', () => {
      setViewport(1366, 768);
      render(<TemplateBuilder {...defaultProps} />);

      const root = document.querySelector('.template-builder') as HTMLElement;
      expect(root).toBeInTheDocument();
      expect(root.className).toContain('lg:overflow-hidden');

      const bodyGrid = Array.from(root.querySelectorAll('div')).find((el) =>
        (el as HTMLElement).className.includes('lg:grid-cols-[1fr_340px]')
      ) as HTMLElement | undefined;
      expect(bodyGrid).toBeInTheDocument();
      expect(bodyGrid!.className).toContain('lg:overflow-hidden');

      expect(screen.getByText(/Board Dimensions/i)).toBeInTheDocument();
      expect(screen.getByText(/Play Mode/i)).toBeInTheDocument();
      expect(screen.getByText(/Quick Game Setup/i)).toBeInTheDocument();
      expect(screen.getByTestId('template-session-timer-section')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Start Manual Studio Building/i })).toBeInTheDocument();
    });
  });

  describe('PHASE 2: Manual Building & Point Reflow', () => {
    const enterBuilder = () => {
      render(<TemplateBuilder {...defaultProps} />);
      fireEvent.change(screen.getByPlaceholderText(/e.g. Science Night 2024/i), { target: { value: 'Regression Show' } });
      fireEvent.click(screen.getByText(/Start Manual Studio Building/i));
    };

    it('initializes correct grid size (4 cats x 5 rows)', () => {
      enterBuilder();
      expect(screen.getByText(/Live Builder Preview/i)).toBeInTheDocument();
      
      // Category Headers (Default 4)
      const catInputs = screen.getAllByDisplayValue(/Category \d/);
      expect(catInputs).toHaveLength(4);

      // Total Tiles (4 cats * 5 rows = 20)
      const tiles = screen.getAllByText('100'); // 100pt tiles should exist in first row of all cats
      expect(tiles.length).toBeGreaterThanOrEqual(4);
    });

    it('reflows point values when point scale changes', () => {
      enterBuilder();
      const scaleSelect = screen.getByDisplayValue('100');
      fireEvent.change(scaleSelect, { target: { value: '50' } });

      // First row of tiles should now be 50 instead of 100
      expect(screen.getAllByText('50').length).toBeGreaterThanOrEqual(4);
      expect(screen.getAllByText('250').length).toBeGreaterThanOrEqual(4); // Last row (5 * 50)
    });
  });

  describe('PHASE 3: Persistence Logic', () => {
    it('calls createTemplate on new save', async () => {
      render(<TemplateBuilder {...defaultProps} />);
      fireEvent.click(screen.getByRole('button', { name: '2 Players' }));
      fireEvent.click(screen.getByRole('button', { name: 'Timed' }));
      fireEvent.change(screen.getByPlaceholderText(/e.g. Science Night 2024/i), { target: { value: 'New Template Test' } });
      fireEvent.click(screen.getByText(/Start Manual Studio Building/i));

      const saveBtn = screen.getByTestId('save-template-button');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(dataService.createTemplate).toHaveBeenCalledWith(
          'show-123',
          'New Template Test',
          expect.objectContaining({ rowCount: 10, categoryCount: 2, pointScale: 10, quickGameMode: 'two_player', quickTimerMode: 'timed', quickTimerDurationSeconds: 10 }),
          expect.any(Array)
        );
        expect(mockAddToast).toHaveBeenCalledWith('success', 'Template saved successfully.');
      });
    });

    it('calls updateTemplate when initialTemplate is provided', async () => {
      const existingTemplate: any = {
        id: 't-999',
        topic: 'Existing Game',
        categories: [],
        config: { rowCount: 5, categoryCount: 0, playerNames: [] }
      };
      
      render(<TemplateBuilder {...defaultProps} initialTemplate={existingTemplate} />);
      
      const saveBtn = screen.getByTestId('save-template-button');
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(dataService.updateTemplate).toHaveBeenCalledWith(
          expect.objectContaining({ id: 't-999', topic: 'Existing Game' })
        );
      });
    });
  });

  describe('PHASE 4: AI Generation lifecycle', () => {
    it('handles AI Board Populate success', async () => {
      const mockResult = [{
        id: 'ai-cat', title: 'AI Physics',
        questions: [{ id: 'q1', text: 'Q?', answer: 'A!', points: 100, isRevealed: false, isAnswered: false, isDoubleOrNothing: false }]
      }];
      vi.mocked(geminiService.generateTriviaGame).mockResolvedValue(mockResult);

      render(<TemplateBuilder {...defaultProps} />);
      fireEvent.change(screen.getByPlaceholderText(/e.g. 90s Pop Culture/i), { target: { value: 'Physics' } });
      fireEvent.click(screen.getByText(/Generate Complete Board/i));

      expect(screen.getByText(/AI Studio Working/i)).toBeInTheDocument();
      expect(screen.getByText(/Populating entire board/i)).toBeInTheDocument();

      await waitFor(() => {
        expect(screen.getByDisplayValue('AI Physics')).toBeInTheDocument();
        expect(mockAddToast).toHaveBeenCalledWith('success', 'Board populated by AI.');
      });
    });

    it('handles AI Board Populate failure and rolls back', async () => {
      vi.mocked(geminiService.generateTriviaGame).mockRejectedValue(new Error('AI Failure'));

      render(<TemplateBuilder {...defaultProps} />);
      fireEvent.change(screen.getByPlaceholderText(/e.g. 90s Pop Culture/i), { target: { value: 'Fail Test' } });
      fireEvent.click(screen.getByText(/Generate Complete Board/i));

      await waitFor(() => {
        expect(mockAddToast).toHaveBeenCalledWith('error', 'AI Generation failed.');
        expect(screen.queryByText(/AI Studio Working/i)).not.toBeInTheDocument();
      });
    });
  });

  describe('PHASE 5: UI Locks & Magic Cell', () => {
    it('locks interactions during active generation', async () => {
      // Simulate slow generation
      let resolveAi: any;
      const aiPromise = new Promise((res) => { resolveAi = res; });
      vi.mocked(geminiService.generateTriviaGame).mockReturnValue(aiPromise as any);

      render(<TemplateBuilder {...defaultProps} />);
      fireEvent.change(screen.getByPlaceholderText(/e.g. 90s Pop Culture/i), { target: { value: 'Slow AI' } });
      fireEvent.click(screen.getByText(/Generate Complete Board/i));

      // In builder step (state changes automatically on click generate)
      await waitFor(() => screen.getByText(/AI Studio Working/i));

      const saveBtn = screen.getByTestId('save-template-button');
      expect(saveBtn).toBeDisabled();

      // Resolve and unlock
      resolveAi([]);
      await waitFor(() => expect(saveBtn).not.toBeDisabled());
    });

    it('updates single tile via Magic Cell', async () => {
      vi.mocked(geminiService.generateSingleQuestion).mockResolvedValue({ text: 'New AI Q', answer: 'New AI A' });
      
      render(<TemplateBuilder {...defaultProps} />);
      fireEvent.change(screen.getByPlaceholderText(/e.g. Science Night 2024/i), { target: { value: 'Manual' } });
      fireEvent.click(screen.getByText(/Start Manual Studio Building/i));

      // Click first tile quick AI button in the board grid
      const magicBtn = screen.getAllByTitle('Quick AI Generate')[0];
      fireEvent.click(magicBtn);

      await waitFor(() => {
        expect(geminiService.generateSingleQuestion).toHaveBeenCalled();
        expect(mockAddToast).toHaveBeenCalledWith('success', 'Question generated.');
      });
    });
  });
});
