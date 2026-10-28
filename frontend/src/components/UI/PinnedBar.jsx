import React from 'react';

/**
 * Phones and tablets only: a compact timer + main button that stays at the top of the
 * screen while the student scrolls through notes. Hidden on wide screens, where the
 * full timer card is always visible beside the notes.
 * `tone` = text colour class for the time, e.g. 'text-danger'.
 */
export function PinnedBar({ time, tone = 'text-ink', note, children }) {
  return (
    <div className="lg:hidden sticky top-2 z-30 bg-surface border border-line rounded-2xl px-3 py-2.5 shadow-pop">
      <div className="flex items-center gap-3">
        <div className={`font-bold text-2xl tabular-nums shrink-0 ${tone}`} aria-live="off">{time}</div>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
      {note ? <p className="text-[13px] text-danger mt-1.5 leading-snug">{note}</p> : null}
    </div>
  );
}
export default PinnedBar;
