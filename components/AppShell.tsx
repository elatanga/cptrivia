import React, { useState, useEffect, useRef } from 'react';
import { LogOut, Volume2, VolumeX, HelpCircle, Keyboard, ChevronUp, ChevronDown } from 'lucide-react';
import { soundService } from '../services/soundService';
import { ConnectionStatus } from './ConnectionStatus';
import { HelpModal } from './HelpModal';

// Realistic Champagne Bottle Icon (premium style)
const ChampagneBottleIcon: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    aria-label="Champagne Bottle"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
  >
    {/* Bottle foil/wrap */}
    <rect x="9.5" y="1.5" width="5" height="1.5" rx="0.3" fill="currentColor" opacity="0.8" />
    {/* Cork */}
    <rect x="10.5" y="2.8" width="3" height="2" rx="0.4" fill="currentColor" opacity="0.9" />
    {/* Neck */}
    <path d="M11 4.8 L10.5 6.5 L13.5 6.5 L13 4.8 Z" fill="currentColor" opacity="0.7" />
    {/* Bottle body - glass appearance */}
    <path d="M9.5 6.5 Q8 8 8.5 12 L8 16 Q8 18 10 20 L14 20 Q16 18 16 16 L15.5 12 Q16 8 14.5 6.5 Z"
          fill="currentColor" opacity="0.4" stroke="currentColor" strokeWidth="0.5" />
    {/* Bottle shine/highlight */}
    <ellipse cx="10.5" cy="10" rx="1" ry="4" fill="white" opacity="0.3" />
    {/* Bottom punt */}
    <ellipse cx="12" cy="20" rx="2" ry="0.5" fill="currentColor" opacity="0.6" />
  </svg>
);

// Realistic Champagne Flute Icon (premium style)
const ChampagneFlute: React.FC<{ className?: string }> = ({ className }) => (
  <svg
    aria-label="Champagne Flute"
    viewBox="0 0 24 24"
    fill="currentColor"
    className={className}
  >
    {/* Glass bowl - gradient illusion */}
    <path d="M7 3 L8 7 Q8 9 9 11 L15 11 Q16 9 16 7 L17 3"
          fill="currentColor" opacity="0.4" stroke="currentColor" strokeWidth="0.5" />
    {/* Glass shine */}
    <ellipse cx="9.5" cy="6" rx="1.2" ry="2.5" fill="white" opacity="0.4" />
    {/* Stem - thin line */}
    <line x1="11" y1="11" x2="11.5" y2="18" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
    {/* Base */}
    <ellipse cx="12" cy="19" rx="2.5" ry="1" fill="currentColor" opacity="0.5" stroke="currentColor" strokeWidth="0.5" />
    {/* Bubbles - champagne bubbles */}
    <circle cx="10" cy="7" r="0.4" fill="white" opacity="0.6" />
    <circle cx="13" cy="8" r="0.3" fill="white" opacity="0.5" />
    <circle cx="12" cy="9" r="0.35" fill="white" opacity="0.55" />
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
           <div className="flex items-center gap-2 min-w-0">
             <ChampagneBottleIcon className="w-4 h-4 md:w-5 md:h-5 text-gold-500/90 drop-shadow-[0_0_8px_rgba(255,215,0,0.25)]" />
             <div className="flex flex-col items-start leading-tight cursor-pointer hover:opacity-80 transition-opacity" onClick={() => soundService.playClick()}>
               <h1 className="text-xl md:text-2xl font-black tracking-tighter text-gold-300 font-sans">
                 CPJS
               </h1>
               <p className="text-[8px] md:text-[10px] font-bold tracking-widest uppercase text-gold-500/80">
                 CruzPham Jeopardy Studios
               </p>
             </div>
             <ChampagneFlute className="w-4 h-4 md:w-5 md:h-5 text-gold-400/95 drop-shadow-[0_0_8px_rgba(255,215,0,0.25)]" />
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
      <footer className="sticky bottom-0 lg:static flex-none bg-black/95 backdrop-blur-sm lg:bg-black z-40 border-t border-gold-900/30 flex flex-col lg:row items-center justify-between px-4 py-2 gap-3 min-h-[40px] pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        <div className="flex flex-col lg:flex-row items-center justify-between w-full gap-2">
            {/* Credits */}
            <div className="text-[9px] font-mono tracking-widest text-gray-600 uppercase flex flex-col md:flex-row items-center gap-1 md:gap-4 text-center md:text-left">
              <span>CREATED BY EL CRUZPHAM</span>
              <span className="hidden md:inline text-zinc-800">|</span>
              <span>POWERED BY CRUZPHAM AGENCY</span>
            </div>
            
            {/* Shortcuts Panel (Dynamic & Collapsible on Mobile) */}
            {shortcuts && (
              <div className="w-full lg:w-auto flex flex-col items-center">
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
            <div className="relative" ref={sliderRef}>
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
