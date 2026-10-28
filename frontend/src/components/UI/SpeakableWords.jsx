import React, { useState } from 'react';
import { Volume2 } from 'lucide-react';
import { speakWord, speechSupported } from '../../utils/speech';

const TONES = {
  amber: 'bg-warning-tint text-warning hover:brightness-95',
  rose: 'bg-danger-tint text-danger hover:brightness-95',
  slate: 'bg-surface-muted text-ink hover:brightness-95',
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
    <div className={`flex flex-wrap gap-2 ${className}`}>
      {list.map((w, idx) => (
        <button
          key={`${w}-${idx}`}
          type="button"
          disabled={!canSpeak}
          onClick={() => play(w, idx)}
          title={canSpeak ? `Hear "${w}"` : undefined}
          aria-label={`Hear the pronunciation of ${w}`}
          className={`inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg text-sm font-semibold transition ${canSpeak ? 'cursor-pointer' : 'cursor-default'} ${TONES[tone] || TONES.amber} ${playing === idx ? 'ring-2 ring-current' : ''}`}
        >
          {canSpeak && <Volume2 className={`w-3.5 h-3.5 shrink-0 ${playing === idx ? 'opacity-100' : 'opacity-70'}`} aria-hidden="true" />}
          <span>{w}</span>
        </button>
      ))}
    </div>
  );
}
export default SpeakableWords;
