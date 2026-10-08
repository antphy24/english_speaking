import React from 'react';

/**
 * Phones and tablets only: a compact timer + main button that stays at the top of the
 * screen while the student scrolls through notes. Hidden on wide screens, where the
 * full timer card is always visible beside the notes.
 */
export function PinnedBar({ time, tone = 'text-indigo-300', note, children }) {
  return (
    <div className="lg:hidden sticky top-2 z-30 bg-slate-900 border border-slate-700 rounded-2xl px-3 py-2 shadow-lg shadow-black/60">
      <div className="flex items-center gap-3">
        <div className={`font-mono font-bold text-2xl tracking-wider shrink-0 ${tone}`} aria-live="off">{time}</div>
        <div className="flex-1 min-w-0">{children}</div>
      </div>
      {note ? <p className="text-[11px] text-rose-400 mt-1.5 leading-snug">{note}</p> : null}
    </div>
  );
}
export default PinnedBar;
