import React from 'react';
import SpeakableWords from './SpeakableWords';
import { CheckCircle2, RotateCcw, Lightbulb } from 'lucide-react';
import { Button } from './Button';

// One place that turns a 0-100 score into words and a colour
export function scoreBand(val) {
  if (val >= 85) return { label: 'Excellent', text: 'text-success', bar: 'bg-success', stroke: 'stroke-success' };
  if (val >= 70) return { label: 'Good', text: 'text-brand-ink', bar: 'bg-brand', stroke: 'stroke-brand' };
  if (val >= 50) return { label: 'Fair', text: 'text-warning', bar: 'bg-warning', stroke: 'stroke-warning' };
  return { label: 'Keep practising', text: 'text-danger', bar: 'bg-danger', stroke: 'stroke-danger' };
}

/** Circular 0-100 gauge. */
export function ScoreRing({ value, size = 112, label }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const r = 52;
  const c = 2 * Math.PI * r;
  const band = scoreBand(v);
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }}>
      <svg viewBox="0 0 120 120" className="w-full h-full -rotate-90" role="img" aria-label={`${label || 'Score'} ${Math.round(v)} out of 100`}>
        <circle cx="60" cy="60" r={r} className="stroke-surface-muted fill-none" strokeWidth="10" />
        <circle
          cx="60" cy="60" r={r}
          className={`${band.stroke} fill-none transition-all duration-1000 ease-out`}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - v / 100)}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[28px] font-bold text-ink tabular-nums" aria-hidden="true">
        {Math.round(v)}
      </span>
    </div>
  );
}

const TITLES = {
  read_aloud: 'Read Aloud result',
  qa: 'Q&A result',
  conversation: 'Conversation result',
};

function SubScores({ items }) {
  return (
    <div className="space-y-3.5">
      {items.map((item) => {
        const band = scoreBand(item.val);
        return (
          <div key={item.label} className="space-y-1.5">
            <div className="flex justify-between gap-3 text-sm">
              <span className="text-ink-muted font-medium">{item.label}</span>
              <span className="text-ink font-semibold tabular-nums">{item.val}<span className="text-ink-subtle font-normal"> / 100</span></span>
            </div>
            <div className="h-2 bg-surface-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-1000 ${band.bar}`}
                style={{ width: `${Math.max(0, Math.min(100, item.val))}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ScoreCard({ mode, score, onRestart, isSaving, saveStatus, onSaveToLeaderboard, nextAction }) {
  if (!score) return null;

  let main;
  let mainLabel;
  let parts = null;
  if (mode === 'read_aloud') {
    main = score.accuracy_score;
    mainLabel = 'Accuracy';
  } else {
    parts = mode === 'qa'
      ? [
          { label: 'Fluency & coherence', val: score.fluency },
          { label: 'Vocabulary', val: score.lexical_resource },
          { label: 'Grammar', val: score.grammatical_range },
          { label: 'Pronunciation', val: score.pronunciation },
        ]
      : [
          { label: 'Fluency & coherence', val: score.fluency_and_coherence },
          { label: 'Vocabulary', val: score.lexical_resource },
          { label: 'Grammar', val: score.grammatical_range },
          { label: 'Pronunciation', val: score.pronunciation },
          { label: 'Interaction', val: score.interactive_communication },
        ];
    main = Math.round(parts.reduce((a, b) => a + (Number(b.val) || 0), 0) / parts.length);
    mainLabel = 'Overall score';
  }
  const band = scoreBand(main);
  const skipped = score.skipped_words || [];
  const unclear = score.mispronounced_words || [];

  return (
    <section className="bg-surface border border-line rounded-2xl shadow-card animate-fadeIn" aria-label={TITLES[mode] || 'Result'}>
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 md:px-7 pt-5 md:pt-6">
        <div className="min-w-0">
          <SaveState isSaving={isSaving} saveStatus={saveStatus} />
          <h3 className="text-lg md:text-xl font-bold text-ink leading-snug mt-0.5">{TITLES[mode] || 'Your result'}</h3>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" icon={RotateCcw} onClick={onRestart}>Try again</Button>
          {nextAction}
        </div>
      </div>

      <div className="px-5 md:px-7 py-5 md:py-6 space-y-5">
        {/* Main score */}
        <div className="grid gap-4 md:grid-cols-12">
          <div className="md:col-span-5 flex items-center gap-5 p-4 md:p-5 border border-line rounded-2xl">
            <ScoreRing value={main} size={104} label={mainLabel} />
            <div className="min-w-0">
              <div className="text-[13px] font-semibold text-ink-muted">{mainLabel}</div>
              <div className={`text-xl font-bold ${band.text}`}>{band.label}</div>
              {mode === 'read_aloud' && score.word_error_rate != null && (
                <div className="text-[13px] text-ink-subtle mt-1">Word error rate {(score.word_error_rate * 100).toFixed(1)}%</div>
              )}
              {mode !== 'read_aloud' && <div className="text-[13px] text-ink-subtle mt-1">Scale 0 - 100</div>}
            </div>
          </div>

          {mode === 'read_aloud' ? (
            <div className="md:col-span-7 grid grid-cols-2 gap-4">
              <div className="p-4 md:p-5 border border-line rounded-2xl">
                <div className="text-[13px] font-semibold text-ink-muted">Unclear words</div>
                <div className={`text-[28px] font-bold tabular-nums leading-tight ${unclear.length ? 'text-warning' : 'text-success'}`}>{unclear.length}</div>
                <div className="text-[13px] text-ink-subtle">{unclear.length ? 'practise these below' : 'clear pronunciation'}</div>
              </div>
              <div className="p-4 md:p-5 border border-line rounded-2xl">
                <div className="text-[13px] font-semibold text-ink-muted">Skipped words</div>
                <div className={`text-[28px] font-bold tabular-nums leading-tight ${skipped.length ? 'text-danger' : 'text-success'}`}>{skipped.length}</div>
                <div className="text-[13px] text-ink-subtle">{skipped.length ? 'missed while reading' : 'nothing skipped'}</div>
              </div>
            </div>
          ) : (
            <div className="md:col-span-7 p-4 md:p-5 border border-line rounded-2xl">
              <SubScores items={parts} />
            </div>
          )}
        </div>

        {/* Words to practise (Read Aloud) */}
        {mode === 'read_aloud' && (unclear.length > 0 || skipped.length > 0) && (
          <div className="grid gap-4 md:grid-cols-2">
            {unclear.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-ink">Practise saying these</h4>
                <SpeakableWords words={unclear} tone="amber" className="md:max-h-32 md:overflow-y-auto" />
              </div>
            )}
            {skipped.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-semibold text-ink">You skipped</h4>
                <SpeakableWords words={skipped} tone="rose" className="md:max-h-32 md:overflow-y-auto" />
              </div>
            )}
            <p className="md:col-span-2 text-[13px] text-ink-subtle">Tap a word to hear how it is said.</p>
          </div>
        )}

        {/* Feedback */}
        {score.feedback && (
          <div className="flex gap-3 p-4 md:p-5 rounded-2xl bg-brand-tint">
            <Lightbulb className="w-5 h-5 text-brand-ink shrink-0 mt-0.5" aria-hidden="true" />
            <div className="min-w-0">
              <h4 className="text-[15px] font-semibold text-brand-ink">Feedback</h4>
              <p className="text-[15px] text-ink leading-relaxed whitespace-pre-wrap mt-1">{score.feedback}</p>
            </div>
          </div>
        )}

        {/* Saving failed: offer another try */}
        {saveStatus === 'error' && onSaveToLeaderboard && (
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-danger-tint">
            <p className="text-sm text-ink">Your result is shown, but it was not saved to your record yet.</p>
            <Button onClick={onSaveToLeaderboard} loading={isSaving}>Save again</Button>
          </div>
        )}
      </div>
    </section>
  );
}

function SaveState({ isSaving, saveStatus }) {
  if (isSaving) {
    return <span className="text-[13px] font-semibold text-ink-subtle">Saving to your record...</span>;
  }
  if (saveStatus === 'success') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold text-success">
        <CheckCircle2 className="w-4 h-4" aria-hidden="true" /> Saved to your record
      </span>
    );
  }
  return <span className="text-[13px] font-semibold text-brand-ink">Assessment complete</span>;
}

export default ScoreCard;
