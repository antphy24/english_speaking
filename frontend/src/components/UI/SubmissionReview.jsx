import React, { useEffect, useState } from 'react';
import { X, Headphones, FileText, MessageSquareText, Loader2, AlertTriangle } from 'lucide-react';
import { getAssessmentReview } from '../../utils/api';
import SpeakableWords from './SpeakableWords';
import { MODE_LABELS } from '../../utils/modes';

const MODE_TITLES = MODE_LABELS;

const AUDIO_LABELS = {
  read_aloud: 'Recording',
  qa: 'Recording',
  debate: 'Speech',
  mattering: 'Argument',
  mattering_rebuttal: 'Rebuttal',
};
const AUDIO_ORDER = ['read_aloud', 'qa', 'debate', 'mattering', 'mattering_rebuttal'];

const has = (v) => v !== undefined && v !== null && v !== '';

/** Headline score + the smaller sub-scores, per mode. */
function scoreSummary(mode, score, fb) {
  if (mode === 'read_aloud') {
    return {
      main: `${Math.round(score)}%`, caption: 'words read correctly',
      parts: has(fb.word_error_rate) ? [['Word error rate', `${Math.round(fb.word_error_rate * 100)}%`]] : [],
    };
  }
  if (mode === 'debate') {
    return {
      main: `${Math.round(score)}`, caption: 'out of 100',
      parts: [['Matter', fb.matter_score], ['Manner', fb.manner_score], ['Method', fb.method_score]]
        .filter(([, v]) => has(v)).map(([k, v]) => [k, `${v}/10`]),
    };
  }
  if (mode === 'mattering') {
    return { main: `${Math.round(score)}`, caption: `speaker score · scale 69-81${fb.band ? ` · ${fb.band}` : ''}`, parts: [] };
  }
  const parts = mode === 'qa'
    ? [['Fluency', fb.fluency], ['Vocabulary', fb.lexical_resource], ['Grammar', fb.grammatical_range], ['Pronunciation', fb.pronunciation]]
    : [['Fluency & coherence', fb.fluency_and_coherence], ['Vocabulary', fb.lexical_resource], ['Grammar', fb.grammatical_range],
       ['Pronunciation', fb.pronunciation], ['Interaction', fb.interactive_communication]];
  return { main: `${Math.round(score)}`, caption: 'out of 100', parts: parts.filter(([, v]) => has(v)) };
}

/** Feedback paragraphs, per mode: [heading, text]. */
function feedbackBlocks(mode, fb) {
  // Word lists stay as arrays so each word can be tapped to hear it
  const words = (list) => (Array.isArray(list) && list.length ? list : '');
  let blocks;
  if (mode === 'debate') {
    blocks = [['Overall', fb.overall_feedback], ['Matter', fb.matter_feedback], ['Manner', fb.manner_feedback], ['Method', fb.method_feedback]];
  } else if (mode === 'mattering') {
    blocks = [['Overall', fb.overall_feedback], ['Your argument', fb.argument_feedback], ['Your rebuttal', fb.rebuttal_feedback],
              ['Read up on', fb.knowledge_gaps]];
  } else if (mode === 'read_aloud') {
    blocks = [['Feedback', fb.feedback], ['Skipped words', words(fb.skipped_words)], ['Unclear words', words(fb.mispronounced_words)]];
  } else {
    blocks = [['Feedback', fb.feedback]];
  }
  return blocks.filter(([, text]) => has(text));
}

function Section({ icon: Icon, title, children }) {
  return (
    <section className="space-y-2">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-ink">
        <Icon className="w-4 h-4 text-ink-subtle" aria-hidden="true" /><span>{title}</span>
      </h4>
      {children}
    </section>
  );
}

/**
 * Review one saved attempt: recording, transcript, score and feedback.
 * `assessment` is a row of public.assessments (id, mode, score, feedback, created_at).
 * `authClient` is the Supabase client of whoever is looking (defaults to the student's).
 * Pass `assessment={null}` with `emptyMessage` when there is nothing to show yet.
 */
export function SubmissionReview({ assessment, apiBase, authClient, onClose, heading = 'Last submission', studentName, emptyMessage }) {
  const [review, setReview] = useState(null);
  const [loading, setLoading] = useState(!!assessment);
  const [loadError, setLoadError] = useState('');
  const [brokenAudio, setBrokenAudio] = useState({});

  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const assessmentId = assessment?.id;
  useEffect(() => {
    if (!assessmentId) return undefined;
    let cancelled = false;
    setLoading(true);
    setLoadError('');
    setReview(null);
    setBrokenAudio({});
    getAssessmentReview(apiBase, assessmentId, authClient)
      .then((data) => { if (!cancelled) setReview(data); })
      .catch((err) => { if (!cancelled) setLoadError(err.message || 'Could not load the recording.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiBase, assessmentId, authClient]);

  const mode = assessment?.mode;
  const fb = assessment && typeof assessment.feedback === 'object' && assessment.feedback ? assessment.feedback : {};
  const summary = assessment ? scoreSummary(mode, assessment.score ?? 0, fb) : null;
  const blocks = assessment ? feedbackBlocks(mode, fb) : [];
  const material = fb.material_title || fb.motion;
  // The student's own row already carries the transcript, so it shows without waiting for the server.
  const transcript = assessment?.transcript || review?.transcript || fb.transcript;
  const clips = AUDIO_ORDER.filter((slot) => review?.audio?.[slot] && !brokenAudio[slot]);
  const hadAudio = review?.audio_replaced || Object.keys(brokenAudio).length > 0;

  let audioNote = '';
  if (!loading && clips.length === 0) {
    if (loadError) audioNote = loadError;
    else if (mode === 'conversation') audioNote = 'Recordings are not kept for Conversation - the full conversation is below.';
    else if (hadAudio) audioNote = 'The recording for this attempt is no longer available - only the most recent one per mode is kept.';
    else audioNote = 'No recording was stored for this attempt.';
  }

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-start sm:items-center justify-center p-2 sm:p-4 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={heading}
    >
      <div className="fixed inset-0 bg-[rgb(16_24_40/0.5)] pointer-events-none" />
      <div className="relative w-full max-w-2xl bg-surface text-ink border border-line rounded-2xl shadow-pop my-auto">
        <div className="flex items-start justify-between gap-3 px-5 md:px-6 py-4 border-b border-line">
          <div className="min-w-0">
            <span className="text-[13px] font-semibold text-brand-ink">
              {heading}{mode ? ` · ${MODE_TITLES[mode] || mode}` : ''}
            </span>
            <h3 className="text-lg font-bold text-ink truncate">
              {studentName || material || (assessment ? 'Your attempt' : 'Nothing here yet')}
            </h3>
            {assessment && (
              <p className="text-[13px] text-ink-subtle mt-0.5">
                {studentName && material ? `${material} · ` : ''}{new Date(assessment.created_at).toLocaleString()}
                {fb.role ? ` · ${fb.role}` : ''}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="w-11 h-11 -mr-2 flex items-center justify-center rounded-[10px] text-ink-subtle hover:text-ink hover:bg-surface-muted transition shrink-0"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {!assessment ? (
          <p className="px-6 py-12 text-center text-[15px] text-ink-muted">
            {emptyMessage || 'No saved attempt yet. Finish one and it will appear here.'}
          </p>
        ) : (
          <div className="px-5 md:px-6 py-5 space-y-6 max-h-[80dvh] md:max-h-[75vh] overflow-y-auto overscroll-contain">
            {/* Score */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4 border border-line rounded-2xl">
              <div>
                <div className="text-4xl font-bold text-ink leading-none tabular-nums">{summary.main}</div>
                <div className="text-[13px] text-ink-subtle mt-1.5">{summary.caption}</div>
              </div>
              {summary.parts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {summary.parts.map(([label, value]) => (
                    <div key={label} className="px-3 py-2 bg-surface-muted rounded-xl">
                      <div className="text-xs text-ink-subtle">{label}</div>
                      <div className="text-sm font-bold text-ink tabular-nums">{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recording */}
            <Section icon={Headphones} title="Recording">
              {loading && (
                <p className="flex items-center gap-2 text-sm text-ink-muted">
                  <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /><span>Loading the recording...</span>
                </p>
              )}
              {clips.map((slot) => (
                <div key={slot} className="space-y-1">
                  {clips.length > 1 && <span className="text-[13px] text-ink-muted">{AUDIO_LABELS[slot]}</span>}
                  <audio
                    controls
                    preload="auto"
                    src={review.audio[slot]}
                    onError={() => setBrokenAudio((prev) => ({ ...prev, [slot]: true }))}
                    className="w-full h-10"
                  />
                </div>
              ))}
              {audioNote && (
                <p className={`flex items-start gap-2 text-[13px] ${loadError ? 'text-warning' : 'text-ink-subtle'}`}>
                  {loadError && <AlertTriangle className="w-4 h-4 mt-px shrink-0" aria-hidden="true" />}
                  <span>{audioNote}</span>
                </p>
              )}
            </Section>

            {/* Transcript */}
            <Section icon={FileText} title={mode === 'conversation' ? 'Conversation' : 'What the AI heard'}>
              {has(transcript) ? (
                <p className="text-[15px] text-ink leading-relaxed bg-surface-muted rounded-xl p-4 whitespace-pre-wrap">
                  {transcript}
                </p>
              ) : (
                <p className="text-[13px] text-ink-subtle">
                  {loading ? 'Loading...' : 'No transcript was saved for this attempt.'}
                </p>
              )}
            </Section>

            {/* Feedback */}
            <Section icon={MessageSquareText} title="Feedback">
              <div className="space-y-4">
              {blocks.length === 0 && <p className="text-[13px] text-ink-subtle">No written feedback was saved.</p>}
              {blocks.map(([label, text]) => (
                <div key={label}>
                  {blocks.length > 1 && <div className="text-[13px] font-semibold text-ink-muted mb-1">{label}</div>}
                  {Array.isArray(text)
                    ? <SpeakableWords words={text} tone={label === 'Skipped words' ? 'rose' : 'amber'} className="mt-1" />
                    : <p className="text-[15px] text-ink leading-relaxed whitespace-pre-wrap">{text}</p>}
                </div>
              ))}
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

export default SubmissionReview;
