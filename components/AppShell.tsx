import React, { useState, useEffect, useRef } from 'react';
import { LogOut, Volume2, VolumeX, HelpCircle, Keyboard, ChevronUp, ChevronDown } from 'lucide-react';
import { soundService } from '../services/soundService';
import { ConnectionStatus } from './ConnectionStatus';
import { HelpModal } from './HelpModal';
import {
  premiumCreditsContainerClass,
  premiumCreditsDividerClass,
  premiumCreditsTextPrimaryClass,
} from './premiumCreditsStyles';

// Ultra-realistic Champagne Bottle Icon (premium studio style)
const ChampagneBottleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    aria-label="Champagne Bottle"
    viewBox="0 0 24 24"
    className={className}
  >
    <defs>
      <linearGradient id="cpjsBottleFoil" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#fff8cf" />
        <stop offset="50%" stopColor="#f5c64b" />
        <stop offset="100%" stopColor="#bb7d13" />
      </linearGradient>
      <linearGradient id="cpjsBottleGlass" x1="8" y1="4" x2="16" y2="21">
        <stop offset="0%" stopColor="#f7e5a0" stopOpacity="0.9" />
        <stop offset="35%" stopColor="#d8ad45" stopOpacity="0.85" />
        <stop offset="100%" stopColor="#5e4614" stopOpacity="0.95" />
      </linearGradient>
      <radialGradient id="cpjsBottleSpec" cx="0.28" cy="0.26" r="0.9">
        <stop offset="0%" stopColor="#fffef3" stopOpacity="0.8" />
        <stop offset="100%" stopColor="#fffef3" stopOpacity="0" />
      </radialGradient>
    </defs>

    <rect x="10" y="1.4" width="4" height="1.5" rx="0.35" fill="url(#cpjsBottleFoil)" />
    <rect x="10.55" y="2.8" width="2.9" height="2.2" rx="0.4" fill="#d5a238" />
    <path d="M10.8 4.9 L10.4 6.7 L13.6 6.7 L13.2 4.9 Z" fill="url(#cpjsBottleFoil)" />
    <path d="M9.4 6.7 Q7.8 8.8 8.35 12.2 L7.95 16.25 Q8.1 18.9 10.05 20.7 L13.95 20.7 Q15.9 18.9 16.05 16.25 L15.65 12.2 Q16.2 8.8 14.6 6.7 Z" fill="url(#cpjsBottleGlass)" stroke="#f8de8d" strokeWidth="0.45" />
    <path d="M9.55 10.1 Q11.1 9.4 12.2 9.95 Q13.7 10.65 15.45 9.8" stroke="#fff7d3" strokeOpacity="0.45" strokeWidth="0.45" fill="none" />
    <ellipse cx="10.45" cy="11.7" rx="0.95" ry="4.5" fill="#fffdf1" opacity="0.35" />
    <path d="M8.65 8.3 Q9.9 7.6 11.55 7.75" stroke="url(#cpjsBottleSpec)" strokeWidth="0.7" strokeLinecap="round" fill="none" />
    <circle cx="12.95" cy="3.25" r="0.23" fill="#fff6d8" opacity="0.9" />
    <ellipse cx="12" cy="20.65" rx="2.05" ry="0.55" fill="#452f08" opacity="0.75" />
  </svg>
);

// Ultra-realistic Champagne Flute Icon (premium studio style)
const ChampagneFlute: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    aria-label="Champagne Flute"
    viewBox="0 0 24 24"
    className={className}
  >
    <defs>
      <linearGradient id="cpjsFluteChampagne" x1="8" y1="3" x2="16" y2="12">
        <stop offset="0%" stopColor="#fff4c7" stopOpacity="0.95" />
        <stop offset="100%" stopColor="#d79f2d" stopOpacity="0.9" />
      </linearGradient>
      <linearGradient id="cpjsFluteGlass" x1="7" y1="2.6" x2="16.8" y2="12.2">
        <stop offset="0%" stopColor="#fffbe8" stopOpacity="0.78" />
        <stop offset="100%" stopColor="#f3d8a2" stopOpacity="0.25" />
      </linearGradient>
    </defs>

    <path d="M7.35 3.1 L8.2 7.35 Q8.55 9.65 9.35 11.3 L14.65 11.3 Q15.45 9.65 15.8 7.35 L16.65 3.1" fill="url(#cpjsFluteChampagne)" stroke="#f4ddb0" strokeWidth="0.5" />
    <path d="M8.25 3.25 Q9.95 2.45 12 2.6 Q14.05 2.45 15.75 3.25" stroke="#fff9e2" strokeOpacity="0.55" strokeWidth="0.45" fill="none" />
    <path d="M7.35 3.1 L8.2 7.35 Q8.55 9.65 9.35 11.3 L14.65 11.3 Q15.45 9.65 15.8 7.35 L16.65 3.1" fill="none" stroke="url(#cpjsFluteGlass)" strokeWidth="0.45" />
    <ellipse cx="9.65" cy="6.7" rx="1.05" ry="2.9" fill="#ffffff" opacity="0.38" />
    <line x1="11.9" y1="11.3" x2="11.9" y2="17.9" stroke="#eec770" strokeWidth="0.85" strokeLinecap="round" />
    <ellipse cx="11.9" cy="19.05" rx="2.65" ry="0.92" fill="#c9932a" opacity="0.9" stroke="#f4ddb0" strokeWidth="0.45" />
    <circle cx="10.55" cy="8.05" r="0.34" fill="#fffdf4" opacity="0.85" />
    <circle cx="12.75" cy="7.2" r="0.26" fill="#fffdf4" opacity="0.8" />
    <circle cx="11.8" cy="8.9" r="0.3" fill="#fffdf4" opacity="0.82" />
  </svg>
);

interface AppShellProps {
  children: React.ReactNode;
  activeShowTitle?: string;
  username?: string | null;
  onLogout?: () => void;
  shortcuts?: React.ReactNode;
}

export const AppShell: React.FC<AppShellProps> = ({ children, activeShowTitle, username, onLogout, shortcuts }) => {
  const [muted, setMuted] = useState(soundService.getMute());
  const [volume, setVolume] = useState(soundService.getVolume());
  const [showVolSlider, setShowVolSlider] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [showShortcutsMobile, setShowShortcutsMobile] = useState(false);
  const sliderRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Close slider when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (sliderRef.current && !sliderRef.current.contains(event.target as Node)) {
        setShowVolSlider(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newVal = !muted;
    setMuted(newVal);
    soundService.setMute(newVal);
    if (!newVal) soundService.playClick(); // Feedback when unmutes
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    soundService.setVolume(val);
    if (muted && val > 0) {
      setMuted(false);
      soundService.setMute(false);
    }
  };

  return (
    <div className="min-h-screen lg:h-screen w-screen flex flex-col bg-black text-gold-100 lg:overflow-hidden relative selection:bg-gold-500 selection:text-black font-sans">
      {/* Background ambient glow */}
      <div className="absolute top-[-50%] left-[-50%] w-[200%] h-[200%] bg-[radial-gradient(circle_at_center,_var(--tw-gradient-stops))] from-gold-900/10 via-transparent to-transparent pointer-events-none z-0" />
      
      <ConnectionStatus />
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}

       {/* HEADER: Sticky on Mobile, Fixed on Desktop */}
       <header className="sticky top-0 lg:static flex-none h-14 md:h-16 z-40 bg-black/95 backdrop-blur-sm lg:bg-gradient-to-b lg:from-black lg:via-black/95 lg:to-transparent px-4 md:px-6 flex items-center justify-between border-b border-gold-900/30">
           {/* Left: Branding */}
           <div data-testid="brand-lockup" className="flex items-center gap-1 md:gap-1.5 min-w-0">
             <div className="w-3.5 md:w-4 flex justify-center">
               <ChampagneBottleIcon className="w-4 h-4 md:w-5 md:h-5 drop-shadow-[0_0_10px_rgba(255,215,0,0.35)]" />
             </div>
             <div data-testid="brand-title-stack" className="flex flex-col items-center text-center leading-none cursor-pointer hover:opacity-85 transition-opacity" onClick={() => soundService.playClick()}>
               <h1 className="text-xl md:text-2xl font-black tracking-[0.11em] text-gold-200 font-sans">
                 CPJS
               </h1>
               <p className="mt-0.5 inline-block origin-center whitespace-nowrap text-[8px] md:text-[9px] font-semibold tracking-[0.09em] text-gold-500/90 [transform:scaleX(0.6)] md:[transform:scaleX(0.64)]">
                 CruzPham Jeopardy Studios
               </p>
             </div>
             <div className="w-3.5 md:w-4 flex justify-center">
               <ChampagneFlute className="w-4 h-4 md:w-5 md:h-5 drop-shadow-[0_0_10px_rgba(255,215,0,0.35)]" />
             </div>
           </div>

          {/* Center: Show Title (Desktop) */}
          {activeShowTitle && (
            <div className="hidden lg:flex flex-col items-center absolute left-1/2 -translate-x-1/2 w-1/3">
               <h2 className="text-xs lg:text-sm font-bold uppercase tracking-[0.2em] text-gold-400 truncate w-full text-center">
                  SHOW: <span className="text-white">{activeShowTitle}</span>
               </h2>
            </div>
          )}

          {/* Right: User */}
          <div className="flex items-center gap-3 md:gap-4 flex-none">
            {username && (
              <>
                 <button 
                  onClick={() => { soundService.playClick(); setShowHelp(true); }}
                  className="text-zinc-500 hover:text-gold-500 transition-colors p-1"
                  title="Studio Guide"
                 >
                   <HelpCircle className="w-5 h-5" />
                 </button>
                 {onLogout && (
                  <>
                    <span className="text-zinc-500 font-mono text-[10px] hidden lg:inline">PRODUCER: <span className="text-gold-400">{username}</span></span>
                    <button 
                      onClick={() => { soundService.playClick(); onLogout(); }}
                      className="flex items-center gap-2 text-red-500 hover:text-red-400 transition-colors text-xs font-bold uppercase ml-1"
                    >
                      <LogOut className="w-4 h-4" /> <span className="hidden sm:inline">Logout</span>
                    </button>
                  </>
                 )}
              </>
            )}
          </div>
      </header>
      
      {/* Mobile Title Bar */}
      {activeShowTitle && (
        <div className="lg:hidden sticky top-14 flex-none py-1.5 bg-zinc-900/90 text-center border-b border-zinc-800 backdrop-blur-sm z-30">
           <span className="text-[10px] font-bold uppercase tracking-widest text-gold-400 truncate px-4 block">SHOW: {activeShowTitle}</span>
        </div>
      )}

      {/* CONTENT: Flex Grow, Scrollable on Mobile, Fixed on Desktop. Removed z-10 to fix child stacking contexts. */}
      <main className="flex-1 relative flex flex-col min-h-0 lg:overflow-hidden bg-black/50">
        {children}
      </main>

      {/* FOOTER: Sticky on Mobile, Fixed on Desktop */}
      <footer data-testid="app-footer" className="sticky bottom-0 lg:static flex-none bg-black/95 backdrop-blur-sm lg:bg-black z-40 border-t border-gold-900/30 flex flex-col lg:flex-row items-center justify-between px-4 py-2 gap-3 min-h-[40px] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div data-testid="footer-content-row" className="flex flex-col lg:flex-row lg:flex-wrap items-center lg:items-start justify-between w-full gap-2 md:gap-3 min-w-0">
            {/* Credits */}
            <div data-testid="footer-credits" className={`w-full lg:flex-1 min-w-0 ${premiumCreditsContainerClass} px-3 py-1.5 ${premiumCreditsTextPrimaryClass} flex flex-wrap items-center justify-center lg:justify-start gap-x-3 gap-y-1 text-center lg:text-left`}>
              <span data-testid="credit-created-by" className="whitespace-nowrap">Created by El CruzPham</span>
              <span className={premiumCreditsDividerClass} aria-hidden="true">•</span>
              <span data-testid="credit-powered-by" className="whitespace-nowrap">Powered by CruzPham Agency</span>
            </div>
            
            {/* Shortcuts Panel (Dynamic & Collapsible on Mobile) */}
            {shortcuts && (
              <div className="w-full lg:w-auto flex flex-col items-center shrink-0">
                {/* Mobile Toggle */}
                <button 
                  onClick={() => setShowShortcutsMobile(!showShortcutsMobile)}
                  className="lg:hidden flex items-center gap-2 px-3 py-1 bg-zinc-900/50 border border-zinc-800 rounded text-[10px] font-bold uppercase text-zinc-400 hover:text-white transition-colors mb-2"
                >
                  <Keyboard className="w-3 h-3" />
                  Shortcuts
                  {showShortcutsMobile ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
                </button>
                
                {/* Panel Container */}
                <div className={`${showShortcutsMobile ? 'block' : 'hidden'} lg:block w-full animate-in slide-in-from-bottom-1 fade-in`}>
                  {shortcuts}
                </div>
              </div>
            )}

            {/* Sound Controls */}
            <div className="relative shrink-0" ref={sliderRef}>
               <div
                 className="flex items-center gap-2 text-zinc-500 hover:text-gold-500 transition-colors text-[10px] uppercase font-bold tracking-wider cursor-pointer select-none bg-zinc-900/50 px-2 py-1 rounded"
                 onClick={() => setShowVolSlider(!showVolSlider)}
               >
                  {muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                  <span className="hidden sm:inline">Sound: {muted ? 'Off' : 'On'}</span>
               </div>

               {/* Volume Popover */}
               {showVolSlider && (
                 <div className="absolute bottom-full right-0 mb-2 bg-zinc-900 border border-gold-600/50 p-3 rounded shadow-xl flex flex-col items-center gap-2 min-w-[140px] animate-in slide-in-from-bottom-2 fade-in z-[100]">
                   <div className="flex justify-between w-full items-center mb-1">
                     <span className="text-[10px] text-zinc-400 uppercase font-bold">Volume</span>
                     <button onClick={toggleMute} className="text-gold-500 hover:text-white">
                        {muted ? <VolumeX className="w-3 h-3" /> : <Volume2 className="w-3 h-3" />}
                     </button>
                   </div>
                   <input 
                     type="range" 
                     min="0" 
                     max="1" 
                     step="0.05"
                     value={volume} 
                     onChange={handleVolumeChange}
                     className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-gold-500"
                   />
                   <div className="text-[9px] text-zinc-500 font-mono w-full text-right">{Math.round(volume * 100)}%</div>
                 </div>
               )}
            </div>
        </div>
      </footer>
    </div>
  );
};
