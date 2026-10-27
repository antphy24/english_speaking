import React, { useEffect, useState } from 'react';
import { X, Save, Eye, Clock, Repeat, Languages, Mic, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { ASPECTS, ASPECT_SHORT } from '../../utils/researchApi';

const LEVEL_COLORS = {
  5: 'bg-emerald-600 border-emerald-400',
  4: 'bg-teal-600 border-teal-400',
  3: 'bg-amber-600 border-amber-400',
  2: 'bg-orange-600 border-orange-400',
  1: 'bg-rose-600 border-rose-400',
};

function ScoreTable({ title, scores, feedback }) {
  if (!scores) return null;
  return (
    <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-bold text-white">{title}</h4>
        <span className="text-xs text-slate-400">
          Total <b className="text-white">{scores.total}</b>/25 · Nilai <b className="text-indigo-300">{scores.nilai}</b>
        </span>
      </div>
      <div className="grid grid-cols-5 gap-2">
        {ASPECTS.map((a) => (
          <div key={a} className="text-center bg-slate-950/60 rounded-xl py-2">
            <div className="text-[10px] text-slate-500 uppercase">{ASPECT_SHORT[a]}</div>
            <div className="text-lg font-extrabold text-white">{scores[a] ?? '-'}</div>
          </div>
        ))}
      </div>
      {feedback && (
        <div className="mt-3 space-y-1.5 text-xs text-slate-300">
          {ASPECTS.map((a) => feedback[a] ? (
            <p key={a}><span className="text-slate-500 font-semibold">{ASPECT_SHORT[a]}</span> {feedback[a]}</p>
          ) : null)}
          {feedback.overall_comment && <p className="pt-1 text-slate-200 italic">{feedback.overall_comment}</p>}
        </div>
      )}
    </div>
  );
}

function Measures({ m }) {
  if (!m || m.words === undefined) return null;
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-500 mt-1.5">
      <span>{m.words} words</span>
      <span>{m.speech_rate_wpm} wpm</span>
      <span>{m.pauses_over_1s} pauses &gt;1s</span>
      {m.response_latency_s != null && <span>starts after {m.response_latency_s}s</span>}
      {m.indonesian_words > 0 && <span className="text-amber-400">{m.indonesian_words} Indonesian words</span>}
      {m.language && m.language !== 'english' && m.language !== 'en' && (
        <span className="text-amber-400">detected: {m.language}</span>
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
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex justify-end" onClick={onClose}>
      <div className="w-full max-w-3xl h-full overflow-y-auto bg-[#0b0f19] border-l border-slate-800 p-4 md:p-6"
           onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3 mb-4 sticky -top-4 md:-top-6 -mx-4 md:-mx-6 px-4 md:px-6 py-3 bg-[#0b0f19]/95 border-b border-slate-900 z-10">
          <div className="min-w-0">
            <div className="text-[11px] text-slate-500 uppercase tracking-wider">
              {mode === 'scorer' ? 'Blind scoring' : 'Speaking test recording'}
            </div>
            <h3 className="text-lg font-bold text-white truncate">{title || detail.anon_code}</h3>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {onPrev && <button onClick={onPrev} className="px-3 py-2 text-xs rounded-xl bg-slate-900 border border-slate-800 text-slate-300">Prev</button>}
            {onNext && <button onClick={onNext} className="px-3 py-2 text-xs rounded-xl bg-slate-900 border border-slate-800 text-slate-300">Next</button>}
            <button onClick={onClose} aria-label="Close" className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-white">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {mode === 'teacher' && (
          <div className="space-y-3 mb-5">
            {detail.ai_error && detail.status !== 'scored' && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs text-amber-300 flex gap-2">
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
            <div key={it.id} className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
              {(idx === 0 || detail.items[idx - 1].part_title !== it.part_title) && (
                <div className="text-[11px] font-bold text-indigo-300 uppercase tracking-wider mb-2">{it.part_title}</div>
              )}
              {it.image_url && (idx === 0 || detail.items[idx - 1].image_url !== it.image_url) && (
                <img src={it.image_url} alt="Test picture" className="w-full max-h-72 object-contain rounded-xl mb-3 bg-black" />
              )}
              <p className="text-sm text-white font-semibold">{it.prompt}</p>
              <div className="flex flex-wrap items-center gap-3 text-[11px] text-slate-500 mt-1">
                {it.duration_seconds != null && <span className="flex items-center gap-1"><Mic className="w-3 h-3" />{it.duration_seconds}s / {it.speak_seconds}s</span>}
                {it.repeats_used > 0 && <span className="flex items-center gap-1 text-amber-400"><Repeat className="w-3 h-3" />question repeated {it.repeats_used}x</span>}
              </div>
              {it.audio_url ? (
                <audio controls preload="none" src={it.audio_url} className="w-full mt-2 h-10" />
              ) : (
                <p className="text-xs text-rose-400 mt-2">No recording.</p>
              )}
              <div className="mt-2 text-xs text-slate-300 bg-slate-950/50 rounded-xl p-3">
                {it.transcribe_status === 'pending'
                  ? <span className="text-slate-500 italic">Transcript not ready yet.</span>
                  : (it.transcript || <span className="text-slate-500 italic">(nothing recognised)</span>)}
              </div>
              <Measures m={it.measures} />
            </div>
          ))}
        </div>

        {mode === 'scorer' && (
          <div className="mt-6 bg-slate-900/60 border border-indigo-500/20 rounded-2xl p-4 space-y-4">
            <div>
              <h4 className="text-sm font-bold text-white">Your score</h4>
              <p className="text-xs text-slate-400">Score the whole test (all answers together). Tap a level; the descriptor is shown below it.</p>
            </div>
            {ASPECTS.map((a) => (
              <div key={a}>
                <div className="text-xs font-bold text-slate-200 mb-1.5">{labels[a] || a}</div>
                <div className="grid grid-cols-5 gap-1.5">
                  {[1, 2, 3, 4, 5].map((lvl) => (
                    <button key={lvl} type="button" title={levels[a]?.[lvl]}
                            onClick={() => setForm((f) => ({ ...f, [a]: lvl }))}
                            className={`py-2 rounded-xl border text-sm font-extrabold transition ${
                              form[a] === lvl ? `${LEVEL_COLORS[lvl]} text-white` : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-600'}`}>
                      {lvl}
                    </button>
                  ))}
                </div>
                {form[a] && levels[a]?.[form[a]] && (
                  <p className="text-[11px] text-slate-400 mt-1">{form[a]} = {levels[a][form[a]]}</p>
                )}
              </div>
            ))}
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes (optional)"
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-white outline-none focus:border-indigo-500" />
            {error && <p className="text-xs text-rose-400 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" />{error}</p>}
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-400">
                Total {complete ? ASPECTS.reduce((s, a) => s + form[a], 0) : '-'}/25
              </span>
              <button onClick={save} disabled={saving}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-xs font-bold">
                {saved ? <CheckCircle2 className="w-4 h-4" /> : <Save className="w-4 h-4" />}
                {saving ? 'Saving...' : saved ? 'Saved' : (detail.my_score ? 'Update score' : 'Save score')}
              </button>
            </div>
            {detail.my_score ? (
              detail.ai_scores ? (
                <ScoreTable title="AI score (shown after you saved yours)" scores={detail.ai_scores} feedback={detail.ai_feedback} />
              ) : (
                <p className="text-xs text-slate-500 flex items-center gap-1"><Eye className="w-3.5 h-3.5" />The AI has not scored this test yet.</p>
              )
            ) : (
              <p className="text-[11px] text-slate-500 flex items-center gap-1"><Languages className="w-3.5 h-3.5" />The AI score stays hidden until you save your own, so it cannot influence you.</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
