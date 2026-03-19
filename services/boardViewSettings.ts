import { BoardViewSettings, SizeScale } from '../types';
import { getScaleMap } from './utils';

const SIZE_SCALE_OPTIONS: SizeScale[] = ['XS', 'S', 'M', 'L', 'XL'];
const TILE_DENSITY_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5] as const;
const PANEL_WIDTH_OPTIONS = [0.8, 1.0, 1.2, 1.4] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

const nearestOption = (value: number, options: readonly number[]) => {
  return options.reduce((closest, current) => {
    return Math.abs(current - value) < Math.abs(closest - value) ? current : closest;
  }, options[0]);
};

const sanitizeNearestOption = (value: unknown, options: readonly number[], fallback: number) => {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (!isFiniteNumber(parsed)) return fallback;
  return nearestOption(parsed, options);
};

export const DEFAULT_BOARD_VIEW_SETTINGS: Omit<BoardViewSettings, 'updatedAt'> = {
  categoryTitleScale: 'M',
  playerNameScale: 'M',
  tileScale: 'M',
  scoreboardScale: 1.0,
  tilePaddingScale: 1.0,
};

export const BOARD_VIEW_SETTINGS_OPTIONS = {
  sizeScales: SIZE_SCALE_OPTIONS,
  tileDensity: TILE_DENSITY_OPTIONS,
  panelWidth: PANEL_WIDTH_OPTIONS,
  panelWidthLabels: {
    0.8: 'Slim',
    1: 'Normal',
    1.2: 'Wide',
    1.4: 'Ultra',
  } as Record<number, string>,
};

const isSizeScale = (value: unknown): value is SizeScale => {
  return typeof value === 'string' && (SIZE_SCALE_OPTIONS as string[]).includes(value);
};

export const getDefaultBoardViewSettings = (updatedAt = new Date().toISOString()): BoardViewSettings => ({
  ...DEFAULT_BOARD_VIEW_SETTINGS,
  updatedAt,
});

export const sanitizeBoardViewSettings = (settings?: Partial<BoardViewSettings> | null): BoardViewSettings => {
  const base = getDefaultBoardViewSettings(typeof settings?.updatedAt === 'string' && settings.updatedAt ? settings.updatedAt : new Date().toISOString());
  if (!settings) return base;

  return {
    categoryTitleScale: isSizeScale(settings.categoryTitleScale) ? settings.categoryTitleScale : base.categoryTitleScale,
    playerNameScale: isSizeScale(settings.playerNameScale) ? settings.playerNameScale : base.playerNameScale,
    tileScale: isSizeScale(settings.tileScale) ? settings.tileScale : base.tileScale,
    scoreboardScale: sanitizeNearestOption(settings.scoreboardScale, PANEL_WIDTH_OPTIONS, base.scoreboardScale),
    tilePaddingScale: sanitizeNearestOption(settings.tilePaddingScale, TILE_DENSITY_OPTIONS, base.tilePaddingScale),
    updatedAt: base.updatedAt,
  };
};

export const sanitizeBoardViewSettingsPatch = (patch: Partial<BoardViewSettings>): Partial<BoardViewSettings> => {
  const next: Partial<BoardViewSettings> = {};

  if (patch.categoryTitleScale !== undefined) {
    next.categoryTitleScale = isSizeScale(patch.categoryTitleScale) ? patch.categoryTitleScale : DEFAULT_BOARD_VIEW_SETTINGS.categoryTitleScale;
  }
  if (patch.playerNameScale !== undefined) {
    next.playerNameScale = isSizeScale(patch.playerNameScale) ? patch.playerNameScale : DEFAULT_BOARD_VIEW_SETTINGS.playerNameScale;
  }
  if (patch.tileScale !== undefined) {
    next.tileScale = isSizeScale(patch.tileScale) ? patch.tileScale : DEFAULT_BOARD_VIEW_SETTINGS.tileScale;
  }
  if (patch.scoreboardScale !== undefined) {
    next.scoreboardScale = sanitizeNearestOption(patch.scoreboardScale, PANEL_WIDTH_OPTIONS, DEFAULT_BOARD_VIEW_SETTINGS.scoreboardScale);
  }
  if (patch.tilePaddingScale !== undefined) {
    next.tilePaddingScale = sanitizeNearestOption(patch.tilePaddingScale, TILE_DENSITY_OPTIONS, DEFAULT_BOARD_VIEW_SETTINGS.tilePaddingScale);
  }
  if (patch.updatedAt !== undefined) {
    next.updatedAt = typeof patch.updatedAt === 'string' && patch.updatedAt ? patch.updatedAt : new Date().toISOString();
  }

  return next;
};

export interface TriviaBoardLayoutTokens {
  categoryTitleFontPx: number;
  categoryTitleLineHeight: number;
  categoryLineClamp: number;
  categoryMinHeightPx: number;
  categoryPaddingPx: number;
  tilePaddingScale: number;
  tileInnerPaddingPx: number;
  tileScaleFactor: number;
  boardGapPx: number;
  tileMinWidthPx: number;
  tileMinHeightPx: number;
  tilePointFontPx: number;
}

export interface ScoreboardLayoutTokens {
  playerNameFontPx: number;
  scoreFontPx: number;
  badgeFontPx: number;
  scoreboardScale: number;
  panelWidthCss: string;
  allowTwoColumn: boolean;
}

const getViewportCompactFactor = (viewportWidth: number) => {
  if (viewportWidth < 768) return 0.86;
  if (viewportWidth < 1024) return 0.93;
  return 1;
};

export const getTriviaBoardLayoutTokens = (
  settings: BoardViewSettings,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280
): TriviaBoardLayoutTokens => {
  const safe = sanitizeBoardViewSettings(settings);
  const compact = getViewportCompactFactor(viewportWidth);
  const scale = getScaleMap(safe.tileScale).factor;
  const densityScale = clamp(1 + (safe.tilePaddingScale - 1) * 0.3, 0.82, 1.18);

  const categoryTitleFontPx = clamp(Math.round(getScaleMap(safe.categoryTitleScale).px * compact), 10, 28);
  const categoryLineClamp = categoryTitleFontPx >= 22 ? 2 : 3;
  const categoryTitleLineHeight = categoryTitleFontPx >= 20 ? 1.1 : 1.2;
  const categoryPaddingPx = clamp(Math.round((8 + (safe.tilePaddingScale - 1) * 4) * compact), 4, 14);

  const boardGapPx = clamp(Math.round((10 + (safe.tilePaddingScale - 1) * 6) * compact), 6, 18);
  const tileMinWidthPx = clamp(Math.round(88 * scale * compact * densityScale), 62, 136);
  const tileMinHeightPx = clamp(Math.round(72 * scale * compact * densityScale), 52, 124);
  const tilePointFontPx = clamp(Math.round(38 * scale * compact * densityScale), 16, 82);
  const tileInnerPaddingPx = clamp(Math.round((4 + (safe.tilePaddingScale - 1) * 4) * compact), 2, 10);
  const categoryMinHeightPx = clamp(Math.round((categoryTitleFontPx * categoryLineClamp * categoryTitleLineHeight) + (categoryPaddingPx * 2)), 38, 96);

  return {
    categoryTitleFontPx,
    categoryTitleLineHeight,
    categoryLineClamp,
    categoryMinHeightPx,
    categoryPaddingPx,
    tilePaddingScale: safe.tilePaddingScale,
    tileInnerPaddingPx,
    tileScaleFactor: scale,
    boardGapPx,
    tileMinWidthPx,
    tileMinHeightPx,
    tilePointFontPx,
  };
};

export const getScoreboardLayoutTokens = (
  settings: BoardViewSettings,
  viewportWidth = typeof window !== 'undefined' ? window.innerWidth : 1280
): ScoreboardLayoutTokens => {
  const safe = sanitizeBoardViewSettings(settings);
  const compact = getViewportCompactFactor(viewportWidth);

  const minRem = clamp(14.5 * compact * safe.scoreboardScale, 13, 22);
  const preferredVw = clamp(22 * safe.scoreboardScale, 18, 38);
  const maxRem = clamp((28 * safe.scoreboardScale * compact) + 8, 24, 46);
  const panelWidthCss = `clamp(${minRem.toFixed(2)}rem, ${preferredVw.toFixed(2)}vw, ${maxRem.toFixed(2)}rem)`;
  const playerNameFontPx = clamp(Math.round(Math.min(getScaleMap(safe.playerNameScale).px, 22) * compact), 10, 22);
  const scoreFontPx = clamp(Math.round((26 + (safe.scoreboardScale - 1) * 6) * compact), 14, 40);
  const badgeFontPx = clamp(Math.round(8 * compact), 7, 10);
  const allowTwoColumn = viewportWidth >= 1180;

  return {
    playerNameFontPx,
    scoreFontPx,
    badgeFontPx,
    scoreboardScale: safe.scoreboardScale,
    panelWidthCss,
    allowTwoColumn,
  };
};

