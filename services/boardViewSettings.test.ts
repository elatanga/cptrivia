import { describe, it, expect } from 'vitest';
import {
  DEFAULT_BOARD_VIEW_SETTINGS,
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
});

