import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Mic, Volume2, Repeat, CheckCircle2, AlertTriangle, Loader2, ShieldCheck, ArrowLeft, Square } from 'lucide-react';
import { supabaseStudent } from '../../utils/supabaseClient';
import { researchRequest, newId } from '../../utils/researchApi';
import { speakEnglish, stopSpeaking, speechSupported } from '../../utils/speech';
import useBeforeUnload from '../../hooks/useBeforeUnload';
import { Button } from '../UI/Button';
import { Logo } from '../UI/Logo';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const AUTO_START_SECONDS = 10; // after the question was read, recording starts by itself after this

const isApple = () => /iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
  (/Macintosh/i.test(navigator.userAgent || '') && navigator.maxTouchPoints > 1);

function pickMime() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  const list = isApple() ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'] : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return list.find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || '';
}

function ext(type) {
  if (type.includes('mp4') || type.includes('m4a')) return 'm4a';
  if (type.includes('ogg')) return 'ogg';
  return 'webm';
}

/** Microphone for the whole test: one permission prompt, a level meter, one recorder per answer. */
function useMic() {
  const streamRef = useRef(null);
  const ctxRef = useRef(null);
  const analyserRef = useRef(null);
  const [level, setLevel] = useState(0);
  const rafRef = useRef(null);

  const open = useCallback(async () => {
    if (streamRef.current) return streamRef.current;
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      throw new Error('This browser cannot record. Use a recent Chrome, Edge or Safari (not inside WhatsApp/Instagram).');
    }
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      const ctx = new Ctx();
      await ctx.resume();
      const src = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      src.connect(analyser);
      ctxRef.current = ctx;
      analyserRef.current = analyser;
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) { const v = (data[i] - 128) / 128; sum += v * v; }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* level meter is optional */ }
    return stream;
  }, []);

  const close = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try { ctxRef.current?.close(); } catch { /* ignore */ }
  }, []);

  useEffect(() => close, [close]);
  return { open, close, level, streamRef };
}

function LevelBar({ level }) {
  return (
    <div className="h-3 w-full bg-surface-muted rounded-full overflow-hidden" role="meter" aria-label="Microphone level" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      <div className="h-full bg-success rounded-full transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
    </div>
  );
}

function Shell({ children, title }) {
  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col items-center px-4 py-6 md:py-10">
      <div className="w-full max-w-2xl">
        <div className="flex items-center justify-between gap-3 mb-5">
          <Logo size="sm" />
          {title && <div className="text-[13px] text-ink-subtle text-right">{title}</div>}
        </div>
        {children}
      </div>
    </div>
  );
}

export default function SpeakingTest() {
  const { testId } = useParams();
  const navigateFn = useNavigate();
  const navRef = useRef(navigateFn);
  navRef.current = navigateFn;
  const navigate = useCallback((to) => navRef.current(to), []);
  const mic = useMic();

  const [stage, setStage] = useState('loading'); // loading | consent | declined | miccheck | intro | question | submitting | done | closed | error
  const [error, setError] = useState('');
  const [info, setInfo] = useState(null);         // entry from /my-tests
  const [attempt, setAttempt] = useState(null);   // /my-attempts/{id}
  const [queue, setQueue] = useState([]);         // items still to answer
  const [index, setIndex] = useState(0);
  const [agree, setAgree] = useState(false);

  // per-question state
  const [phase, setPhase] = useState('reading'); // reading | waiting | recording | uploading
  const [repeats, setRepeats] = useState(0);
  const [countdown, setCountdown] = useState(0);
  const [uploadMsg, setUploadMsg] = useState('');
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const timerRef = useRef(null);
  const clientIdRef = useRef(null);

  useBeforeUnload(['question', 'submitting'].includes(stage), 'Your speaking test is not finished. If you leave now, the current answer is lost.');

  const fail = (msg) => { setError(msg); setStage('error'); };

  // ---- load ----
  const load = useCallback(async () => {
    setStage('loading');
    try {
      const { data: { session } } = await supabaseStudent.auth.getSession();
      if (!session) { navigate('/student/login'); return; }
      const tests = await researchRequest(supabaseStudent, '/my-tests');
      const t = tests.find((x) => x.test_id === testId);
      if (!t) { setStage('closed'); return; }
      setInfo(t);
      if (t.status === 'done') { setStage('done'); return; }
      if (t.status === 'in_progress' && t.attempt_id) {
        await loadAttempt(t.attempt_id);
        setStage('miccheck');
        return;
      }
      setStage('consent');
    } catch (e) {
      fail(e.message);
    }
  }, [testId, navigate]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadAttempt = async (attemptId) => {
    const a = await researchRequest(supabaseStudent, `/my-attempts/${attemptId}`);
    const items = [];
    a.content.parts.forEach((p) => p.items.forEach((it) => items.push({ ...it, part: p })));
    const left = items.filter((it) => !a.answered.includes(it.id));
    setAttempt({ ...a, total: items.length });
    setQueue(left);
    setIndex(0);
    return { a, left };
  };

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => { stopSpeaking(); clearInterval(timerRef.current); }, []);

  // ---- consent ----
  const giveConsent = async (yes) => {
    setStage('loading');
    try {
      const res = await researchRequest(supabaseStudent, `/tests/${testId}/start`, { method: 'POST', body: { consent: yes } });
      if (!yes) { setStage('declined'); return; }
      await loadAttempt(res.attempt_id);
      setStage('miccheck');
    } catch (e) {
      fail(e.message);
    }
  };

  // ---- mic check ----
  const [micReady, setMicReady] = useState(false);
  const [micError, setMicError] = useState('');
  const startMic = async () => {
    setMicError('');
    try {
      await mic.open();
      setMicReady(true);
    } catch (e) {
      const name = e?.name || '';
      setMicError(name === 'NotAllowedError'
        ? 'Microphone is blocked. Allow the microphone for this site in your browser settings, then tap again.'
        : (e.message || 'No microphone found.'));
    }
  };

  // ---- questions ----
  const current = queue[index];
  const maxRepeats = attempt?.content?.max_repeats ?? 1;

  const clearTimer = () => { clearInterval(timerRef.current); timerRef.current = null; };

  const startCountdown = (seconds, onDone) => {
    clearTimer();
    setCountdown(seconds);
    const end = Date.now() + seconds * 1000;
    timerRef.current = setInterval(() => {
      const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
      setCountdown(left);
      if (left <= 0) { clearTimer(); onDone(); }
    }, 250);
  };

  const readQuestion = useCallback((item, isRepeat = false) => {
    setPhase('reading');
    const afterReading = () => {
      setPhase('waiting');
      const wait = Math.max(item.prep_seconds || 0, AUTO_START_SECONDS);
      startCountdown(wait, () => startRecordingRef.current?.());
    };
    if (!speechSupported()) { afterReading(); return; }
    let finished = false;
    const done = () => { if (!finished) { finished = true; afterReading(); } };
    const ok = speakEnglish(item.prompt, { rate: 0.9, onEnd: done });
    if (!ok) done();
    // Some phones never fire onend: continue after a generous estimate.
    setTimeout(done, 2500 + item.prompt.split(/\s+/).length * 600);
    if (!isRepeat) clientIdRef.current = newId();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const beginQuestion = (item) => {
    setRepeats(0);
    setUploadMsg('');
    readQuestion(item);
  };

  const repeatQuestion = () => {
    if (!current || repeats >= maxRepeats || phase !== 'waiting') return;
    clearTimer();
    setRepeats((r) => r + 1);
    readQuestion(current, true);
  };

  const startRecordingRef = useRef(null);
  const startRecording = () => {
    clearTimer();
    stopSpeaking();
    const stream = mic.streamRef.current;
    if (!stream) { fail('The microphone was disconnected. Reload the page to continue.'); return; }
    const mimeType = pickMime();
    let rec;
    try {
      rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 });
    } catch {
      rec = new MediaRecorder(stream);
    }
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const type = (rec.mimeType || mimeType || 'audio/webm').split(';')[0];
      const blob = new Blob(chunksRef.current, { type });
      const duration = (Date.now() - startedAtRef.current) / 1000;
      uploadAnswer(blob, duration);
    };
    recorderRef.current = rec;
    rec.start(1000);
    startedAtRef.current = Date.now();
    setPhase('recording');
    startCountdown(current.speak_seconds, () => stopRecording());
  };
  startRecordingRef.current = startRecording;

  const stopRecording = () => {
    clearTimer();
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  };

  const uploadAnswer = async (blob, duration) => {
    setPhase('uploading');
    const item = current;
    const form = () => {
      const f = new FormData();
      f.append('item_id', item.id);
      f.append('client_id', clientIdRef.current);
      f.append('repeats', String(repeats));
      f.append('duration', String(Math.round(duration * 10) / 10));
      f.append('file', blob, `answer.${ext(blob.type)}`);
      return f;
    };
    for (let attemptNo = 1; ; attemptNo += 1) {
      try {
        setUploadMsg(attemptNo === 1 ? 'Saving your answer...' : `Connection problem - trying again (${attemptNo})...`);
        await researchRequest(supabaseStudent, `/my-attempts/${attempt.attempt_id}/answer`, { method: 'POST', body: form(), retries: 0 });
        break;
      } catch (e) {
        if (e.status === 409) break; // already saved (e.g. the first try did arrive)
        if (e.status && e.status < 500 && e.status !== 408 && e.status !== 429) { fail(e.message); return; }
        await sleep(Math.min(2000 * attemptNo, 15000));
      }
    }
    setUploadMsg('');
    if (index + 1 < queue.length) {
      setIndex(index + 1);
    } else {
      submit();
    }
  };

  useEffect(() => {
    if (stage === 'question' && current) beginQuestion(current);
  }, [stage, index]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async () => {
    setStage('submitting');
    for (let n = 1; n <= 8; n += 1) {
      try {
        await researchRequest(supabaseStudent, `/my-attempts/${attempt.attempt_id}/submit`, { method: 'POST', retries: 1 });
        mic.close();
        setStage('done');
        return;
      } catch (e) {
        if (e.status === 409) { await loadAttempt(attempt.attempt_id); setStage('question'); return; }
        await sleep(3000 * n);
      }
    }
    fail('Your answers are saved, but the test could not be finished. Reload this page to try again.');
  };

  // ------------------------------------------------------------------ screens
  if (stage === 'loading') {
    return <Shell><div className="flex justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-brand-ink" /></div></Shell>;
  }

  if (stage === 'error') {
    return (
      <Shell>
        <div className="bg-danger-tint rounded-2xl p-5 space-y-3">
          <p className="text-sm text-danger flex gap-2"><AlertTriangle className="w-5 h-5 shrink-0" />{error}</p>
          <Button variant="secondary" onClick={load}>Try again</Button>
        </div>
      </Shell>
    );
  }

  if (stage === 'closed') {
    return (
      <Shell>
        <div className="bg-surface border border-line rounded-2xl shadow-card p-6 md:p-8 text-center space-y-3">
          <p className="text-[15px] text-ink-muted">This speaking test is not open for you right now. Ask your teacher.</p>
          <Button variant="secondary" onClick={() => navigate('/practice')}>Back</Button>
        </div>
      </Shell>
    );
  }

  if (stage === 'done') {
    return (
      <Shell>
        <div className="bg-surface border border-line rounded-2xl shadow-card p-6 md:p-8 text-center space-y-3">
          <CheckCircle2 className="w-12 h-12 text-success mx-auto" />
          <h2 className="text-xl font-bold text-ink">Thank you!</h2>
          <p className="text-[15px] text-ink-muted">Your answers have been saved. You can close this page now.</p>
          <Button variant="secondary" onClick={() => navigate('/practice')}>Back to HreFSpeak</Button>
        </div>
      </Shell>
    );
  }

  if (stage === 'declined') {
    return (
      <Shell>
        <div className="bg-surface border border-line rounded-2xl shadow-card p-6 md:p-8 space-y-4 text-center">
          <p className="text-[15px] text-ink-muted">Kamu memilih tidak setuju, jadi tes tidak dimulai. Beri tahu gurumu.</p>
          <div className="flex justify-center gap-2">
            <Button variant="secondary" onClick={() => setStage('consent')}>Baca lagi</Button>
            <Button variant="subtle" onClick={() => navigate('/practice')}>Kembali</Button>
          </div>
        </div>
      </Shell>
    );
  }

  if (stage === 'consent') {
    return (
      <Shell title={info?.title}>
        <Button variant="subtle" size="sm" icon={ArrowLeft} onClick={() => navigate('/practice')} className="mb-3 -ml-2">Kembali</Button>
        <div className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-7 space-y-5">
          <h2 className="text-lg font-bold text-ink flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-brand-ink" />Persetujuan</h2>
          <div className="text-[15px] text-ink whitespace-pre-line leading-relaxed max-h-[50vh] overflow-y-auto bg-surface-muted rounded-xl p-4">{info?.consent_text}</div>
          <label className="flex items-start gap-3 text-[15px] text-ink cursor-pointer">
            <input type="checkbox" className="mt-1 w-5 h-5 accent-brand shrink-0" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            Saya sudah membaca dan memahami penjelasan di atas.
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <Button size="lg" disabled={!agree} onClick={() => giveConsent(true)} className="flex-1">Saya setuju, mulai tes</Button>
            <Button size="lg" variant="secondary" onClick={() => giveConsent(false)} className="sm:w-52">Saya tidak setuju</Button>
          </div>
          <p className="text-[13px] text-ink-subtle">About {info?.questions} questions · around {info?.minutes} minutes. Use a quiet place and headphones or a loud enough speaker.</p>
        </div>
      </Shell>
    );
  }

  if (stage === 'miccheck') {
    return (
      <Shell title={attempt?.title}>
        <div className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-7 space-y-5">
          <h2 className="text-lg font-bold text-ink flex items-center gap-2"><Mic className="w-5 h-5 text-brand-ink" />Microphone check</h2>
          <p className="text-[15px] text-ink-muted">Tap the button, allow the microphone, then say "Hello, my name is ..." The green bar should move when you speak.</p>
          {!micReady ? (
            <Button size="lg" fullWidth icon={Mic} onClick={startMic}>Turn on microphone</Button>
          ) : (
            <>
              <LevelBar level={mic.level} />
              <Button variant="ghost" size="sm" icon={Volume2} onClick={() => { speakEnglish('Can you hear me clearly?'); }} className="-ml-3">Test the speaker</Button>
              <Button size="lg" fullWidth onClick={() => setStage('intro')}>The bar moves - continue</Button>
            </>
          )}
          {micError && <p className="text-sm text-danger">{micError}</p>}
          {attempt && attempt.total > queue.length && (
            <p className="text-sm text-warning">You already answered {attempt.total - queue.length} of {attempt.total} questions. The test continues where you stopped.</p>
          )}
        </div>
      </Shell>
    );
  }

  if (stage === 'intro') {
    return (
      <Shell title={attempt?.title}>
        <div className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-7 space-y-5">
          <h2 className="text-lg font-bold text-ink">How the test works</h2>
          <p className="text-[15px] text-ink leading-relaxed">{attempt.content.intro}</p>
          <ul className="text-sm text-ink-muted list-disc pl-5 space-y-1.5">
            <li>Each question is read aloud and shown on the screen.</li>
            <li>Recording starts by itself a few seconds after the question (or tap "Start answering").</li>
            {maxRepeats > 0 && <li>You may hear each question again {maxRepeats === 1 ? 'once' : `${maxRepeats} times`} before you answer.</li>}
            <li>Each answer has a time limit. Tap "I'm finished" when you are done.</li>
            <li>You cannot go back to a question after answering it.</li>
          </ul>
          <Button variant="ghost" size="sm" icon={Volume2} onClick={() => { speakEnglish(attempt.content.intro); }} className="-ml-3">Listen to the instructions</Button>
          <Button size="lg" fullWidth onClick={() => { speakEnglish("Let's begin."); /* unlocks speech on iPhone */ if (queue.length === 0) submit(); else setStage('question'); }}>
            Start the test
          </Button>
        </div>
      </Shell>
    );
  }

  if (stage === 'submitting') {
    return <Shell><div className="flex flex-col items-center gap-3 py-24 text-[15px] text-ink-muted"><Loader2 className="w-8 h-8 animate-spin text-brand-ink" />Finishing the test...</div></Shell>;
  }

  // stage === 'question'
  if (!current) return null;
  const answered = attempt.total - queue.length + index;
  const showPartHeader = index === 0 || queue[index - 1]?.part.id !== current.part.id;

  return (
    <Shell title={`${attempt.title} · Question ${answered + 1} of ${attempt.total}`}>
      <div className="h-2 w-full bg-line rounded-full overflow-hidden mb-4" role="progressbar" aria-label="Test progress" aria-valuemin={0} aria-valuemax={attempt.total} aria-valuenow={answered}>
        <div className="h-full bg-brand rounded-full transition-[width]" style={{ width: `${(answered / attempt.total) * 100}%` }} />
      </div>
      <div className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-7 space-y-5">
        <div>
          <div className="text-[13px] font-semibold text-brand-ink">{current.part.title}</div>
          {showPartHeader && current.part.instructions && <p className="text-sm text-ink-muted mt-1">{current.part.instructions}</p>}
        </div>
        {current.part.image_url && (
          <img src={current.part.image_url} alt="Look at this picture" className="w-full max-h-[45vh] object-contain rounded-xl bg-surface-muted" />
        )}
        <p className="text-lg md:text-xl font-semibold text-ink leading-snug">{current.prompt}</p>

        {phase === 'reading' && (
          <p className="text-[15px] text-ink-muted flex items-center gap-2" aria-live="polite"><Volume2 className="w-5 h-5 animate-pulse text-brand-ink" />Listen to the question...</p>
        )}

        {phase === 'waiting' && (
          <div className="space-y-3">
            <p className="text-[15px] text-ink-muted" aria-live="polite">
              {current.prep_seconds > 0 ? 'Think about your answer.' : 'Get ready.'} Recording starts in <b className="text-ink text-xl tabular-nums">{countdown}</b> s.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button size="lg" icon={Mic} onClick={startRecording} className="flex-1">Start answering now</Button>
              {maxRepeats > 0 && (
                <Button size="lg" variant="secondary" icon={Repeat} onClick={repeatQuestion} disabled={repeats >= maxRepeats} className="sm:w-60">
                  {repeats >= maxRepeats ? 'Already repeated' : 'Hear the question again'}
                </Button>
              )}
            </div>
          </div>
        )}

        {phase === 'recording' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-[15px] font-semibold text-danger"><span className="w-2.5 h-2.5 rounded-full bg-danger-solid animate-pulse" />Recording - speak now</span>
              <span className="text-[15px] text-ink-muted"><b className="text-ink text-xl tabular-nums">{countdown}</b> s left</span>
            </div>
            <LevelBar level={mic.level} />
            <Button size="lg" fullWidth variant="danger" icon={Square} onClick={stopRecording} disabled={Date.now() - startedAtRef.current < 3000}>
              I'm finished
            </Button>
          </div>
        )}

        {phase === 'uploading' && (
          <p className="text-[15px] text-ink-muted flex items-center gap-2" aria-live="polite"><Loader2 className="w-5 h-5 animate-spin text-brand-ink" />{uploadMsg || 'Saving your answer...'}</p>
        )}
      </div>
    </Shell>
  );
}
