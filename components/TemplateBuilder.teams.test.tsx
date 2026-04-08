import React from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TemplateBuilder } from './TemplateBuilder';
import { dataService } from '../services/dataService';
import { generateTriviaGame } from '../services/geminiService';

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

  const validGeneratedCategories = [
    {
      id: 'cat-1',
      title: 'Science',
      questions: Array.from({ length: 5 }).map((_, index) => ({
        id: `q-${index + 1}`,
        text: `Question ${index + 1}`,
        answer: `Answer ${index + 1}`,
        points: (index + 1) * 100,
        isRevealed: false,
        isAnswered: false,
        isDoubleOrNothing: false,
      })),
    },
  ];

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

  it('prevents AI generation when Team Mode is invalid instead of failing later on save', () => {
    const addToast = vi.fn();

    render(
      <TemplateBuilder
        showId="show-1"
        onClose={() => undefined}
        onSave={() => undefined}
        addToast={addToast}
      />
    );

    fireEvent.click(screen.getByText('Teams'));
    fireEvent.change(screen.getByPlaceholderText(/e.g. 90s Pop Culture/i), { target: { value: 'Team Trivia' } });

    const generateButton = screen.getByRole('button', { name: /Generate Complete Board/i });
    expect(generateButton).toBeDisabled();
    expect(screen.getByText(/Add at least one team/i)).toBeInTheDocument();
  });

  it('blocks TEAM_MEMBERS_TAKE_TURNS when team sizes do not match', () => {
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
    fireEvent.click(screen.getByText(/ADD TEAM/i));
    fireEvent.click(screen.getAllByText('+ MEMBER')[0]);
    fireEvent.click(screen.getByRole('button', { name: /Team members take turns/i }));

    expect(screen.getByText(/In Team Members Take Turns mode/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Generate Complete Board/i })).toBeDisabled();
  });

  it('allows TEAM_PLAYS_AS_ONE with mismatched team sizes', () => {
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
    fireEvent.click(screen.getByText(/ADD TEAM/i));
    fireEvent.click(screen.getAllByText('+ MEMBER')[0]);
    fireEvent.change(screen.getByPlaceholderText(/e.g. 90s Pop Culture/i), { target: { value: 'Flexible Teams' } });
    fireEvent.click(screen.getByRole('button', { name: /Team plays as one/i }));

    expect(screen.getByRole('button', { name: /Generate Complete Board/i })).not.toBeDisabled();
  });

  it('keeps team config intact through generate questions and Save Template', async () => {
    const onSave = vi.fn();
    (generateTriviaGame as any).mockResolvedValue(validGeneratedCategories);

    render(
      <TemplateBuilder
        showId="show-1"
        onClose={() => undefined}
        onSave={onSave}
        addToast={() => undefined}
      />
    );

    fireEvent.click(screen.getByText('Teams'));
    fireEvent.click(screen.getByText(/ADD TEAM/i));
    fireEvent.click(screen.getByText(/ADD TEAM/i));
    fireEvent.change(screen.getByDisplayValue('TEAM 1'), { target: { value: 'Red Team' } });
    fireEvent.change(screen.getByDisplayValue('TEAM 2'), { target: { value: 'Blue Team' } });
    fireEvent.change(screen.getAllByPlaceholderText('MEMBER 1')[0], { target: { value: 'Ana' } });
    fireEvent.change(screen.getAllByPlaceholderText('MEMBER 1')[1], { target: { value: 'Ben' } });
    fireEvent.click(screen.getByRole('button', { name: /Team members take turns/i }));
    fireEvent.change(screen.getByPlaceholderText(/e.g. 90s Pop Culture/i), { target: { value: 'Team Trivia Night' } });

    fireEvent.click(screen.getByRole('button', { name: /Generate Complete Board/i }));

    await waitFor(() => {
      expect(screen.getByText(/Live Builder Preview/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('save-template-button'));

    await waitFor(() => {
      expect(dataService.createTemplate).toHaveBeenCalledWith(
        'show-1',
        'Team Trivia Night',
        expect.objectContaining({
          playMode: 'TEAMS',
          teamPlayStyle: 'TEAM_MEMBERS_TAKE_TURNS',
          teams: [
            expect.objectContaining({
              name: 'RED TEAM',
              members: [expect.objectContaining({ name: 'ANA', orderIndex: 0 })],
            }),
            expect.objectContaining({
              name: 'BLUE TEAM',
              members: [expect.objectContaining({ name: 'BEN', orderIndex: 0 })],
            }),
          ],
        }),
        expect.any(Array)
      );
      expect(onSave).toHaveBeenCalled();
    });
  });
});

