import React from 'react';
import { WifiOff, ShieldCheck } from 'lucide-react';
import Spinner from './Spinner';

function formatEta(seconds) {
  if (!seconds || seconds <= 0) return null;
  if (seconds < 60) return 'less than a minute';
  const minutes = Math.round(seconds / 60);
  return minutes === 1 ? 'about 1 minute' : `about ${minutes} minutes`;
}

function headline(progress) {
  if (!progress) return 'Processing...';
  if (progress.offline) return 'Reconnecting to the server...';
  switch (progress.phase) {
    case 'uploading':
      return 'Uploading your answer...';
    case 'queued':
      if (progress.position) return `You're #${progress.position} in line`;
      return progress.message || 'Waiting in line...';
    case 'transcribing':
      return 'Transcribing your speech...';
    case 'grading':
      return 'Grading your answer...';
    case 'waiting':
      return 'The AI is busy - you are still in line';
    default:
      return progress.message || 'Processing...';
  }
}

/** Friendly progress panel shown while a submission is being processed. */
export function SubmissionProgress({ progress, transcriptLabel = 'Your Speech Transcript' }) {
  const eta = formatEta(progress?.eta);
  const stageText = progress?.phase === 'queued' && progress?.stage
    ? (progress.stage === 'grade' ? 'Next step: grading' : 'Next step: transcription')
    : null;

  return (
    <div className="space-y-4">
      {progress?.transcript && (
        <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-xl">
          <span className="block text-xs text-indigo-400 font-semibold tracking-wider uppercase mb-1">{transcriptLabel}</span>
          <p className="text-sm italic text-white">"{progress.transcript}"</p>
        </div>
      )}
      <Spinner message={headline(progress)} />
      <div className="text-center space-y-2 -mt-4">
        {(eta || stageText) && (
          <p className="text-xs text-slate-400">
            {stageText}{stageText && eta ? ' · ' : ''}{eta ? `Estimated wait: ${eta}` : ''}
          </p>
        )}
        {progress?.phase === 'waiting' && progress?.message && (
          <p className="text-xs text-amber-300/90">{progress.message}</p>
        )}
        {progress?.offline && (
          <p className="text-xs text-amber-300 flex items-center justify-center gap-1.5">
            <WifiOff className="w-3.5 h-3.5" /> Connection problem - retrying automatically.
          </p>
        )}
        <p className="text-[11px] text-slate-500 flex items-center justify-center gap-1.5 max-w-md mx-auto">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500/80 shrink-0" />
          Your recording is saved. Please wait - even if it takes several minutes you will get your result.
          If the page is refreshed, it will continue where it left off.
        </p>
      </div>
    </div>
  );
}

export default SubmissionProgress;
