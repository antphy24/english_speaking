import React from 'react';
import { WifiOff, ShieldCheck, Check, Loader2 } from 'lucide-react';

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
      return 'Turning your speech into text...';
    case 'grading':
      return 'Checking your answer...';
    case 'waiting':
      return 'The AI is busy - you are still in line';
    default:
      return progress.message || 'Processing...';
  }
}

const STEPS = ['Upload recording', 'Speech to text', 'Score and feedback'];

/** Which of the three steps is happening now (0, 1 or 2). */
function currentStep(progress) {
  switch (progress?.phase) {
    case 'uploading':
      return 0;
    case 'transcribing':
      return 1;
    case 'grading':
      return 2;
    case 'queued':
    case 'waiting':
      return progress.stage === 'grade' ? 2 : 1;
    default:
      return 0;
  }
}

/** Friendly progress panel shown while a submission is being processed. */
export function SubmissionProgress({ progress, transcriptLabel = 'What you said' }) {
  const eta = formatEta(progress?.eta);
  const step = currentStep(progress);
  const waiting = progress?.phase === 'queued' || progress?.phase === 'waiting';

  return (
    <div className="space-y-4" aria-live="polite">
      <div className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-7">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-full bg-brand-tint text-brand flex items-center justify-center shrink-0">
            <Loader2 className="w-6 h-6 animate-spin" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-bold text-ink leading-snug">{headline(progress)}</h3>
            {eta && <p className="text-sm text-ink-muted mt-0.5">Estimated wait: {eta}</p>}
          </div>
        </div>

        <ol className="mt-5 grid gap-2.5 sm:grid-cols-3">
          {STEPS.map((label, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <li
                key={label}
                className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm ${
                  active ? 'bg-brand-tint text-brand-ink font-semibold' : done ? 'text-success' : 'text-ink-subtle'
                }`}
              >
                <span
                  className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-xs font-bold ${
                    done ? 'bg-success-tint' : active ? 'bg-surface' : 'bg-surface-muted'
                  }`}
                  aria-hidden="true"
                >
                  {done ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </span>
                <span>
                  {label}
                  {active && waiting ? ' (in line)' : ''}
                </span>
              </li>
            );
          })}
        </ol>

        {progress?.phase === 'waiting' && progress?.message && (
          <p className="mt-4 text-sm text-warning">{progress.message}</p>
        )}
        {progress?.offline && (
          <p className="mt-4 text-sm text-warning flex items-center gap-2">
            <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" /> Connection problem - retrying automatically.
          </p>
        )}

        <p className="mt-5 pt-4 border-t border-line text-[13px] text-ink-muted flex items-start gap-2">
          <ShieldCheck className="w-4 h-4 text-success shrink-0 mt-px" aria-hidden="true" />
          <span>
            Your recording is saved. Please wait - even if it takes several minutes you will get your result.
            If the page is refreshed, it continues where it left off.
          </span>
        </p>
      </div>

      {progress?.transcript && (
        <div className="bg-surface border border-line rounded-2xl p-5">
          <span className="block text-[13px] font-semibold text-ink-muted mb-1.5">{transcriptLabel}</span>
          <p className="text-[15px] text-ink leading-relaxed">“{progress.transcript}”</p>
        </div>
      )}
    </div>
  );
}

export default SubmissionProgress;
