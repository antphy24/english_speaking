import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FlaskConical, Plus, ArrowLeft, FileSpreadsheet, Download, Users, ListChecks, Gauge, UserCog,
  Lock, Unlock, Eye, RotateCcw, RefreshCw, Trash2, KeyRound, Copy, X,
} from 'lucide-react';
import { researchRequest, researchDownload, ASPECTS, ASPECT_SHORT } from '../../utils/researchApi';
import { supabaseTeacher } from '../../utils/supabaseClient';
import { useConfirm } from '../UI/ConfirmModal';
import TestEditor from './TestEditor';
import CapacityPanel from './CapacityPanel';
import AttemptViewer from './AttemptViewer';

const input = 'w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-indigo-500';
const btn = 'flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold text-slate-300 hover:border-indigo-500 disabled:opacity-40';

const STATUS = {
  not_started: ['Not started', 'bg-slate-800 text-slate-400'],
  declined: ['Did not consent', 'bg-rose-500/15 text-rose-300'],
  in_progress: ['Taking test', 'bg-sky-500/15 text-sky-300'],
  submitted: ['Waiting for AI', 'bg-amber-500/15 text-amber-300'],
  scoring: ['AI scoring', 'bg-amber-500/15 text-amber-300'],
  scored: ['Scored', 'bg-emerald-500/15 text-emerald-300'],
  error: ['Scoring problem', 'bg-rose-500/15 text-rose-300'],
};

function Chip({ status }) {
  const [label, cls] = STATUS[status] || [status, 'bg-slate-800 text-slate-300'];
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap ${cls}`}>{label}</span>;
}

// ------------------------------------------------------------------------------------------------
// Students subset picker ("only these students today")
// ------------------------------------------------------------------------------------------------
function StudentPicker({ cls, students, selected, onSave, onClose }) {
  const [all, setAll] = useState(selected == null);
  const [ids, setIds] = useState(new Set(selected || []));
  const toggle = (id) => setIds((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose}>
      <div className="w-full max-w-md max-h-[85vh] flex flex-col bg-[#0b0f19] border border-slate-800 rounded-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-white">Who may take the test: {cls.class_name}</h4>
            <p className="text-[11px] text-slate-400">Pick only today's group to spread the test over several days.</p>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-4 space-y-2 overflow-y-auto">
          <label className="flex items-center gap-2 text-xs text-white">
            <input type="radio" checked={all} onChange={() => setAll(true)} /> Every student in the class
          </label>
          <label className="flex items-center gap-2 text-xs text-white">
            <input type="radio" checked={!all} onChange={() => setAll(false)} /> Only selected students ({ids.size})
          </label>
          {!all && (
            <div className="pl-5 pt-1 space-y-1">
              <div className="flex gap-3 text-[11px] text-indigo-300 pb-1">
                <button onClick={() => setIds(new Set(students.map((s) => s.id)))}>Select all</button>
                <button onClick={() => setIds(new Set())}>Clear</button>
              </div>
              {students.map((s) => (
                <label key={s.id} className="flex items-center gap-2 text-xs text-slate-300">
                  <input type="checkbox" checked={ids.has(s.id)} onChange={() => toggle(s.id)} /> {s.full_name}
                </label>
              ))}
            </div>
          )}
        </div>
        <div className="p-4 border-t border-slate-800 flex justify-end gap-2">
          <button onClick={onClose} className={btn}>Cancel</button>
          <button onClick={() => onSave(all ? null : [...ids])}
                  className="px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold">Save</button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Classes, opening the test, and live progress
// ------------------------------------------------------------------------------------------------
function ProgressPanel({ test, detail, setError, setSuccess }) {
  const confirm = useConfirm();
  const [progress, setProgress] = useState(null);
  const [picker, setPicker] = useState(null);
  const [viewer, setViewer] = useState(null);
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      setProgress(await researchRequest(supabaseTeacher, `/tests/${test.id}/progress`));
    } catch (e) {
      setError(e.message);
    }
  }, [test.id, setError]);

  useEffect(() => {
    load();
    const t = setInterval(load, 20000);
    return () => clearInterval(t);
  }, [load]);

  const assignments = progress?.assignments || [];
  const byClass = Object.fromEntries(assignments.map((a) => [a.class_id, a]));

  const saveAssignment = async (classId, fields) => {
    setBusy(classId);
    try {
      const current = byClass[classId] || { is_open: false, student_ids: null };
      await researchRequest(supabaseTeacher, `/tests/${test.id}/assignment`, {
        method: 'PUT', body: { class_id: classId, is_open: current.is_open, student_ids: current.student_ids ?? null, ...fields },
      });
      await load();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const openViewer = async (attemptId) => {
    try {
      setViewer(await researchRequest(supabaseTeacher, `/attempts/${attemptId}`));
    } catch (e) {
      setError(e.message);
    }
  };

  const action = async (attempt, kind) => {
    const msgs = {
      reset: ['Reset this attempt?', 'The recordings and scores are deleted and the student can take the test again.'],
      rescore: ['Score again?', 'The AI scores this test again (uses today\'s free quota).'],
    };
    const ok = await confirm({ title: msgs[kind][0], message: msgs[kind][1], confirmLabel: kind === 'reset' ? 'Reset' : 'Score again', variant: kind === 'reset' ? 'danger' : 'info' });
    if (!ok) return;
    try {
      await researchRequest(supabaseTeacher, `/attempts/${attempt.id}/${kind}`, { method: 'POST' });
      setSuccess(kind === 'reset' ? 'Attempt reset.' : 'Queued for scoring.');
      load();
    } catch (e) {
      setError(e.message);
    }
  };

  const rows = useMemo(() => {
    if (!progress) return [];
    const clsName = Object.fromEntries(detail.classes.map((c) => [c.id, c.class_name]));
    return progress.students
      .filter((s) => {
        const a = byClass[s.class_id];
        return a && (a.student_ids == null || a.student_ids.includes(s.id) || progress.attempts[s.id]);
      })
      .map((s) => ({ ...s, class_name: clsName[s.class_id] || '', attempt: progress.attempts[s.id] }))
      .sort((a, b) => a.class_name.localeCompare(b.class_name) || a.full_name.localeCompare(b.full_name));
  }, [progress, detail.classes, byClass]);

  const counts = rows.reduce((acc, r) => {
    const st = r.attempt?.status || 'not_started';
    acc[st] = (acc[st] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
        <h4 className="text-sm font-bold text-white mb-1">Classes</h4>
        <p className="text-xs text-slate-400 mb-3">Assign the test to a class, choose who may take it today, then open it. Students only see it while it is open.</p>
        <div className="space-y-2">
          {detail.classes.length === 0 && <p className="text-xs text-slate-500">Create a class first (Classes tab).</p>}
          {detail.classes.map((c) => {
            const a = byClass[c.id];
            const classStudents = detail.students.filter((s) => s.class_id === c.id);
            return (
              <div key={c.id} className="flex flex-col sm:flex-row sm:items-center gap-2 justify-between bg-slate-950/50 border border-slate-800 rounded-xl p-3">
                <div className="min-w-0">
                  <div className="text-sm font-bold text-white">{c.class_name}</div>
                  <div className="text-[11px] text-slate-500">
                    {a ? (a.student_ids == null ? `All ${classStudents.length} students` : `${a.student_ids.length} of ${classStudents.length} students selected`) : 'Not assigned'}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {a ? (
                    <>
                      <button className={btn} onClick={() => setPicker(c)} disabled={busy === c.id}><Users className="w-3.5 h-3.5" />Students</button>
                      <button onClick={() => saveAssignment(c.id, { is_open: !a.is_open })} disabled={busy === c.id}
                              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border ${a.is_open ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-300' : 'bg-slate-900 border-slate-800 text-slate-300'}`}>
                        {a.is_open ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
                        {a.is_open ? 'Open - tap to close' : 'Closed - tap to open'}
                      </button>
                      <button className={btn} title="Unassign" onClick={() => saveAssignment(c.id, { remove: true })} disabled={busy === c.id}><X className="w-3.5 h-3.5" /></button>
                    </>
                  ) : (
                    <button className={btn} onClick={() => saveAssignment(c.id, { is_open: false, student_ids: null })} disabled={busy === c.id}>
                      <Plus className="w-3.5 h-3.5" />Assign
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3 gap-2">
          <div>
            <h4 className="text-sm font-bold text-white">Progress</h4>
            <div className="flex flex-wrap gap-1.5 mt-1.5">
              {Object.entries(counts).map(([st, n]) => <span key={st} className="flex items-center gap-1"><Chip status={st} /><span className="text-[11px] text-slate-400">{n}</span></span>)}
            </div>
          </div>
          <button className={btn} onClick={load}><RefreshCw className="w-3.5 h-3.5" /></button>
        </div>
        {rows.length === 0 ? (
          <p className="text-xs text-slate-500">No students yet. Assign a class above.</p>
        ) : (
          <div className="overflow-x-auto -mx-4 px-4">
            <table className="w-full text-xs min-w-[640px]">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-800">
                  <th className="py-2 pr-2">Student</th><th className="pr-2">Class</th><th className="pr-2">Status</th>
                  <th className="pr-2">Answers</th>
                  {ASPECTS.map((a) => <th key={a} className="pr-1 text-center">{ASPECT_SHORT[a]}</th>)}
                  <th className="pr-2 text-center">Nilai</th><th className="pr-2 text-center">Human</th><th />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const a = r.attempt;
                  const sc = a?.ai_scores;
                  return (
                    <tr key={r.id} className="border-b border-slate-900 text-slate-300">
                      <td className="py-2 pr-2 text-white font-semibold">{r.full_name}</td>
                      <td className="pr-2">{r.class_name}</td>
                      <td className="pr-2" title={a?.ai_error || ''}><Chip status={a?.status || 'not_started'} /></td>
                      <td className="pr-2 text-slate-400">{a ? `${a.answers}/${progress.items}${a.answers && a.transcribed < a.answers ? ` · ${a.transcribed} transcribed` : ''}` : '-'}</td>
                      {ASPECTS.map((x) => <td key={x} className="pr-1 text-center">{sc?.[x] ?? ''}</td>)}
                      <td className="pr-2 text-center font-bold text-indigo-300">{sc?.nilai ?? ''}</td>
                      <td className="pr-2 text-center">{a?.human_scores || ''}</td>
                      <td className="py-1">
                        {a && !['in_progress', 'declined'].includes(a.status) && (
                          <div className="flex gap-1 justify-end">
                            <button title="Listen" onClick={() => openViewer(a.id)} className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:text-white"><Eye className="w-3.5 h-3.5" /></button>
                            <button title="Score again" onClick={() => action(a, 'rescore')} className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:text-white"><RefreshCw className="w-3.5 h-3.5" /></button>
                            <button title="Reset attempt" onClick={() => action(a, 'reset')} className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:text-rose-400"><RotateCcw className="w-3.5 h-3.5" /></button>
                          </div>
                        )}
                        {a && ['in_progress', 'declined'].includes(a.status) && (
                          <div className="flex justify-end">
                            <button title="Reset attempt" onClick={() => action(a, 'reset')} className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:text-rose-400"><RotateCcw className="w-3.5 h-3.5" /></button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {picker && (
        <StudentPicker cls={picker} students={detail.students.filter((s) => s.class_id === picker.id)}
                       selected={byClass[picker.id]?.student_ids ?? null} onClose={() => setPicker(null)}
                       onSave={async (ids) => { const id = picker.id; setPicker(null); await saveAssignment(id, { student_ids: ids }); }} />
      )}
      {viewer && (
        <AttemptViewer detail={viewer} mode="teacher"
                       title={`${rows.find((r) => r.attempt?.id === viewer.id)?.full_name || ''} · ${viewer.anon_code}`}
                       onClose={() => setViewer(null)} />
      )}
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Human scorer accounts
// ------------------------------------------------------------------------------------------------
function ScorersPanel({ detail, reload, setError, setSuccess }) {
  const confirm = useConfirm();
  const [form, setForm] = useState({ full_name: '', username: '', password: '' });
  const [busy, setBusy] = useState(false);
  const loginUrl = `${window.location.origin}/scorer/login`;

  const add = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      await researchRequest(supabaseTeacher, `/studies/${detail.study.id}/scorers`, { method: 'POST', body: form, retries: 0 });
      setSuccess(`Scorer account created. Username: ${form.username.trim().toLowerCase()}`);
      setForm({ full_name: '', username: '', password: '' });
      reload();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (s) => {
    const ok = await confirm({ title: `Remove ${s.full_name}?`, message: 'Their login stops working. Scores they already gave stay in the export.', confirmLabel: 'Remove', variant: 'danger' });
    if (!ok) return;
    try {
      await researchRequest(supabaseTeacher, `/studies/${detail.study.id}/scorers/${s.id}`, { method: 'DELETE' });
      reload();
    } catch (err) {
      setError(err.message);
    }
  };

  const resetPassword = async (s) => {
    const password = window.prompt(`New password for ${s.full_name} (at least 6 characters):`);
    if (!password) return;
    try {
      await researchRequest(supabaseTeacher, `/studies/${detail.study.id}/scorers/${s.id}/password`, { method: 'POST', body: { password } });
      setSuccess('Password changed.');
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 text-xs text-slate-300 space-y-2">
        <p>Human scorers listen to the recordings and score them with the same rubric. They see anonymous codes in a random order, never student names, and the AI score only after saving their own. Their scores are compared with the AI in the export.</p>
        <div className="flex items-center gap-2">
          <span className="text-slate-400">Scorer login page:</span>
          <code className="text-indigo-300 truncate">{loginUrl}</code>
          <button className="p-1.5 text-slate-400 hover:text-white" title="Copy" onClick={() => { navigator.clipboard?.writeText(loginUrl); setSuccess('Link copied.'); }}><Copy className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <form onSubmit={add} className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 grid grid-cols-1 md:grid-cols-4 gap-2 items-end">
        <label className="text-xs text-slate-400 space-y-1"><span>Name</span><input className={input} value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} required /></label>
        <label className="text-xs text-slate-400 space-y-1"><span>Username</span><input className={input} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="e.g. bu_fatma" required /></label>
        <label className="text-xs text-slate-400 space-y-1"><span>Password</span><input className={input} type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} minLength={6} required /></label>
        <button disabled={busy} className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold disabled:opacity-50">
          <Plus className="w-3.5 h-3.5" />{busy ? 'Creating...' : 'Add scorer'}
        </button>
      </form>

      <div className="space-y-2">
        {detail.scorers.length === 0 && <p className="text-xs text-slate-500">No scorers yet.</p>}
        {detail.scorers.map((s) => (
          <div key={s.id} className="flex items-center justify-between bg-slate-950/50 border border-slate-800 rounded-xl p-3">
            <div>
              <div className="text-sm font-bold text-white">{s.full_name}</div>
              <div className="text-[11px] text-slate-500">username: {s.username}</div>
            </div>
            <div className="flex gap-2">
              <button className={btn} onClick={() => resetPassword(s)}><KeyRound className="w-3.5 h-3.5" />Password</button>
              <button className={btn} onClick={() => remove(s)}><Trash2 className="w-3.5 h-3.5" /></button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------------------------------------
// Main tab
// ------------------------------------------------------------------------------------------------
export function ResearchTab({ setActionError, setActionSuccess }) {
  const confirm = useConfirm();
  const [studies, setStudies] = useState(null);
  const [studyId, setStudyId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [section, setSection] = useState('progress');
  const [testKind, setTestKind] = useState('pre');
  const [newTitle, setNewTitle] = useState('Efektivitas Program English Hour dalam Meningkatkan Kemampuan Speaking Siswa di Sekolah Islam Athirah Bone');
  const [newUnit, setNewUnit] = useState('SMA');
  const [busy, setBusy] = useState('');

  const setError = useCallback((m) => { setActionSuccess?.(''); setActionError?.(m); }, [setActionError, setActionSuccess]);
  const setSuccess = useCallback((m) => { setActionError?.(''); setActionSuccess?.(m); }, [setActionError, setActionSuccess]);

  const loadStudies = useCallback(async () => {
    try {
      setStudies(await researchRequest(supabaseTeacher, '/studies'));
    } catch (e) {
      setError(e.message);
      setStudies([]);
    }
  }, [setError]);

  const loadDetail = useCallback(async () => {
    if (!studyId) return;
    try {
      setDetail(await researchRequest(supabaseTeacher, `/studies/${studyId}`));
    } catch (e) {
      setError(e.message);
    }
  }, [studyId, setError]);

  useEffect(() => { loadStudies(); }, [loadStudies]);
  useEffect(() => { setDetail(null); loadDetail(); }, [loadDetail]);

  const create = async (e) => {
    e.preventDefault();
    setBusy('create');
    try {
      const s = await researchRequest(supabaseTeacher, '/studies', { method: 'POST', body: { title: newTitle, unit: newUnit }, retries: 0 });
      setSuccess('Study created with a pretest and a posttest from the research instrument. Check the questions and add the pictures.');
      await loadStudies();
      setStudyId(s.id);
      setSection('tests');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy('');
    }
  };

  const download = async (kind) => {
    setBusy(kind);
    try {
      if (kind === 'xlsx') {
        await researchDownload(supabaseTeacher, `/studies/${studyId}/export`, 'research_results.xlsx');
      } else {
        setSuccess('Preparing the ZIP of all recordings - this can take a minute.');
        await researchDownload(supabaseTeacher, `/studies/${studyId}/recordings.zip`, 'research_recordings.zip');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy('');
    }
  };

  const removeStudy = async () => {
    const ok = await confirm({ title: 'Delete this study?', message: 'All tests, recordings, AI and human scores and scorer accounts of this study are deleted permanently. Download the Excel and ZIP first.', confirmLabel: 'Delete everything', variant: 'danger' });
    if (!ok) return;
    try {
      await researchRequest(supabaseTeacher, `/studies/${studyId}`, { method: 'DELETE' });
      setStudyId(null);
      loadStudies();
      setSuccess('Study deleted.');
    } catch (e) {
      setError(e.message);
    }
  };

  // ---- list of studies ----
  if (!studyId) {
    return (
      <div className="space-y-5">
        <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 text-xs text-slate-300 space-y-1">
          <p className="font-bold text-white text-sm flex items-center gap-2"><FlaskConical className="w-4 h-4 text-indigo-300" />Research Test mode</p>
          <p>A study has a pretest and a posttest. Students answer each question in a separate recording, see no scores, and the AI (Gemini, listening to the audio) scores Brown's rubric: 5 aspects × 1-5, Nilai = Total ÷ 25 × 100.</p>
        </div>

        {(studies || []).map((s) => (
          <button key={s.id} onClick={() => { setStudyId(s.id); setSection('progress'); }}
                  className="w-full text-left bg-slate-900/40 border border-slate-800 hover:border-indigo-500/40 rounded-2xl p-4 transition">
            <div className="text-sm font-bold text-white">{s.title}</div>
            <div className="text-[11px] text-slate-500 mt-0.5">Unit {s.unit}</div>
            <div className="flex flex-wrap gap-3 mt-2">
              {s.tests.map((t) => (
                <span key={t.id} className="text-xs text-slate-300">
                  <b>{t.kind === 'pre' ? 'Pretest' : 'Posttest'}</b>: {t.submitted} submitted · {t.scored} scored
                </span>
              ))}
            </div>
          </button>
        ))}
        {studies && studies.length === 0 && <p className="text-xs text-slate-500">No studies yet.</p>}

        <form onSubmit={create} className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 space-y-3">
          <h4 className="text-sm font-bold text-white">New study</h4>
          <textarea className={input} rows={2} value={newTitle} onChange={(e) => setNewTitle(e.target.value)} required />
          <div className="flex gap-2 items-center">
            <select className={`${input} w-28`} value={newUnit} onChange={(e) => setNewUnit(e.target.value)}>
              <option value="SMA">SMA</option><option value="SMP">SMP</option>
            </select>
            <button disabled={busy === 'create'} className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-indigo-600 text-white text-xs font-bold disabled:opacity-50">
              <Plus className="w-3.5 h-3.5" />{busy === 'create' ? 'Creating...' : 'Create study'}
            </button>
          </div>
          <p className="text-[11px] text-slate-500">The pretest and posttest start with the questions from the SMA research instrument. You can edit them.</p>
        </form>
      </div>
    );
  }

  if (!detail) return <p className="text-sm text-slate-400">Loading study...</p>;

  const test = detail.tests.find((t) => t.kind === testKind) || detail.tests[0];
  const studyCounts = (studies || []).find((s) => s.id === studyId)?.tests || [];
  const hasAttempts = (studyCounts.find((t) => t.id === test.id)?.submitted || 0) > 0;
  const assignedStudents = detail.students.length;

  const SECTIONS = [
    { key: 'progress', label: 'Classes & progress', icon: ListChecks },
    { key: 'tests', label: 'Questions', icon: FlaskConical },
    { key: 'capacity', label: 'Daily capacity', icon: Gauge },
    { key: 'scorers', label: 'Human scorers', icon: UserCog },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-3">
        <div className="min-w-0">
          <button onClick={() => { setStudyId(null); loadStudies(); }} className="flex items-center gap-1 text-xs text-slate-400 hover:text-white mb-1">
            <ArrowLeft className="w-3.5 h-3.5" /> All studies
          </button>
          <h3 className="text-base font-bold text-white">{detail.study.title}</h3>
          <p className="text-[11px] text-slate-500">Unit {detail.study.unit} · AI scorer {detail.ai_model}{detail.scoring_runs > 1 ? ` · median of ${detail.scoring_runs} runs` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-2 shrink-0">
          <button className={btn} onClick={() => download('xlsx')} disabled={!!busy}><FileSpreadsheet className="w-3.5 h-3.5" />{busy === 'xlsx' ? 'Preparing...' : 'Excel results'}</button>
          <button className={btn} onClick={() => download('zip')} disabled={!!busy}><Download className="w-3.5 h-3.5" />{busy === 'zip' ? 'Preparing...' : 'All recordings (ZIP)'}</button>
          <button className={btn} onClick={removeStudy} title="Delete study"><Trash2 className="w-3.5 h-3.5" /></button>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {SECTIONS.map(({ key, label, icon: Icon }) => (
          <button key={key} onClick={() => setSection(key)}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold border ${section === key ? 'bg-indigo-600/15 border-indigo-500/30 text-white' : 'border-slate-800 text-slate-400'}`}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      {(section === 'progress' || section === 'tests' || section === 'capacity') && (
        <div className="inline-flex bg-slate-950 border border-slate-800 rounded-xl p-1">
          {detail.tests.map((t) => (
            <button key={t.id} onClick={() => setTestKind(t.kind)}
                    className={`px-4 py-1.5 rounded-lg text-xs font-bold ${testKind === t.kind ? 'bg-indigo-600 text-white' : 'text-slate-400'}`}>
              {t.kind === 'pre' ? 'Pretest' : 'Posttest'}
            </button>
          ))}
        </div>
      )}

      {section === 'progress' && <ProgressPanel key={test.id} test={test} detail={detail} setError={setError} setSuccess={setSuccess} />}
      {section === 'tests' && <TestEditor test={test} hasAttempts={hasAttempts} onSaved={loadDetail} setError={setError} setSuccess={setSuccess} />}
      {section === 'capacity' && <CapacityPanel testId={test.id} totalStudents={assignedStudents} />}
      {section === 'scorers' && <ScorersPanel detail={detail} reload={loadDetail} setError={setError} setSuccess={setSuccess} />}
    </div>
  );
}

export default ResearchTab;
