import React from 'react';
import { Clock, AlertTriangle, CheckCircle2, Info } from 'lucide-react';

// Free Groq Whisper allows ~7,200 audio-seconds per hour per model; the app uses two
// models with a 15% safety margin -> ~12,240 seconds of student audio per hour.
const AUDIO_SECONDS_PER_HOUR = 12240;
const WORDS_PER_MINUTE = 100; // typical reading-aloud pace for students
const MIN_BILLED_SECONDS = 10; // Groq bills at least 10 seconds per recording

function formatDuration(seconds) {
  if (seconds < 60) return `${Math.max(5, Math.round(seconds / 5) * 5)} seconds`;
  const minutes = seconds / 60;
  return minutes < 1.75 ? 'about 1 minute' : `about ${Math.round(minutes)} minutes`;
}

/** Word count, reading time and class-size guidance for Read Aloud passages. */
export function ReadingLengthHint({ text }) {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length;
  if (words === 0) return null;

  const seconds = (words / WORDS_PER_MINUTE) * 60;
  const perHour = Math.floor(AUDIO_SECONDS_PER_HOUR / Math.max(MIN_BILLED_SECONDS, seconds));
  const hasDigits = /\d/.test(text);

  let tone, Icon, advice;
  if (words < 15) {
    tone = 'text-amber-300 border-amber-500/20 bg-amber-500/10';
    Icon = AlertTriangle;
    advice = 'Very short: a single mistake changes the score a lot. Aim for at least 30 words.';
  } else if (words <= 80) {
    tone = 'text-emerald-300 border-emerald-500/20 bg-emerald-500/10';
    Icon = CheckCircle2;
    advice = 'Good length for whole-school sessions: hundreds of students can get results within minutes.';
  } else if (words <= 150) {
    tone = 'text-sky-300 border-sky-500/20 bg-sky-500/10';
    Icon = Info;
    advice = 'Good for class sessions. With 200+ students at once, some will wait longer for results.';
  } else {
    tone = 'text-amber-300 border-amber-500/20 bg-amber-500/10';
    Icon = AlertTriangle;
    advice = 'Long passage: best for small groups or homework. With hundreds of students at once, results can take over an hour.';
  }

  return (
    <div className={`mt-2 p-2.5 rounded-lg border text-[11px] leading-relaxed space-y-1 ${tone}`}>
      <div className="flex items-center gap-1.5 font-semibold">
        <Clock className="w-3.5 h-3.5 shrink-0" />
        <span>
          {words} words · {formatDuration(seconds)} to read · about {perHour.toLocaleString()} students graded per hour
        </span>
      </div>
      <div className="flex items-start gap-1.5">
        <Icon className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>{advice}</span>
      </div>
      {hasDigits && (
        <div className="flex items-start gap-1.5 text-amber-200">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>Contains numbers: write them as words (e.g. "nineteen ninety") so correct readings are not marked wrong.</span>
        </div>
      )}
    </div>
  );
}

export default ReadingLengthHint;
