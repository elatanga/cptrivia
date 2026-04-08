import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { TemplateBuilder } from './TemplateBuilder';

vi.mock('../services/geminiService', () => ({
  generateTriviaGame: vi.fn(),
  generateSingleQuestion: vi.fn(),
  generateCategoryQuestions: vi.fn(),
  getGeminiConfigHealth: () => ({ ready: false }),
}));

vi.mock('../services/dataService', () => ({
  dataService: {
    createTemplate: vi.fn(),
    updateTemplate: vi.fn(),
  },
}));

describe('TemplateBuilder Teams Mode', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('allows switching from Individuals to Teams mode', () => {
    render(
      <TemplateBuilder
        showId="show-1"
        onClose={() => undefined}
        onSave={() => undefined}
        addToast={() => undefined}
      />
    );

    expect(screen.getByText('Individuals')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Teams'));

    expect(screen.getByText(/Teams Setup/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Team plays as one/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Team members take turns/i })).toBeInTheDocument();
  });

  it('supports adding teams and team members', () => {
    render(
      <TemplateBuilder
        showId="show-1"
        onClose={() => undefined}
        onSave={() => undefined}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByText('Teams'));
    fireEvent.click(screen.getByText(/ADD TEAM/i));

    expect(screen.getByDisplayValue('TEAM 1')).toBeInTheDocument();
    expect(screen.getByDisplayValue('MEMBER 1')).toBeInTheDocument();
  });
});

