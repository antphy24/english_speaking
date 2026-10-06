import React, { useEffect, useState } from 'react';
import { X, Headphones, FileText, MessageSquareText, Loader2, AlertTriangle } from 'lucide-react';
import { getAssessmentReview } from '../../utils/api';

const MODE_TITLES = {
  read_aloud: 'Read Aloud',
  qa: 'Q&A Mock',
  conversation: 'AI Conversation',
  debate: 'Debate',
  mattering: 'Mattering Drill',
};

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
  const words = (list) => (Array.isArray(list) && list.length ? list.join(', ') : '');
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
      <h4 className="flex items-center space-x-2 text-[11px] font-bold text-slate-400 uppercase tracking-wider">
        <Icon className="w-3.5 h-3.5" /><span>{title}</span>
      </h4>
      {children}
    </section>
  );
}

/**
 * Review one saved attempt: recording, transcript, score and feedback.
 * `assessment` is a row of public.assessments (id, mode, score, feedback, created_at).
 * Pass `assessment={null}` with `emptyMessage` when there is nothing to show yet.
 */
export function SubmissionReview({ assessment, apiBase, onClose, heading = 'Last submission', studentName, emptyMessage }) {
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
    getAssessmentReview(apiBase, assessmentId)
      .then((data) => { if (!cancelled) setReview(data); })
      .catch((err) => { if (!cancelled) setLoadError(err.message || 'Could not load the recording.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [apiBase, assessmentId]);

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
    else if (mode === 'conversation') audioNote = 'Recordings are not kept for AI Conversation - the full dialogue is below.';
    else if (hadAudio) audioNote = 'The recording for this attempt is no longer available - only the most recent one per mode is kept.';
    else audioNote = 'No recording was stored for this attempt.';
  }

  return (
    <div
      className="fixed inset-0 z-[9998] flex items-start sm:items-center justify-center p-4 overflow-y-auto"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
      aria-label={heading}
    >
      <div className="fixed inset-0 bg-black/70 backdrop-blur-sm pointer-events-none" />
      <div className="relative w-full max-w-2xl bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl my-auto">
        <div className="flex items-start justify-between gap-4 px-6 py-4 border-b border-slate-800">
          <div className="min-w-0">
            <span className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">
              {heading}{mode ? ` · ${MODE_TITLES[mode] || mode}` : ''}
            </span>
            <h3 className="text-base font-bold text-white truncate">
              {studentName || material || (assessment ? 'Your attempt' : 'Nothing here yet')}
            </h3>
            {assessment && (
              <p className="text-[11px] text-slate-500 mt-0.5">
                {studentName && material ? `${material} · ` : ''}{new Date(assessment.created_at).toLocaleString()}
                {fb.role ? ` · ${fb.role}` : ''}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close"
            className="p-2 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!assessment ? (
          <p className="px-6 py-12 text-center text-sm text-slate-400">
            {emptyMessage || 'No saved attempt yet. Finish one and it will appear here.'}
          </p>
        ) : (
          <div className="px-6 py-5 space-y-6 max-h-[75vh] overflow-y-auto">
            {/* Score */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <div>
                <div className="text-4xl font-black text-white leading-none">{summary.main}</div>
                <div className="text-[11px] text-slate-400 mt-1">{summary.caption}</div>
              </div>
              {summary.parts.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {summary.parts.map(([label, value]) => (
                    <div key={label} className="px-3 py-1.5 bg-slate-900 border border-slate-800 rounded-lg">
                      <div className="text-[10px] text-slate-500">{label}</div>
                      <div className="text-sm font-bold text-slate-200">{value}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Recording */}
            <Section icon={Headphones} title="Recording">
              {loading && (
                <p className="flex items-center space-x-2 text-xs text-slate-400">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /><span>Loading the recording...</span>
                </p>
              )}
              {clips.map((slot) => (
                <div key={slot} className="space-y-1">
                  {clips.length > 1 && <span className="text-[11px] text-slate-400">{AUDIO_LABELS[slot]}</span>}
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
                <p className={`flex items-start space-x-2 text-xs ${loadError ? 'text-amber-300' : 'text-slate-500'}`}>
                  {loadError && <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                  <span>{audioNote}</span>
                </p>
              )}
            </Section>

            {/* Transcript */}
            <Section icon={FileText} title={mode === 'conversation' ? 'Dialogue' : 'Transcript (what was heard)'}>
              {has(transcript) ? (
                <p className="text-sm text-slate-300 font-mono leading-relaxed bg-slate-900/60 border border-slate-800 rounded-xl p-4 whitespace-pre-wrap">
                  {transcript}
                </p>
              ) : (
                <p className="text-xs text-slate-500">
                  {loading ? 'Loading...' : 'No transcript was saved for this attempt.'}
                </p>
              )}
            </Section>

            {/* Feedback */}
            <Section icon={MessageSquareText} title="Feedback">
              {blocks.length === 0 && <p className="text-xs text-slate-500">No written feedback was saved.</p>}
              {blocks.map(([label, text]) => (
                <div key={label}>
                  {blocks.length > 1 && <div className="text-xs font-bold text-slate-200 mb-0.5">{label}</div>}
                  <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-wrap">{text}</p>
                </div>
              ))}
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

export default SubmissionReview;
