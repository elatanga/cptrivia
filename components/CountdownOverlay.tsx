import React, { useEffect, useState } from 'react';
import { soundService } from '../services/soundService';

interface Props {
  duration: number;
  onComplete: () => void;
  onStop: () => void;
}

export const CountdownOverlay: React.FC<Props> = ({ duration, onComplete, onStop }) => {
  const [timeLeft, setTimeLeft] = useState(duration);
  const [isStopped, setIsStopped] = useState(false);
  const [completionSent, setCompletionSent] = useState(false);

  useEffect(() => {
    if (isStopped) return;
    const interval = window.setInterval(() => {
      setTimeLeft((prev) => Math.max(0, prev - 1));
    }, 1000);

    return () => clearInterval(interval);
  }, [isStopped]);

  useEffect(() => {
    if (isStopped) return;
    if (timeLeft > 0 && timeLeft <= 3) {
      soundService.playTimerTick();
      return;
    }
    if (timeLeft === 0 && !completionSent) {
      setCompletionSent(true);
      soundService.playTimerAlarm();
      onComplete();
    }
  }, [timeLeft, isStopped, completionSent, onComplete]);

  const handleStop = () => {
    setIsStopped(true);
    onStop();
  };

  const percentage = (timeLeft / duration) * 100;
  const isLowTime = timeLeft <= 3;

  return (
    <div className="fixed inset-0 flex items-center justify-center z-[10001] pointer-events-none">
      <div className="relative w-40 h-40 md:w-56 md:h-56 flex items-center justify-center pointer-events-auto">
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
            className={`transition-all duration-100 ${isLowTime ? 'animate-pulse' : ''}`}
          />
        </svg>

        {/* Time display */}
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <div
            className={`text-5xl md:text-7xl font-black font-mono tabular-nums transition-all duration-100 drop-shadow-lg ${
              isLowTime ? 'text-red-500 animate-pulse' : 'text-gold-400'
            }`}
          >
            {timeLeft}
          </div>
          <div className="text-xs md:text-sm font-bold uppercase tracking-widest text-zinc-400 mt-2">
            {isStopped ? 'Stopped' : 'Sec'}
          </div>
        </div>

        {/* Stop button */}
        {!isStopped && (
          <button
            onClick={handleStop}
            className="absolute -bottom-12 left-1/2 transform -translate-x-1/2 px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-xs font-black uppercase rounded-lg transition-colors active:scale-95"
            title="Stop countdown"
          >
            Stop
          </button>
        )}
      </div>
    </div>
  );
};

