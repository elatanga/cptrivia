import React, { useMemo, useRef } from 'react';
import { useAutoFitText } from '../hooks/useAutoFitText';

interface Props {
  text: string;
  className?: string;
  containerClassName?: string;
  minFontSizePx: number;
  maxFontSizePx: number;
  clampVw?: number;
  testId?: string;
}

export const AutoFitText: React.FC<Props> = ({
  text,
  className,
  containerClassName,
  minFontSizePx,
  maxFontSizePx,
  clampVw = 4,
  testId
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLParagraphElement>(null);

  const { fontSizePx, lineHeight } = useAutoFitText(containerRef, contentRef, {
    minFontSizePx,
    maxFontSizePx,
    contentKey: text,
    stepPx: 1
  });

  const fontStyle = useMemo(() => {
    if (fontSizePx === null) {
      return {
        fontSize: `clamp(${minFontSizePx}px, ${clampVw}vw, ${maxFontSizePx}px)`,
        lineHeight
      };
    }
    return {
      fontSize: `${fontSizePx}px`,
      lineHeight
    };
  }, [fontSizePx, lineHeight, minFontSizePx, maxFontSizePx, clampVw]);

  return (
    <div ref={containerRef} className={`min-h-0 min-w-0 overflow-hidden ${containerClassName || ''}`}>
      <p
        ref={contentRef}
        data-testid={testId}
        className={`break-words [overflow-wrap:anywhere] [word-break:break-word] [hyphens:auto] ${className || ''}`}
        style={fontStyle}
      >
        {text}
      </p>
    </div>
  );
};

