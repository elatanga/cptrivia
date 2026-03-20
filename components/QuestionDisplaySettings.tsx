import React from 'react';
import { Monitor, Grid3x3, Type, Square } from 'lucide-react';
import { BoardViewSettings } from '../types';
import { BOARD_VIEW_SETTINGS_OPTIONS } from '../services/boardViewSettings';
import { soundService } from '../services/soundService';

interface Props {
  settings: BoardViewSettings;
  onUpdateSettings: (updates: Partial<BoardViewSettings>) => void;
}

export const QuestionDisplaySettings: React.FC<Props> = ({ settings, onUpdateSettings }) => {
  const handleChange = (key: keyof BoardViewSettings, value: any) => {
    soundService.playClick();
    onUpdateSettings({ [key]: value });
  };

  return (
    <div className="space-y-6 bg-zinc-900/30 border border-zinc-800 rounded-xl p-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Monitor className="w-5 h-5 text-gold-500" />
        <h3 className="text-gold-500 font-black uppercase tracking-widest text-sm">Question Display Settings</h3>
      </div>

      {/* Modal Size Preset */}
      <div>
        <label className="block text-xs uppercase text-zinc-400 font-bold mb-2 tracking-widest">Modal Size Preset</label>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {BOARD_VIEW_SETTINGS_OPTIONS.modalSizes.map((size) => (
            <button
              key={size}
              onClick={() => handleChange('questionModalSize', size)}
              className={`py-2 px-3 rounded text-xs font-black uppercase transition-all border ${
                settings.questionModalSize === size
                  ? 'bg-gold-600 text-black border-gold-500 shadow-lg'
                  : 'bg-black/40 text-zinc-400 border-zinc-700 hover:border-zinc-600'
              }`}
            >
              {BOARD_VIEW_SETTINGS_OPTIONS.modalSizeLabels[size]}
            </button>
          ))}
        </div>
      </div>

      {/* Max Content Width */}
      <div>
        <label className="block text-xs uppercase text-zinc-400 font-bold mb-2 tracking-widest">
          Max Content Width: {settings.questionMaxWidthPercent}%
        </label>
        <input
          type="range"
          min="60"
          max="100"
          step="5"
          value={settings.questionMaxWidthPercent}
          onChange={(e) => handleChange('questionMaxWidthPercent', Number(e.target.value))}
          className="w-full h-2 bg-zinc-800 rounded-lg appearance-none cursor-pointer accent-gold-500"
        />
        <p className="text-[11px] text-zinc-500 mt-1">Determines max width of question content area</p>
      </div>

      {/* Font Scale */}
      <div>
        <label className="block text-xs uppercase text-zinc-400 font-bold mb-2 tracking-widest flex items-center gap-2">
          <Type className="w-3.5 h-3.5" />
          Font Scale: {settings.questionFontScale.toFixed(1)}x
        </label>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {BOARD_VIEW_SETTINGS_OPTIONS.fontScaleOptions.map((scale) => (
            <button
              key={scale}
              onClick={() => handleChange('questionFontScale', scale)}
              className={`py-1.5 px-2 rounded text-[11px] font-bold transition-all border ${
                Math.abs(settings.questionFontScale - scale) < 0.01
                  ? 'bg-gold-600 text-black border-gold-500'
                  : 'bg-black/40 text-zinc-400 border-zinc-700 hover:border-zinc-600'
              }`}
            >
              {scale.toFixed(1)}x
            </button>
          ))}
        </div>
        <p className="text-[11px] text-zinc-500 mt-1">Multiplier for question and answer text</p>
      </div>

      {/* Content Padding */}
      <div>
        <label className="block text-xs uppercase text-zinc-400 font-bold mb-2 tracking-widest flex items-center gap-2">
          <Square className="w-3.5 h-3.5" />
          Content Padding: {settings.questionContentPadding}px
        </label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {BOARD_VIEW_SETTINGS_OPTIONS.paddingOptions.map((padding) => (
            <button
              key={padding}
              onClick={() => handleChange('questionContentPadding', padding)}
              className={`py-1.5 px-2 rounded text-[11px] font-bold transition-all border ${
                settings.questionContentPadding === padding
                  ? 'bg-gold-600 text-black border-gold-500'
                  : 'bg-black/40 text-zinc-400 border-zinc-700 hover:border-zinc-600'
              }`}
            >
              {padding}px
            </button>
          ))}
        </div>
        <p className="text-[11px] text-zinc-500 mt-1">Spacing around content area</p>
      </div>

      {/* Multiple Choice Column Mode */}
      <div>
        <label className="block text-xs uppercase text-zinc-400 font-bold mb-2 tracking-widest flex items-center gap-2">
          <Grid3x3 className="w-3.5 h-3.5" />
          Multiple Choice Layout
        </label>
        <div className="grid grid-cols-3 gap-2">
          {BOARD_VIEW_SETTINGS_OPTIONS.columnModeOptions.map((mode) => (
            <button
              key={mode}
              onClick={() => handleChange('multipleChoiceColumns', mode)}
              className={`py-2 px-3 rounded text-xs font-bold transition-all border ${
                settings.multipleChoiceColumns === mode
                  ? 'bg-gold-600 text-black border-gold-500 shadow-lg'
                  : 'bg-black/40 text-zinc-400 border-zinc-700 hover:border-zinc-600'
              }`}
            >
              {BOARD_VIEW_SETTINGS_OPTIONS.columnModeLabels[mode]}
            </button>
          ))}
        </div>
        <p className="text-[11px] text-zinc-500 mt-1">Controls how answer options are arranged</p>
      </div>

      {/* Info Box */}
      <div className="bg-blue-950/20 border border-blue-900/40 rounded-lg p-3 text-[11px] text-blue-200">
        <p className="font-bold mb-1">💡 Pro Tip</p>
        <p>These settings apply to question modals displayed during gameplay. Changes take effect immediately for new questions.</p>
      </div>
    </div>
  );
};

