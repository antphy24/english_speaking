import React, { useCallback, useState } from 'react';

// Reading text size the student can change with A- / A+.
// The choice is remembered on this device (shared by every mode that uses it).
const KEY = 'hrefspeak-reading-size';
export const READING_SIZES = [14, 15, 16, 18, 20, 22]; // px
const DEFAULT_INDEX = 2; // 16px

function load() {
  try {
    const i = Number(localStorage.getItem(KEY));
    return Number.isInteger(i) && i >= 0 && i < READING_SIZES.length && localStorage.getItem(KEY) !== null ? i : DEFAULT_INDEX;
  } catch {
    return DEFAULT_INDEX;
  }
}

/** `const { style, ...control } = useReadingSize();` then `<p style={style}>` and `<TextSizeControl {...control} />` */
export function useReadingSize() {
  const [index, setIndex] = useState(load);
  const change = useCallback((step) => {
    setIndex((i) => {
      const next = Math.max(0, Math.min(READING_SIZES.length - 1, i + step));
      try { localStorage.setItem(KEY, String(next)); } catch { /* not remembered */ }
      return next;
    });
  }, []);
  return {
    style: { fontSize: `${READING_SIZES[index]}px`, lineHeight: 1.7 },
    canShrink: index > 0,
    canGrow: index < READING_SIZES.length - 1,
    shrink: () => change(-1),
    grow: () => change(1),
  };
}

const BTN =
  'w-10 h-9 flex items-center justify-center text-ink-muted hover:text-ink hover:bg-surface-muted ' +
  'disabled:opacity-40 disabled:hover:bg-transparent disabled:cursor-not-allowed ' +
  'focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-ring';

export function TextSizeControl({ canShrink, canGrow, shrink, grow, className = '' }) {
  return (
    <div role="group" aria-label="Text size" className={`inline-flex items-stretch border border-line-strong rounded-lg overflow-hidden bg-surface shrink-0 ${className}`}>
      <button type="button" onClick={shrink} disabled={!canShrink} aria-label="Smaller text" title="Smaller text" className={BTN}>
        <span className="text-[13px] font-bold" aria-hidden="true">A-</span>
      </button>
      <span className="w-px bg-line-strong" aria-hidden="true" />
      <button type="button" onClick={grow} disabled={!canGrow} aria-label="Larger text" title="Larger text" className={BTN}>
        <span className="text-[17px] font-bold leading-none" aria-hidden="true">A+</span>
      </button>
    </div>
  );
}

export default TextSizeControl;
