
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TemplateBuilder } from './TemplateBuilder';

// Mock logger
vi.mock('../services/logger', () => ({
  logger: { 
    info: vi.fn(), 
    error: vi.fn(), 
    warn: vi.fn(), 
    getCorrelationId: () => 'test-id' 
  }
}));

vi.mock('../services/soundService', () => ({
  soundService: { playClick: vi.fn() }
}));

vi.mock('../services/geminiService', () => ({
  getGeminiConfigHealth: vi.fn().mockReturnValue({ ready: false }),
  generateTriviaGame: vi.fn(),
  generateSingleQuestion: vi.fn(),
  generateCategoryQuestions: vi.fn(),
}));

const mockProps = {
  showId: 'show-1',
  onClose: vi.fn(),
  onSave: vi.fn(),
  addToast: vi.fn(),
};

describe('TemplateBuilder: Player Configuration & Visibility (Card 1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
  });

  it('A) Renders all player inputs visible without scroll (Card 1)', async () => {
    render(<TemplateBuilder {...mockProps} />);
    
    // Wait for the component to render player inputs
    await waitFor(() => {
      const inputs = screen.queryAllByPlaceholderText('ENTER NAME');
      expect(inputs.length).toBeGreaterThan(0);
    });
    
    // Should have 4 default players
    const inputs = screen.getAllByPlaceholderText('ENTER NAME');
    expect(inputs.length).toBe(4);
    
    // Assert layout uses 2-column grid as requested
    const gridContainer = inputs[0].closest('.grid');
    expect(gridContainer).toHaveClass('grid-cols-2');
    
    // Assert all inputs are visible (not hidden by overflow)
    inputs.forEach(input => {
      expect(input).toBeVisible();
    });
  });

  it('B) MAX PLAYERS: Cannot add more than 8 players', async () => {
    const { logger } = await import('../services/logger');
    render(<TemplateBuilder {...mockProps} />);
    
    await waitFor(() => {
      const inputs = screen.queryAllByPlaceholderText('ENTER NAME');
      expect(inputs.length).toBeGreaterThan(0);
    });
    
    // Default is 4 players. Add 4 more.
    const addBtn = screen.getByText(/ADD PLAYER/i);
    for (let i = 0; i < 4; i++) {
      fireEvent.click(addBtn);
    }
    
    // Attempt 9th
    fireEvent.click(addBtn);
    
    // Assert warning logged and toast triggered
    expect(logger.warn).toHaveBeenCalledWith("template_players_add_blocked_max", expect.any(Object));
  });

  it('C) CLAMPING: Clamps >8 players on initial load with error log', async () => {
    const { logger } = await import('../services/logger');
    const legacyTemplate: any = {
      topic: 'Legacy',
      config: { playerCount: 10, playerNames: Array.from({length: 10}).map((_, i) => `P${i}`), rowCount: 5, categoryCount: 4 },
      categories: [],
    };
    
    render(<TemplateBuilder {...mockProps} initialTemplate={legacyTemplate} />);
    
    await waitFor(() => {
      const inputs = screen.queryAllByPlaceholderText('ENTER NAME');
      expect(inputs.length).toBe(8);
    });
    
    expect(logger.error).toHaveBeenCalledWith("template_players_over_max_clamped", expect.any(Object));
  });

  it('D) DELETION: Delete icon removes specific player by stable ID', async () => {
    render(<TemplateBuilder {...mockProps} />);
    
    await waitFor(() => {
      const inputs = screen.queryAllByPlaceholderText('ENTER NAME');
      expect(inputs.length).toBeGreaterThan(0);
    });
    
    const inputs = screen.getAllByPlaceholderText('ENTER NAME') as HTMLInputElement[];
    fireEvent.change(inputs[1], { target: { value: 'TARGET DELETE' } });
    fireEvent.change(inputs[2], { target: { value: 'KEEP ME' } });

    // Use querySelector for specific icon as it might not have text
    const deleteBtns = document.querySelectorAll('.lucide-trash2');
    fireEvent.click(deleteBtns[1].parentElement!);

    expect(screen.queryByDisplayValue('TARGET DELETE')).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('KEEP ME')).toBeInTheDocument();
  });
});
