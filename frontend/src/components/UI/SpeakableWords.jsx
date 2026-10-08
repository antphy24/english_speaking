import React, { useState } from 'react';
import { Volume2 } from 'lucide-react';
import { speakWord, speechSupported } from '../../utils/speech';

const TONES = {
  amber: 'bg-amber-500/10 text-amber-300 border-amber-500/20 hover:bg-amber-500/25 active:bg-amber-500/30',
  rose: 'bg-rose-500/10 text-rose-300 border-rose-500/20 hover:bg-rose-500/25 active:bg-rose-500/30',
  slate: 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700 active:bg-slate-600',
};

/** A list of words; tap any word to hear its correct (American English) pronunciation. */
export function SpeakableWords({ words, tone = 'amber', className = '' }) {
  const [playing, setPlaying] = useState(null);
  const canSpeak = speechSupported();
  const list = (Array.isArray(words) ? words : []).filter(Boolean);
  if (!list.length) return null;

  const play = (word, idx) => {
    setPlaying(idx);
    const done = () => setPlaying((current) => (current === idx ? null : current));
    if (!speakWord(word, { onEnd: done })) done();
  };

  return (
    <div className={`flex flex-wrap gap-1.5 ${className}`}>
      {list.map((w, idx) => (
        <button
          key={`${w}-${idx}`}
          type="button"
          disabled={!canSpeak}
          onClick={() => play(w, idx)}
          title={canSpeak ? `Hear "${w}"` : undefined}
          aria-label={`Hear the pronunciation of ${w}`}
          className={`inline-flex items-center gap-1 text-xs px-2.5 py-2 md:px-2 md:py-1 border rounded-md font-medium transition-colors ${canSpeak ? 'cursor-pointer' : 'cursor-default'} ${TONES[tone] || TONES.amber} ${playing === idx ? 'ring-1 ring-white/60' : ''}`}
        >
          {canSpeak && <Volume2 className={`w-3 h-3 shrink-0 ${playing === idx ? 'opacity-100' : 'opacity-60'}`} />}
          <span>{w}</span>
        </button>
      ))}
    </div>
  );
}
export default SpeakableWords;
