import { useEffect, useState } from 'react';

const FALLBACK_VIEWPORT_WIDTH = 1280;

const getCurrentViewportWidth = () => {
  if (typeof window === 'undefined') return FALLBACK_VIEWPORT_WIDTH;
  return window.innerWidth || FALLBACK_VIEWPORT_WIDTH;
};

export const useViewportWidth = () => {
  const [viewportWidth, setViewportWidth] = useState(getCurrentViewportWidth);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;

    let frameId: number | null = null;
    const requestFrame = (cb: () => void) => {
      if (typeof window.requestAnimationFrame === 'function') return window.requestAnimationFrame(cb);
      return window.setTimeout(cb, 16);
    };
    const cancelFrame = (id: number) => {
      if (typeof window.cancelAnimationFrame === 'function') {
        window.cancelAnimationFrame(id);
        return;
      }
      window.clearTimeout(id);
    };

    const handleResize = () => {
      if (frameId !== null) cancelFrame(frameId);
      frameId = requestFrame(() => {
        setViewportWidth(window.innerWidth || FALLBACK_VIEWPORT_WIDTH);
      });
    };

    window.addEventListener('resize', handleResize);
    return () => {
      if (frameId !== null) cancelFrame(frameId);
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  return viewportWidth;
};

