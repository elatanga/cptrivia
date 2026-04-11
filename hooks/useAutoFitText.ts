import { RefObject, useEffect, useRef, useState } from 'react';

interface UseAutoFitTextOptions {
  minFontSizePx: number;
  maxFontSizePx: number;
  stepPx?: number;
  contentKey: string;
}

interface AutoFitResult {
  fontSizePx: number | null;
  lineHeight: number;
}

export function useAutoFitText(
  containerRef: RefObject<HTMLElement | null>,
  contentRef: RefObject<HTMLElement | null>,
  options: UseAutoFitTextOptions
): AutoFitResult {
  const { minFontSizePx, maxFontSizePx, contentKey, stepPx = 1 } = options;
  const [fontSizePx, setFontSizePx] = useState<number | null>(null);
  const [lineHeight, setLineHeight] = useState(1.16);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const content = contentRef.current;
    if (!container || !content) return;

    const fit = () => {
      const c = containerRef.current;
      const t = contentRef.current;
      if (!c || !t) return;

      let nextSize = maxFontSizePx;
      let nextLineHeight = 1.16;

      for (let size = maxFontSizePx; size >= minFontSizePx; size -= stepPx) {
        const candidateLineHeight = size <= minFontSizePx + 2 ? 1.1 : size < maxFontSizePx * 0.72 ? 1.12 : 1.16;
        t.style.fontSize = `${size}px`;
        t.style.lineHeight = `${candidateLineHeight}`;

        const fitsHeight = t.scrollHeight <= c.clientHeight;
        const fitsWidth = t.scrollWidth <= c.clientWidth;
        if (fitsHeight && fitsWidth) {
          nextSize = size;
          nextLineHeight = candidateLineHeight;
          break;
        }
      }

      setFontSizePx((prev) => (prev === nextSize ? prev : nextSize));
      setLineHeight(nextLineHeight);
    };

    const scheduleFit = () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(fit);
    };

    scheduleFit();

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(scheduleFit);
      resizeObserver.observe(container);
      resizeObserver.observe(content);
    } else {
      window.addEventListener('resize', scheduleFit);
    }

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      else window.removeEventListener('resize', scheduleFit);
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    };
  }, [containerRef, contentRef, minFontSizePx, maxFontSizePx, stepPx, contentKey]);

  return { fontSizePx, lineHeight };
}

