/**
 * GameBoard Auto-Fit & Settings Impact Tests
 *
 * Phase 8 additive tests covering:
 *   A) Board auto-fits at max rows (10) without manual Director adjustment
 *   B) Board settings produce visibly significant differences
 *   C) Regression lock: max-row board stays visible, settings are not no-ops
 */

import React from 'react';
import { render } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { GameBoard } from './GameBoard';
import { BoardViewSettings, Category } from '../types';
import { getTriviaBoardLayoutTokens } from '../services/boardViewSettings';

vi.mock('../services/soundService', () => ({
  soundService: { playSelect: vi.fn() },
}));
vi.mock('../services/logger', () => ({
  logger: { info: vi.fn() },
}));

// --- Shared helpers ---

const baseSettings: BoardViewSettings = {
  categoryTitleScale: 'M',
  playerNameScale: 'M',
  tileScale: 'M',
  scoreboardScale: 1.0,
  tilePaddingScale: 1.0,
  questionModalSize: 'Medium',
  questionMaxWidthPercent: 80,
  questionFontScale: 1.0,
  questionContentPadding: 12,
  multipleChoiceColumns: 'auto',
  updatedAt: '',
};

const makeCategoriesWithRows = (rowCount: number, catCount = 6): Category[] =>
  Array.from({ length: catCount }, (_, ci) => ({
    id: `cat-${ci}`,
    title: `CAT ${ci + 1}`,
    questions: Array.from({ length: rowCount }, (__, ri) => ({
      id: `q-${ci}-${ri}`,
      text: `Q ${ri + 1}`,
      answer: `A ${ri + 1}`,
      points: (ri + 1) * 100,
      isRevealed: false,
      isAnswered: false,
    })),
  }));

const getBoardStyleVar = (container: Element, varName: string): string => {
  const boardEl = container.firstChild as HTMLElement;
  return boardEl?.style?.getPropertyValue(varName) ?? '';
};

const parseIntPx = (cssValue: string): number => parseInt(cssValue, 10);

// ─────────────────────────────────────────────────────────────────────────────
// A) BOARD AUTO-FIT AT GAME START (max rows)
// ─────────────────────────────────────────────────────────────────────────────

describe('A) Board Auto-Fit at Max Rows', () => {
  it('A1: renders all 60 tiles (6 cats × 10 rows) without throwing', () => {
    const categories = makeCategoriesWithRows(10);
    const { getAllByRole } = render(
      <GameBoard
        categories={categories}
        onSelectQuestion={vi.fn()}
        viewSettings={baseSettings}
      />
    );
    // 10 rows × 6 categories = 60 tile buttons
    const buttons = getAllByRole('button');
    expect(buttons.length).toBe(60);
  });

  it('A2: tileMinHeightPx is smaller at 10 rows than at 5 rows (auto-fit active)', () => {
    const tokens5 = getTriviaBoardLayoutTokens(baseSettings, 1280, 5);
    const tokens10 = getTriviaBoardLayoutTokens(baseSettings, 1280, 10);
    expect(tokens10.tileMinHeightPx).toBeLessThan(tokens5.tileMinHeightPx);
  });

  it('A3: tileMinHeightPx at 10 rows (M scale) is <= 40px — small enough to auto-fit most screens', () => {
    const tokens = getTriviaBoardLayoutTokens(baseSettings, 1280, 10);
    // At 10 rows, rowDensityFactor = 0.5: 72 * 1.0 * 1.0 * 1.0 * 0.5 = 36
    expect(tokens.tileMinHeightPx).toBeLessThanOrEqual(40);
  });

  it('A4: tileMinHeightPx at 7 rows is between 5-row and 10-row values (proportional)', () => {
    const tokens5 = getTriviaBoardLayoutTokens(baseSettings, 1280, 5);
    const tokens7 = getTriviaBoardLayoutTokens(baseSettings, 1280, 7);
    const tokens10 = getTriviaBoardLayoutTokens(baseSettings, 1280, 10);
    expect(tokens7.tileMinHeightPx).toBeLessThanOrEqual(tokens5.tileMinHeightPx);
    expect(tokens7.tileMinHeightPx).toBeGreaterThanOrEqual(tokens10.tileMinHeightPx);
  });

  it('A5: board CSS variable --tile-min-h-px is reduced when rowCount is 10', () => {
    const categories = makeCategoriesWithRows(10);
    const { container } = render(
      <GameBoard
        categories={categories}
        onSelectQuestion={vi.fn()}
        viewSettings={baseSettings}
      />
    );
    const heightPx = parseIntPx(getBoardStyleVar(container, '--tile-min-h-px'));
    // Should be at most 40px (auto-fit for 10 rows at M scale)
    expect(heightPx).toBeGreaterThan(0);
    expect(heightPx).toBeLessThanOrEqual(40);
  });

  it('A6: board CSS variable --tile-min-h-px is larger for 5-row board than 10-row board', () => {
    const cats5 = makeCategoriesWithRows(5);
    const cats10 = makeCategoriesWithRows(10);

    const { container: c5 } = render(
      <GameBoard categories={cats5} onSelectQuestion={vi.fn()} viewSettings={baseSettings} />
    );
    const { container: c10 } = render(
      <GameBoard categories={cats10} onSelectQuestion={vi.fn()} viewSettings={baseSettings} />
    );

    const h5 = parseIntPx(getBoardStyleVar(c5, '--tile-min-h-px'));
    const h10 = parseIntPx(getBoardStyleVar(c10, '--tile-min-h-px'));
    expect(h5).toBeGreaterThan(h10);
  });

  it('A7: smaller boards (3 rows) are NOT shrunk — rowDensityFactor stays 1.0', () => {
    const tokens3 = getTriviaBoardLayoutTokens(baseSettings, 1280, 3);
    const tokens5 = getTriviaBoardLayoutTokens(baseSettings, 1280, 5);
    // 3 rows should produce the same tile size as 5 rows (no unnecessary shrinkage)
    expect(tokens3.tileMinHeightPx).toBe(tokens5.tileMinHeightPx);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B) BOARD SETTINGS IMPACT — visibly significant differences
// ─────────────────────────────────────────────────────────────────────────────

describe('B) Board Settings Impact', () => {
  it('B1: XL tileScale produces meaningfully taller tiles than XS', () => {
    const xsSettings = { ...baseSettings, tileScale: 'XS' as const };
    const xlSettings = { ...baseSettings, tileScale: 'XL' as const };
    const tokensXS = getTriviaBoardLayoutTokens(xsSettings, 1280, 5);
    const tokensXL = getTriviaBoardLayoutTokens(xlSettings, 1280, 5);
    // XL should be at least 40% taller than XS
    expect(tokensXL.tileMinHeightPx / tokensXS.tileMinHeightPx).toBeGreaterThan(1.4);
  });

  it('B2: XL tileScale produces meaningfully wider tiles than XS', () => {
    const xsSettings = { ...baseSettings, tileScale: 'XS' as const };
    const xlSettings = { ...baseSettings, tileScale: 'XL' as const };
    const tokensXS = getTriviaBoardLayoutTokens(xsSettings, 1280, 5);
    const tokensXL = getTriviaBoardLayoutTokens(xlSettings, 1280, 5);
    // XL should be at least 30% wider than XS
    expect(tokensXL.tileMinWidthPx / tokensXS.tileMinWidthPx).toBeGreaterThan(1.3);
  });

  it('B3: XL categoryTitleScale produces a larger font than M (visible difference)', () => {
    const mSettings = { ...baseSettings, categoryTitleScale: 'M' as const };
    const xlSettings = { ...baseSettings, categoryTitleScale: 'XL' as const };
    const tokensM = getTriviaBoardLayoutTokens(mSettings, 1280, 5);
    const tokensXL = getTriviaBoardLayoutTokens(xlSettings, 1280, 5);
    expect(tokensXL.categoryTitleFontPx).toBeGreaterThan(tokensM.categoryTitleFontPx);
  });

  it('B4: board CSS --tile-min-h-px is visibly different between XS and XL tileScale', () => {
    const cats = makeCategoriesWithRows(5);
    const { container: cXS } = render(
      <GameBoard categories={cats} onSelectQuestion={vi.fn()} viewSettings={{ ...baseSettings, tileScale: 'XS' }} />
    );
    const { container: cXL } = render(
      <GameBoard categories={cats} onSelectQuestion={vi.fn()} viewSettings={{ ...baseSettings, tileScale: 'XL' }} />
    );
    const hXS = parseIntPx(getBoardStyleVar(cXS, '--tile-min-h-px'));
    const hXL = parseIntPx(getBoardStyleVar(cXL, '--tile-min-h-px'));
    expect(hXL).toBeGreaterThan(hXS);
  });

  it('B5: board CSS --cat-font-px is visibly different between XS and XL categoryTitleScale', () => {
    const cats = makeCategoriesWithRows(5);
    const { container: cXS } = render(
      <GameBoard categories={cats} onSelectQuestion={vi.fn()} viewSettings={{ ...baseSettings, categoryTitleScale: 'XS' }} />
    );
    const { container: cXL } = render(
      <GameBoard categories={cats} onSelectQuestion={vi.fn()} viewSettings={{ ...baseSettings, categoryTitleScale: 'XL' }} />
    );
    const fXS = parseIntPx(getBoardStyleVar(cXS, '--cat-font-px'));
    const fXL = parseIntPx(getBoardStyleVar(cXL, '--cat-font-px'));
    expect(fXL).toBeGreaterThan(fXS);
  });

  it('B6: settings are NOT no-ops — XS and XL tile scales produce different --tile-min-h-px', () => {
    const cats = makeCategoriesWithRows(5);
    const { container: cM } = render(
      <GameBoard categories={cats} onSelectQuestion={vi.fn()} viewSettings={{ ...baseSettings, tileScale: 'M' }} />
    );
    const { container: cXL } = render(
      <GameBoard categories={cats} onSelectQuestion={vi.fn()} viewSettings={{ ...baseSettings, tileScale: 'XL' }} />
    );
    const hM = parseIntPx(getBoardStyleVar(cM, '--tile-min-h-px'));
    const hXL = parseIntPx(getBoardStyleVar(cXL, '--tile-min-h-px'));
    expect(hXL).not.toBe(hM);
  });

  it('B7: board settings remain stable at max rows — no NaN or zero tile dims', () => {
    const xlSettings = { ...baseSettings, tileScale: 'XL' as const };
    const tokens = getTriviaBoardLayoutTokens(xlSettings, 1280, 10);
    expect(tokens.tileMinHeightPx).toBeGreaterThan(0);
    expect(tokens.tileMinWidthPx).toBeGreaterThan(0);
    expect(tokens.tilePointFontPx).toBeGreaterThan(0);
    expect(Number.isFinite(tokens.tileMinHeightPx)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C) REGRESSION LOCKS
// ─────────────────────────────────────────────────────────────────────────────

describe('C) Regression Locks', () => {
  it('C1: max-row board (10 rows) renders with all tile buttons present', () => {
    const categories = makeCategoriesWithRows(10, 6);
    const { getAllByRole } = render(
      <GameBoard categories={categories} onSelectQuestion={vi.fn()} viewSettings={baseSettings} />
    );
    expect(getAllByRole('button').length).toBe(60);
  });

  it('C2: standard 5-row board still renders correctly after auto-fit changes', () => {
    const categories = makeCategoriesWithRows(5, 6);
    const { getAllByRole } = render(
      <GameBoard categories={categories} onSelectQuestion={vi.fn()} viewSettings={baseSettings} />
    );
    expect(getAllByRole('button').length).toBe(30);
  });

  it('C3: categoryMinHeightPx is always >= 38 regardless of rowCount', () => {
    [3, 5, 7, 10].forEach((rows) => {
      const tokens = getTriviaBoardLayoutTokens(baseSettings, 1280, rows);
      expect(tokens.categoryMinHeightPx).toBeGreaterThanOrEqual(38);
    });
  });

  it('C4: all token values remain finite and positive across row counts and scales', () => {
    const scales = ['XS', 'S', 'M', 'L', 'XL'] as const;
    const rowCounts = [1, 3, 5, 7, 10];
    for (const tileScale of scales) {
      for (const rows of rowCounts) {
        const tokens = getTriviaBoardLayoutTokens({ ...baseSettings, tileScale }, 1280, rows);
        expect(Number.isFinite(tokens.tileMinHeightPx)).toBe(true);
        expect(Number.isFinite(tokens.tileMinWidthPx)).toBe(true);
        expect(tokens.tileMinHeightPx).toBeGreaterThan(0);
        expect(tokens.tileMinWidthPx).toBeGreaterThan(0);
      }
    }
  });
});

