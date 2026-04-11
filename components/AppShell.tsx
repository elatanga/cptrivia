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

// Blue/gold broadcast-style champagne bottle mark for CPJS lockup
const ChampagneBottleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    aria-label="Champagne Bottle"
    viewBox="0 0 44 64"
    className={className}
  >
    <defs>
      <linearGradient id="cpjsBottleFoil" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#fff7cb" />
        <stop offset="45%" stopColor="#f8cf62" />
        <stop offset="100%" stopColor="#ab6c10" />
      </linearGradient>
      <linearGradient id="cpjsBottleGlass" x1="11" y1="13" x2="33" y2="62">
        <stop offset="0%" stopColor="#173130" />
        <stop offset="55%" stopColor="#041314" />
        <stop offset="100%" stopColor="#010809" />
      </linearGradient>
      <linearGradient id="cpjsBottleRim" x1="8" y1="36" x2="36" y2="36">
        <stop offset="0%" stopColor="#9b6209" />
        <stop offset="50%" stopColor="#f2c85e" />
        <stop offset="100%" stopColor="#8f5808" />
      </linearGradient>
      <radialGradient id="cpjsBottleSpec" cx="0.15" cy="0.18" r="0.75">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.65" />
        <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
      </radialGradient>
    </defs>

    <rect x="18" y="1.8" width="8" height="3" rx="1" fill="url(#cpjsBottleFoil)" />
    <rect x="18.8" y="4.5" width="6.4" height="6" rx="1.1" fill="url(#cpjsBottleFoil)" />
    <path d="M17.8 10.5 L16.4 14.5 H27.6 L26.2 10.5 Z" fill="url(#cpjsBottleFoil)" />
    <path d="M14.1 14.2 Q8.8 21 10 34.8 L8.6 49.5 Q8.7 58.4 15.2 63 H28.8 Q35.3 58.4 35.4 49.5 L34 34.8 Q35.2 21 29.9 14.2 Z" fill="url(#cpjsBottleGlass)" stroke="#f5d276" strokeWidth="1" />
    <rect x="11.8" y="35.6" width="20.4" height="9.8" rx="1.4" fill="#101214" stroke="url(#cpjsBottleRim)" strokeWidth="1.2" />
    <path d="M13 27.2 Q22 23.9 31 27.2" stroke="#f6da8e" strokeOpacity="0.55" strokeWidth="1.1" fill="none" />
    <ellipse cx="17.1" cy="32" rx="2.4" ry="16" fill="#fffffb" opacity="0.24" />
    <path d="M12.2 18.3 Q18.7 14.8 25.7 16.8" stroke="url(#cpjsBottleSpec)" strokeWidth="1.5" strokeLinecap="round" fill="none" />
    <ellipse cx="22" cy="63" rx="8.7" ry="1" fill="#000" opacity="0.42" />
  </svg>
);

// Blue/gold broadcast-style champagne flute mark for CPJS lockup
const ChampagneFlute: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    aria-label="Champagne Flute"
    viewBox="0 0 44 64"
    className={className}
  >
    <defs>
      <linearGradient id="cpjsFluteChampagne" x1="14" y1="8" x2="30" y2="33">
        <stop offset="0%" stopColor="#fff4cc" stopOpacity="0.95" />
        <stop offset="100%" stopColor="#d29b1f" stopOpacity="0.9" />
      </linearGradient>
      <linearGradient id="cpjsFluteGlass" x1="10" y1="6" x2="33" y2="36">
        <stop offset="0%" stopColor="#ffffff" stopOpacity="0.65" />
        <stop offset="100%" stopColor="#fae3b8" stopOpacity="0.22" />
      </linearGradient>
    </defs>

    <path d="M12.8 6.4 L15.1 23.8 Q16 30.5 20.2 34.8 H23.8 Q28 30.5 28.9 23.8 L31.2 6.4" fill="url(#cpjsFluteChampagne)" stroke="#f6deab" strokeWidth="1" />
    <path d="M13.4 6.8 Q18.1 4.7 22 5.3 Q25.9 4.7 30.6 6.8" stroke="#fff8df" strokeOpacity="0.5" strokeWidth="1" fill="none" />
    <path d="M12.8 6.4 L15.1 23.8 Q16 30.5 20.2 34.8 H23.8 Q28 30.5 28.9 23.8 L31.2 6.4" fill="none" stroke="url(#cpjsFluteGlass)" strokeWidth="1" />
    <ellipse cx="18.2" cy="20" rx="2.1" ry="11" fill="#ffffff" opacity="0.3" />
    <line x1="22" y1="34.8" x2="22" y2="54.2" stroke="#e9bb59" strokeWidth="1.6" strokeLinecap="round" />
    <ellipse cx="22" cy="57.2" rx="9.7" ry="2.9" fill="#c88f23" opacity="0.95" stroke="#f5ddb3" strokeWidth="1" />
    <circle cx="18.8" cy="22.2" r="0.8" fill="#fffced" opacity="0.82" />
    <circle cx="24.7" cy="17.7" r="0.65" fill="#fffced" opacity="0.75" />
    <circle cx="22.5" cy="24.4" r="0.7" fill="#fffced" opacity="0.8" />
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
           <div data-testid="brand-lockup" className="flex items-center gap-0 min-w-0 rounded-lg border border-[#4a67db]/45 px-1.5 py-0.5 bg-[radial-gradient(circle_at_50%_35%,rgba(75,129,255,0.34),rgba(10,20,64,0.82)_70%)] shadow-[inset_0_0_18px_rgba(85,129,255,0.35),0_0_22px_rgba(18,51,140,0.35)]">
             <div className="flex justify-center shrink-0">
               <ChampagneBottleIcon className="w-4 h-5 md:w-5 md:h-6 drop-shadow-[0_0_10px_rgba(255,214,118,0.5)]" />
             </div>
             <button
               type="button"
               data-testid="brand-wordmark-stack"
               aria-label="CPJS logo"
                className="group relative min-w-0 inline-flex w-fit flex-col items-center text-center leading-none pb-[0.72rem] md:pb-[0.9rem] hover:opacity-90 transition-opacity"
               onClick={() => soundService.playClick()}
             >
               <h1
                  className="text-[20px] md:text-[27px] font-black tracking-[0.04em] leading-none text-transparent bg-clip-text bg-gradient-to-b from-[#fff5c8] via-[#f9d36d] to-[#b87412] [text-shadow:0_1px_0_rgba(255,246,197,0.6),0_5px_14px_rgba(245,188,69,0.44)]"
               >
                 CPJS
               </h1>
               <span
                 data-testid="brand-gold-divider"
                  className="absolute bottom-[0.45rem] md:bottom-[0.58rem] left-1/2 -translate-x-1/2 h-px w-full max-w-full bg-gradient-to-r from-transparent via-[#f1c14f] to-transparent"
                 aria-hidden="true"
               />
               <p
                 data-testid="brand-subtitle"
                   className="absolute bottom-0 left-1/2 -translate-x-1/2 w-full max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-[7px] md:text-[8px] font-semibold italic tracking-[0.01em] text-[#f0cb74] [text-shadow:0_1px_8px_rgba(244,196,87,0.24)]"
               >
                 CruzPham Jeopardy Studios
               </p>
             </button>
             <div className="flex justify-center shrink-0">
               <ChampagneFlute className="w-4 h-5 md:w-5 md:h-6 drop-shadow-[0_0_10px_rgba(255,214,118,0.5)]" />
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
