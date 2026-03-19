import React from 'react';

interface Props {
  durationSeconds: number;
  remainingSeconds: number;
  isRunning: boolean;
  onRestart: () => void;
  onStop: () => void;
}

const CountdownOverlayComponent: React.FC<Props> = ({
  durationSeconds,
  remainingSeconds,
  isRunning,
  onRestart,
  onStop
}) => {
  const safeDuration = Math.max(1, durationSeconds);
  const safeRemaining = Math.max(0, remainingSeconds);
  const percentage = (safeRemaining / safeDuration) * 100;
  const isLowTime = safeRemaining <= 3 && isRunning;

  return (
    <div className="fixed right-3 top-20 md:top-24 md:right-6 z-[10001] pointer-events-none" data-testid="question-countdown-overlay">
      <div className="relative w-36 h-36 md:w-48 md:h-48 flex items-center justify-center pointer-events-auto">
        {/* Background circle with gradient */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke="rgba(0, 0, 0, 0.6)"
            strokeWidth="2"
          />
          <circle
            cx="50"
            cy="50"
            r="45"
            fill="none"
            stroke={isLowTime ? 'rgba(239, 68, 68, 0.8)' : 'rgba(124, 179, 66, 0.8)'}
            strokeWidth="3"
            strokeDasharray={`${(percentage / 100) * 282.7} 282.7`}
            strokeLinecap="round"
            className={isLowTime ? 'animate-pulse' : ''}
          />
        </svg>

        {/* Time display */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div
            className={`text-4xl md:text-6xl font-black font-mono tabular-nums drop-shadow-lg ${
              isLowTime ? 'text-red-500 animate-pulse' : 'text-gold-400'
            }`}
          >
            {safeRemaining}
          </div>
          <div className="text-xs md:text-sm font-bold uppercase tracking-widest text-zinc-400 mt-2">
            {isRunning ? 'Sec' : 'Stopped'}
          </div>
        </div>

        {/* Controls */}
        <div className="absolute -bottom-14 left-1/2 transform -translate-x-1/2 flex items-center gap-2">
          <button
            onClick={onRestart}
            className="px-3 py-2 bg-gold-600 hover:bg-gold-500 text-black text-[11px] font-black uppercase rounded-lg transition-colors active:scale-95"
            title="Restart countdown"
          >
            Restart
          </button>
          <button
            onClick={onStop}
            className="px-3 py-2 bg-red-600 hover:bg-red-500 text-white text-[11px] font-black uppercase rounded-lg transition-colors active:scale-95"
            title="Stop countdown"
          >
            Stop
          </button>
        </div>
      </div>
    </div>
  );
};

export const CountdownOverlay = React.memo(CountdownOverlayComponent);

