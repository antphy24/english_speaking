import React, { useEffect, useState } from 'react';
import { X, Save, Eye, Clock, Repeat, Languages, Mic, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ASPECTS, ASPECT_SHORT } from '../../utils/researchApi';
import { Button } from '../UI/Button';
import { Textarea } from '../UI/Field';


function ScoreTable({ title, scores, feedback }) {
  if (!scores) return null;
  return (
    <div className="bg-surface border border-line rounded-2xl p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <h4 className="text-sm font-semibold text-ink">{title}</h4>
        <span className="text-[13px] text-ink-muted">
          Total <b className="text-ink">{scores.total}</b>/25 · Nilai <b className="text-brand-ink">{scores.nilai}</b>
        </span>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {ASPECTS.map((a) => (
          <div key={a} className="text-center bg-surface-muted rounded-xl py-2">
            <div className="text-xs text-ink-subtle">{ASPECT_SHORT[a]}</div>
            <div className="text-lg font-bold text-ink tabular-nums">{scores[a] ?? '-'}</div>
          </div>
        ))}
      </div>
      {feedback && (
        <div className="mt-3 space-y-1.5 text-sm text-ink-muted">
          {ASPECTS.map((a) => feedback[a] ? (
            <p key={a}><span className="text-ink-subtle font-semibold">{ASPECT_SHORT[a]}</span> {feedback[a]}</p>
          ) : null)}
          {feedback.overall_comment && <p className="pt-1 text-ink italic">{feedback.overall_comment}</p>}
        </div>
      )}
    </div>
  );
}

function Measures({ m }) {
  if (!m || m.words === undefined) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-subtle mt-1.5">
      <span>{m.words} words</span>
      <span>{m.speech_rate_wpm} wpm</span>
      <span>{m.pauses_over_1s} pauses &gt;1s</span>
      {m.response_latency_s != null && <span>starts after {m.response_latency_s}s</span>}
      {m.indonesian_words > 0 && <span className="text-warning">{m.indonesian_words} Indonesian words</span>}
      {m.language && m.language !== 'english' && m.language !== 'en' && (
        <span className="text-warning">detected: {m.language}</span>
      )}
    </div>
  );
}

/**
 * One student's recordings with transcripts.
 * mode "teacher": shows the name-free code plus AI and human scores.
 * mode "scorer":  rubric form; AI scores appear only after saving.
 */
export default function AttemptViewer({ detail, mode = 'teacher', title, onClose, onSaveScore, onPrev, onNext }) {
  const [form, setForm] = useState({});
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const mine = detail?.my_score;
    setForm(mine ? Object.fromEntries(ASPECTS.map((a) => [a, mine[a]])) : {});
    setNotes(mine?.notes || '');
    setError('');
    setSaved(false);
  }, [detail?.id, detail?.my_score]);

  if (!detail) return null;
  const levels = detail.rubric?.levels || {};
  const labels = detail.rubric?.labels || {};
  const complete = ASPECTS.every((a) => form[a] >= 1 && form[a] <= 5);

  const save = async () => {
    if (!complete) { setError('Give a score for all five aspects.'); return; }
    setSaving(true);
    setError('');
    try {
      await onSaveScore({ ...form, notes });
      setSaved(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-[rgb(16_24_40/0.5)] flex justify-end" onClick={onClose} role="dialog" aria-modal="true" aria-label={title || detail.anon_code}>
      <div className="w-full max-w-3xl h-full overflow-y-auto bg-canvas text-ink border-l border-line px-4 pb-6 md:px-6"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-5 sticky top-0 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-surface border-b border-line z-10">
          <div className="min-w-0">
            <div className="text-[13px] font-semibold text-brand-ink">
              {mode === 'scorer' ? 'Blind scoring' : 'Speaking test recording'}
            </div>
            <h3 className="text-lg font-bold text-ink truncate">{title || detail.anon_code}</h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onPrev && <Button variant="secondary" size="sm" onClick={onPrev}>Previous</Button>}
            {onNext && <Button variant="secondary" size="sm" onClick={onNext}>Next</Button>}
            <Button variant="subtle" size="sm" icon={X} onClick={onClose} aria-label="Close" />
          </div>
        </div>

        {mode === 'teacher' && (
          <div className="space-y-3 mb-5">
            {detail.ai_error && detail.status !== 'scored' && (
              <div className="p-3 rounded-xl bg-warning-tint text-sm text-warning flex gap-2">
                <Clock className="w-4 h-4 shrink-0" /> {detail.ai_error}
              </div>
            )}
            <ScoreTable title={`AI score (main) · ${detail.ai_model || ''}${detail.ai_runs > 1 ? ` · median of ${detail.ai_runs} runs` : ''}`}
                        scores={detail.ai_scores} feedback={detail.ai_feedback} />
            {(detail.human_scores || []).map((h) => (
              <ScoreTable key={h.id} title={`Human scorer: ${h.scorer_name}`}
                          scores={{ ...h, total: ASPECTS.reduce((s, a) => s + h[a], 0),
                                    nilai: Math.round(ASPECTS.reduce((s, a) => s + h[a], 0) / 25 * 10000) / 100 }}
                          feedback={h.notes ? { overall_comment: h.notes } : null} />
            ))}
          </div>
        )}

        <div className="space-y-3">
          {detail.items.map((it, idx) => (
            <div key={it.id} className="bg-surface border border-line rounded-2xl p-4 md:p-5">
              {(idx === 0 || detail.items[idx - 1].part_title !== it.part_title) && (
                <div className="text-[13px] font-semibold text-brand-ink mb-2">{it.part_title}</div>
              )}
              {it.image_url && (idx === 0 || detail.items[idx - 1].image_url !== it.image_url) && (
                <img src={it.image_url} alt="Test picture" className="w-full max-h-72 object-contain rounded-xl mb-3 bg-surface-muted" />
              )}
              <p className="text-[15px] text-ink font-semibold">{it.prompt}</p>
              <div className="flex flex-wrap items-center gap-3 text-xs text-ink-subtle mt-1">
                {it.duration_seconds != null && <span className="flex items-center gap-1"><Mic className="w-3 h-3" />{it.duration_seconds}s / {it.speak_seconds}s</span>}
                {it.repeats_used > 0 && <span className="flex items-center gap-1 text-warning"><Repeat className="w-3 h-3" />question repeated {it.repeats_used}x</span>}
              </div>
              {it.audio_url ? (
                <audio controls preload="none" src={it.audio_url} className="w-full mt-2 h-10" />
              ) : (
                <p className="text-xs text-danger mt-2">No recording.</p>
              )}
              <div className="mt-2 text-sm text-ink bg-surface-muted rounded-xl p-3 leading-relaxed">
                {it.transcribe_status === 'pending'
                  ? <span className="text-ink-subtle italic">Transcript not ready yet.</span>
                  : (it.transcript || <span className="text-ink-subtle italic">(nothing recognised)</span>)}
              </div>
              <Measures m={it.measures} />
            </div>
          ))}
        </div>

        {mode === 'scorer' && (
          <div className="mt-6 bg-surface border-2 border-brand/40 rounded-2xl p-4 md:p-5 space-y-5">
            <div>
              <h4 className="text-base font-bold text-ink">Your score</h4>
              <p className="text-sm text-ink-muted">Score the whole test (all answers together). Tap a level; the descriptor is shown below it.</p>
            </div>
            {ASPECTS.map((a) => (
              <div key={a}>
                <div className="text-sm font-semibold text-ink mb-1.5">{labels[a] || a}</div>
                <div className="grid grid-cols-5 gap-1.5">
                  {[1, 2, 3, 4, 5].map((lvl) => (
                    <button key={lvl} type="button" title={levels[a]?.[lvl]}
                            onClick={() => setForm((f) => ({ ...f, [a]: lvl }))}
                            className={`min-h-[44px] rounded-xl border text-base font-bold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-ring ${
                              form[a] === lvl ? 'bg-brand border-brand text-white' : 'bg-surface border-line-strong text-ink-muted hover:border-brand'}`}
                            aria-pressed={form[a] === lvl}>
                      {lvl}
                    </button>
                  ))}
                </div>
                {form[a] && levels[a]?.[form[a]] && (
                  <p className="text-[13px] text-ink-muted mt-1.5">{form[a]} = {levels[a][form[a]]}</p>
                )}
              </div>
            ))}
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)" aria-label="Notes (optional)" />
            {error && <p className="text-sm text-danger flex items-center gap-1.5" role="alert"><AlertTriangle className="w-4 h-4" />{error}</p>}
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm text-ink-muted tabular-nums">
                Total {complete ? ASPECTS.reduce((s, a) => s + form[a], 0) : '-'}/25
              </span>
              <Button onClick={save} loading={saving} icon={saved ? CheckCircle2 : Save}>
                {saving ? 'Saving...' : saved ? 'Saved' : (detail.my_score ? 'Update score' : 'Save score')}
              </Button>
            </div>
            {detail.my_score ? (
              detail.ai_scores ? (
                <ScoreTable title="AI score (shown after you saved yours)" scores={detail.ai_scores} feedback={detail.ai_feedback} />
              ) : (
                <p className="text-[13px] text-ink-subtle flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" />The AI has not scored this test yet.</p>
              )
            ) : (
              <p className="text-[13px] text-ink-subtle flex items-center gap-1.5"><Languages className="w-3.5 h-3.5" />The AI score stays hidden until you save your own, so it cannot influence you.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
