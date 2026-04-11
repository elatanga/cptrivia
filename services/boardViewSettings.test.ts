import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BOARD_VIEW_SETTINGS,
  getQuestionDisplayLayoutTokens,
  getScoreboardLayoutTokens,
  getTriviaBoardLayoutTokens,
  sanitizeBoardViewSettings,
  sanitizeBoardViewSettingsPatch,
} from './boardViewSettings';

describe('boardViewSettings hardening', () => {
  it('falls back to canonical defaults when numeric values are invalid', () => {
    const sanitized = sanitizeBoardViewSettings({
      ...DEFAULT_BOARD_VIEW_SETTINGS,
      scoreboardScale: Number.NaN,
      tilePaddingScale: Number.POSITIVE_INFINITY,
      updatedAt: 'x',
    });

    expect(sanitized.scoreboardScale).toBe(DEFAULT_BOARD_VIEW_SETTINGS.scoreboardScale);
    expect(sanitized.tilePaddingScale).toBe(DEFAULT_BOARD_VIEW_SETTINGS.tilePaddingScale);
  });

  it('sanitizes patch values and snaps numeric options predictably', () => {
    const patch = sanitizeBoardViewSettingsPatch({
      scoreboardScale: '1.33' as unknown as number,
      tilePaddingScale: '0.73' as unknown as number,
      playerNameScale: 'INVALID' as unknown as any,
    });

    expect(patch.scoreboardScale).toBe(1.4);
    expect(patch.tilePaddingScale).toBe(0.75);
    expect(patch.playerNameScale).toBe('M');
  });

  it('derives responsive scoreboard tokens without producing unsafe values', () => {
    const compact = getScoreboardLayoutTokens(
      {
        ...DEFAULT_BOARD_VIEW_SETTINGS,
        scoreboardScale: 1.4,
        playerNameScale: 'XL',
        updatedAt: 'x',
      },
      768
    );

    expect(compact.playerNameFontPx).toBeGreaterThanOrEqual(10);
    expect(compact.playerNameFontPx).toBeLessThanOrEqual(22);
    expect(compact.panelWidthCss.startsWith('clamp(')).toBe(true);
    expect(compact.allowTwoColumn).toBe(false);
  });

  it('derives board tokens with safe paddings and category height', () => {
    const tokens = getTriviaBoardLayoutTokens(
      {
        ...DEFAULT_BOARD_VIEW_SETTINGS,
        categoryTitleScale: 'XL',
        tileScale: 'XL',
        tilePaddingScale: 1.5,
        updatedAt: 'x',
      },
      600
    );

    expect(tokens.categoryMinHeightPx).toBeGreaterThanOrEqual(38);
    expect(tokens.categoryPaddingPx).toBeGreaterThanOrEqual(4);
    expect(tokens.tileInnerPaddingPx).toBeGreaterThanOrEqual(2);
    expect(tokens.tileInnerPaddingPx).toBeLessThanOrEqual(10);
  });

  it('normalizes malformed question display settings to safe defaults', () => {
    const sanitized = sanitizeBoardViewSettings({
      ...DEFAULT_BOARD_VIEW_SETTINGS,
      questionModalSize: 'HUGE' as any,
      questionMaxWidthPercent: 999,
      questionFontScale: 0.01,
      questionContentPadding: -100,
      multipleChoiceColumns: '3' as any,
      updatedAt: 'x',
    });

    expect(sanitized.questionModalSize).toBe(DEFAULT_BOARD_VIEW_SETTINGS.questionModalSize);
    expect(sanitized.questionMaxWidthPercent).toBe(100);
    expect(sanitized.questionFontScale).toBe(0.8);
    expect(sanitized.questionContentPadding).toBe(4);
    expect(sanitized.multipleChoiceColumns).toBe('auto');
  });

  it('derives safe question modal layout tokens from sanitized settings', () => {
    const tokens = getQuestionDisplayLayoutTokens(
      {
        ...DEFAULT_BOARD_VIEW_SETTINGS,
        questionModalSize: 'ExtraLarge',
        questionMaxWidthPercent: 95,
        questionFontScale: 1.3,
        questionContentPadding: 20,
        multipleChoiceColumns: '2',
        updatedAt: 'x',
      },
      4
    );

    expect(tokens.modalMaxWidthPx).toBe(1440);
    expect(tokens.contentMaxWidthPercent).toBe(95);
    expect(tokens.contentPaddingPx).toBe(20);
    expect(tokens.questionMinFontPx).toBeGreaterThanOrEqual(16);
    expect(tokens.questionMaxFontPx).toBeLessThanOrEqual(124);
    expect(tokens.optionGridClass).toBe('grid-cols-1 sm:grid-cols-2');
  });
});

