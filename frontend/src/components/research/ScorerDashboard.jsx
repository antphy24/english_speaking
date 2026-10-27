import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Headphones, LogOut, CheckCircle2, Circle, RefreshCw } from 'lucide-react';
import { supabaseScorer } from '../../utils/supabaseClient';
import { researchRequest } from '../../utils/researchApi';
import AttemptViewer from './AttemptViewer';

/** Human scorer: anonymous recordings in a fixed random order; scores with Brown's rubric. */
export default function ScorerDashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [studies, setStudies] = useState([]);
  const [studyId, setStudyId] = useState(null);
  const [list, setList] = useState([]);
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabaseScorer.auth.getSession();
      if (!session || session.user?.user_metadata?.role !== 'scorer') { navigate('/scorer/login'); return; }
      setUser(session.user);
      try {
        const s = await researchRequest(supabaseScorer, '/scorer/studies');
        setStudies(s);
        if (s.length) setStudyId(s[0].id);
      } catch (e) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadList = useCallback(async () => {
    if (!studyId) return;
    try {
      setList(await researchRequest(supabaseScorer, `/scorer/studies/${studyId}/attempts`));
    } catch (e) {
      setError(e.message);
    }
  }, [studyId]);

  useEffect(() => { loadList(); }, [loadList]);

  const open = async (id) => {
    try {
      setDetail(await researchRequest(supabaseScorer, `/scorer/attempts/${id}`));
    } catch (e) {
      setError(e.message);
    }
  };

  const save = async (score) => {
    const updated = await researchRequest(supabaseScorer, `/scorer/attempts/${detail.id}`, { method: 'PUT', body: score, retries: 1 });
    setDetail(updated);
    setList((l) => l.map((x) => (x.id === detail.id ? { ...x, scored_by_me: true } : x)));
  };

  const idx = detail ? list.findIndex((x) => x.id === detail.id) : -1;
  const done = list.filter((x) => x.scored_by_me).length;

  const logout = async () => {
    await supabaseScorer.auth.signOut();
    navigate('/scorer/login');
  };

  return (
    <div className="min-h-screen bg-[#070b13] text-slate-100">
      <header className="border-b border-slate-900 px-4 md:px-8 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <Headphones className="w-5 h-5 text-indigo-400 shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-bold text-white">HreFSpeak · Scorer</div>
            <div className="text-[11px] text-slate-500 truncate">{user?.user_metadata?.full_name}</div>
          </div>
        </div>
        <button onClick={logout} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs text-slate-400">
          <LogOut className="w-3.5 h-3.5" />Log out
        </button>
      </header>

      <main className="max-w-3xl mx-auto p-4 md:p-8 space-y-4">
        {error && <p className="text-sm text-rose-400">{error}</p>}
        {loading && <p className="text-sm text-slate-400">Loading...</p>}
        {!loading && studies.length === 0 && <p className="text-sm text-slate-400">You are not linked to a study yet.</p>}

        {studies.length > 1 && (
          <select value={studyId || ''} onChange={(e) => setStudyId(e.target.value)}
                  className="w-full bg-slate-900 border border-slate-800 rounded-xl px-3 py-2 text-sm text-white">
            {studies.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
          </select>
        )}
        {studies.length === 1 && <h2 className="text-base font-bold text-white">{studies[0].title}</h2>}

        {studyId && (
          <>
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-4 text-xs text-slate-300 space-y-1">
              <p>Each code is one student's test. Listen to all answers, then score the whole test with the rubric (1-5 per aspect).</p>
              <p className="text-slate-500">Names are hidden and the order is random. The AI score appears only after you save yours.</p>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-300"><b className="text-white">{done}</b> of {list.length} scored</span>
              <button onClick={loadList} className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400"><RefreshCw className="w-4 h-4" /></button>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
              {list.map((x, i) => (
                <button key={x.id} onClick={() => open(x.id)}
                        className={`flex items-center gap-2 p-3 rounded-xl border text-left transition ${x.scored_by_me ? 'bg-emerald-500/10 border-emerald-500/30' : 'bg-slate-900/60 border-slate-800 hover:border-indigo-500/40'}`}>
                  {x.scored_by_me ? <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" /> : <Circle className="w-4 h-4 text-slate-600 shrink-0" />}
                  <div>
                    <div className="text-[10px] text-slate-500">#{i + 1}</div>
                    <div className="text-sm font-mono font-bold text-white">{x.anon_code}</div>
                  </div>
                </button>
              ))}
            </div>
            {list.length === 0 && <p className="text-xs text-slate-500">No finished tests yet.</p>}
          </>
        )}
      </main>

      {detail && (
        <AttemptViewer detail={detail} mode="scorer" title={`${detail.anon_code}  (#${idx + 1} of ${list.length})`}
                       onClose={() => setDetail(null)} onSaveScore={save}
                       onPrev={idx > 0 ? () => open(list[idx - 1].id) : null}
                       onNext={idx >= 0 && idx < list.length - 1 ? () => open(list[idx + 1].id) : null} />
      )}
    </div>
  );
}
