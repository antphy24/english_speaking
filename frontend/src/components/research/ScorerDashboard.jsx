import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, CheckCircle2, Circle, RefreshCw } from 'lucide-react';
import { Button } from '../UI/Button';
import { Field, Select } from '../UI/Field';
import { Alert } from '../UI/Alert';
import { Logo } from '../UI/Logo';
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
    <div className="min-h-screen bg-canvas text-ink">
      <header className="bg-surface border-b border-line px-4 md:px-8 py-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Logo size="sm" markOnly />
          <div className="min-w-0 leading-tight">
            <div className="text-sm font-semibold text-ink">Scorer</div>
            <div className="text-xs text-ink-subtle truncate">{user?.user_metadata?.full_name}</div>
          </div>
        </div>
        <Button variant="subtle" size="sm" icon={LogOut} onClick={logout}>Sign out</Button>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-6 md:px-8 md:py-10 space-y-5">
        {error && <Alert tone="error">{error}</Alert>}
        {loading && <p className="text-sm text-ink-muted">Loading...</p>}
        {!loading && studies.length === 0 && <p className="text-[15px] text-ink-muted">You are not linked to a study yet.</p>}

        {studies.length > 1 && (
          <Field label="Study">
            <Select value={studyId || ''} onChange={(e) => setStudyId(e.target.value)}>
              {studies.map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
            </Select>
          </Field>
        )}
        {studies.length === 1 && <h1 className="text-[22px] md:text-[28px] font-bold tracking-tight text-ink">{studies[0].title}</h1>}

        {studyId && (
          <>
            <Alert tone="info">
              Each code is one student's test. Listen to all answers, then score the whole test with the rubric (1-5 per aspect).
              <span className="block text-ink-muted mt-1">Names are hidden and the order is random. The AI score appears only after you save yours.</span>
            </Alert>
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1">
                <span className="text-sm text-ink-muted"><b className="text-ink">{done}</b> of {list.length} scored</span>
                <div className="mt-1.5 h-2 bg-line rounded-full overflow-hidden max-w-xs">
                  <div className="h-full bg-success rounded-full" style={{ width: `${list.length ? (done / list.length) * 100 : 0}%` }} />
                </div>
              </div>
              <Button variant="secondary" size="sm" icon={RefreshCw} onClick={loadList} aria-label="Refresh the list" />
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
              {list.map((x, i) => (
                <button key={x.id} type="button" onClick={() => open(x.id)}
                        className={`flex items-center gap-3 p-3.5 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-ring ${x.scored_by_me ? 'bg-success-tint border-success/30' : 'bg-surface border-line hover:border-brand'}`}>
                  {x.scored_by_me ? <CheckCircle2 className="w-5 h-5 text-success shrink-0" aria-label="Scored" /> : <Circle className="w-5 h-5 text-ink-subtle shrink-0" aria-label="Not scored yet" />}
                  <div>
                    <div className="text-xs text-ink-subtle">#{i + 1}</div>
                    <div className="text-[15px] tabular-nums font-semibold text-ink">{x.anon_code}</div>
                  </div>
                </button>
              ))}
            </div>
            {list.length === 0 && <p className="text-sm text-ink-subtle">No finished tests yet.</p>}
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
