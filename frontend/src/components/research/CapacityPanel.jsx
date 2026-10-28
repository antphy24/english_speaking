import React, { useCallback, useEffect, useState } from 'react';
import { Gauge, RefreshCw, AlertTriangle, CheckCircle2, CalendarDays, HardDrive, Cpu, Mic } from 'lucide-react';
import { researchRequest } from '../../utils/researchApi';
import { supabaseTeacher } from '../../utils/supabaseClient';

function Stat({ label, value, sub, tone = 'text-white' }) {
  return (
    <div className="bg-surface border border-line rounded-xl p-3">
      <div className="text-xs text-ink-subtle">{label}</div>
      <div className={`text-xl font-extrabold ${tone}`}>{value}</div>
      {sub && <div className="text-xs text-ink-subtle mt-0.5">{sub}</div>}
    </div>
  );
}

/** How many students the free AI limits can handle per day. */
export default function CapacityPanel({ testId, totalStudents }) {
  const [cap, setCap] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setCap(await researchRequest(supabaseTeacher, `/capacity${testId ? `?test_id=${testId}` : ''}`));
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [testId]);

  useEffect(() => { load(); }, [load]);

  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!cap) return <p className="text-sm text-ink-muted">{loading ? 'Checking the free limits...' : ''}</p>;

  const t = cap.transcription;
  const s = cap.scoring;
  const per = cap.recommended_students_per_day;
  const days = totalStudents ? Math.ceil(totalStudents / per) : null;

  return (
    <div className="space-y-4">
      <div className="bg-brand-tint border border-brand/30 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
        <div className="flex items-start gap-3">
          <CalendarDays className="w-6 h-6 text-brand-ink shrink-0 mt-0.5" />
          <div>
            <div className="text-sm text-ink-muted">Schedule about</div>
            <div className="text-2xl font-extrabold text-ink">{per} students per day</div>
            <div className="text-xs text-ink-muted mt-0.5">
              Limited by {cap.bottleneck}.
              {days ? ` ${totalStudents} students → about ${days} day${days > 1 ? 's' : ''} per test.` : ''}
            </div>
          </div>
        </div>
        <button onClick={load} disabled={loading}
                className="self-start sm:self-center flex items-center gap-2 px-3 py-2 rounded-xl bg-surface-muted border border-line text-xs text-ink-muted">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <p className="text-xs text-ink-muted">
        Students can take the test faster than this. Their recordings are stored immediately and waiting work
        continues automatically after each daily reset, so nothing is lost. Scheduling this many per day just keeps
        the scoring from falling behind.
      </p>

      <div className="bg-surface border border-line rounded-2xl p-4 space-y-3">
        <h4 className="text-sm font-bold text-ink flex items-center gap-2"><Cpu className="w-4 h-4 text-brand-ink" />AI scoring (Gemini listens to the audio)</h4>
        {s.check && (
          <p className={`text-xs flex items-center gap-1.5 ${s.check.ok ? 'text-success' : 'text-danger'}`}>
            {s.check.ok ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            {s.check.message}
          </p>
        )}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="Students / day" value={s.students_per_day} sub={`${s.requests_per_day} requests ÷ ${s.runs_per_test} run(s)`} />
          <Stat label="Left today" value={s.students_left_today} tone={s.quota_used_up ? 'text-danger' : 'text-white'}
                sub={s.quota_used_up ? 'quota used up' : `${s.used_today} requests used`} />
          <Stat label="Resets at" value={s.resets_at_local} sub="WITA (midnight US Pacific)" />
          <Stat label="Model" value={<span className="text-sm">{s.model}</span>}
                sub={s.requests_learned_from_google ? 'limit reported by Google' : 'limit from settings (estimate)'} />
        </div>
      </div>

      <div className="bg-surface border border-line rounded-2xl p-4 space-y-3">
        <h4 className="text-sm font-bold text-ink flex items-center gap-2"><Mic className="w-4 h-4 text-brand-ink" />Transcription (Groq Whisper)</h4>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          <Stat label="Students / day" value={t.students_per_day} sub={`~${t.est_audio_seconds_per_student}s audio each (${t.estimate_from})`} />
          <Stat label="Students / hour" value={t.students_per_hour} />
          <Stat label="Left today" value={t.students_left_today} sub={`resets ${t.resets_at_local} WITA`} />
          <Stat label="Models" value={<span className="text-sm">{t.models.length}</span>} sub={t.models.map((m) => m.model).join(', ')} />
        </div>
        <p className="text-xs text-ink-subtle">{t.note}</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="bg-surface border border-line rounded-2xl p-4">
          <h4 className="text-sm font-bold text-ink flex items-center gap-2 mb-2"><Gauge className="w-4 h-4 text-brand-ink" />Waiting work</h4>
          <p className="text-xs text-ink-muted">{cap.backlog.answers_waiting_transcription ?? '-'} answers waiting for transcription</p>
          <p className="text-xs text-ink-muted">{cap.backlog.tests_waiting_scoring ?? '-'} tests waiting for AI scoring</p>
          {cap.backlog.days_to_clear > 0 && (
            <p className="text-xs text-warning mt-1">About {cap.backlog.days_to_clear} day(s) to score everything waiting.</p>
          )}
        </div>
        <div className="bg-surface border border-line rounded-2xl p-4">
          <h4 className="text-sm font-bold text-ink flex items-center gap-2 mb-2"><HardDrive className="w-4 h-4 text-brand-ink" />Recording storage</h4>
          <p className="text-xs text-ink-muted">{cap.storage.used_mb ?? '-'} MB used by research recordings</p>
          <p className="text-xs text-ink-muted">~{cap.storage.est_mb_per_student_test} MB per student per test · free plan {cap.storage.limit_mb} MB (shared with practice recordings)</p>
        </div>
      </div>
    </div>
  );
}
