import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Mic, Volume2, Repeat, CheckCircle2, AlertTriangle, Loader2, ShieldCheck, ArrowLeft, Square } from 'lucide-react';
import { supabaseStudent } from '../../utils/supabaseClient';
import { researchRequest, newId } from '../../utils/researchApi';
import { speakEnglish, stopSpeaking, speechSupported } from '../../utils/speech';
import useBeforeUnload from '../../hooks/useBeforeUnload';

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
    <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden">
      <div className="h-full bg-gradient-to-r from-emerald-500 to-lime-400 transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
    </div>
  );
}

function Shell({ children, title }) {
  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col items-center px-4 py-6 md:py-10">
      <div className="w-full max-w-2xl">
        {title && <div className="text-[11px] text-slate-500 uppercase tracking-wider mb-3">{title}</div>}
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
    return <Shell><div className="flex justify-center py-24"><Loader2 className="w-8 h-8 animate-spin text-indigo-400" /></div></Shell>;
  }

  if (stage === 'error') {
    return (
      <Shell>
        <div className="bg-rose-500/10 border border-rose-500/20 rounded-2xl p-5 space-y-3">
          <p className="text-sm text-rose-300 flex gap-2"><AlertTriangle className="w-5 h-5 shrink-0" />{error}</p>
          <button onClick={load} className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold">Try again</button>
        </div>
      </Shell>
    );
  }

  if (stage === 'closed') {
    return (
      <Shell>
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 text-center space-y-3">
          <p className="text-sm text-slate-300">This speaking test is not open for you right now. Ask your teacher.</p>
          <button onClick={() => navigate('/practice')} className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold">Back</button>
        </div>
      </Shell>
    );
  }

  if (stage === 'done') {
    return (
      <Shell>
        <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-2xl p-6 text-center space-y-3">
          <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto" />
          <h2 className="text-xl font-bold text-white">Thank you!</h2>
          <p className="text-sm text-slate-300">Your answers have been saved. You can close this page now.</p>
          <button onClick={() => navigate('/practice')} className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold">Back to HreFSpeak</button>
        </div>
      </Shell>
    );
  }

  if (stage === 'declined') {
    return (
      <Shell>
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-3 text-center">
          <p className="text-sm text-slate-300">Kamu memilih tidak setuju, jadi tes tidak dimulai. Beri tahu gurumu.</p>
          <div className="flex justify-center gap-2">
            <button onClick={() => setStage('consent')} className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold">Baca lagi</button>
            <button onClick={() => navigate('/practice')} className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 text-xs font-bold">Kembali</button>
          </div>
        </div>
      </Shell>
    );
  }

  if (stage === 'consent') {
    return (
      <Shell title={info?.title}>
        <button onClick={() => navigate('/practice')} className="flex items-center gap-1 text-xs text-slate-400 mb-3"><ArrowLeft className="w-3.5 h-3.5" />Kembali</button>
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><ShieldCheck className="w-5 h-5 text-indigo-300" />Persetujuan</h2>
          <div className="text-sm text-slate-300 whitespace-pre-line leading-relaxed max-h-[50vh] overflow-y-auto">{info?.consent_text}</div>
          <label className="flex items-start gap-2 text-sm text-white">
            <input type="checkbox" className="mt-1" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
            Saya sudah membaca dan memahami penjelasan di atas.
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <button disabled={!agree} onClick={() => giveConsent(true)} className="flex-1 py-3 rounded-xl bg-indigo-600 disabled:opacity-40 text-white text-sm font-bold">Saya setuju, mulai tes</button>
            <button onClick={() => giveConsent(false)} className="sm:w-48 py-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 text-sm font-bold">Saya tidak setuju</button>
          </div>
          <p className="text-[11px] text-slate-500">About {info?.questions} questions · around {info?.minutes} minutes. Use a quiet place and headphones or a loud enough speaker.</p>
        </div>
      </Shell>
    );
  }

  if (stage === 'miccheck') {
    return (
      <Shell title={attempt?.title}>
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-lg font-bold text-white flex items-center gap-2"><Mic className="w-5 h-5 text-indigo-300" />Microphone check</h2>
          <p className="text-sm text-slate-300">Tap the button, allow the microphone, then say "Hello, my name is ..." The green bar should move when you speak.</p>
          {!micReady ? (
            <button onClick={startMic} className="w-full py-3 rounded-xl bg-indigo-600 text-white text-sm font-bold">Turn on microphone</button>
          ) : (
            <>
              <LevelBar level={mic.level} />
              <button onClick={() => { speakEnglish('Can you hear me clearly?'); }} className="flex items-center gap-2 text-xs text-indigo-300">
                <Volume2 className="w-4 h-4" />Test the speaker
              </button>
              <button onClick={() => setStage('intro')} className="w-full py-3 rounded-xl bg-indigo-600 text-white text-sm font-bold">The bar moves - continue</button>
            </>
          )}
          {micError && <p className="text-xs text-rose-400">{micError}</p>}
          {attempt && attempt.total > queue.length && (
            <p className="text-xs text-amber-300">You already answered {attempt.total - queue.length} of {attempt.total} questions. The test continues where you stopped.</p>
          )}
        </div>
      </Shell>
    );
  }

  if (stage === 'intro') {
    return (
      <Shell title={attempt?.title}>
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4">
          <h2 className="text-lg font-bold text-white">How the test works</h2>
          <p className="text-sm text-slate-200">{attempt.content.intro}</p>
          <ul className="text-xs text-slate-400 list-disc pl-5 space-y-1">
            <li>Each question is read aloud and shown on the screen.</li>
            <li>Recording starts by itself a few seconds after the question (or tap "Start answering").</li>
            {maxRepeats > 0 && <li>You may hear each question again {maxRepeats === 1 ? 'once' : `${maxRepeats} times`} before you answer.</li>}
            <li>Each answer has a time limit. Tap "I'm finished" when you are done.</li>
            <li>You cannot go back to a question after answering it.</li>
          </ul>
          <button onClick={() => { speakEnglish(attempt.content.intro); }} className="flex items-center gap-2 text-xs text-indigo-300"><Volume2 className="w-4 h-4" />Listen to the instructions</button>
          <button onClick={() => { speakEnglish("Let's begin."); /* unlocks speech on iPhone */ if (queue.length === 0) submit(); else setStage('question'); }}
                  className="w-full py-3 rounded-xl bg-indigo-600 text-white text-sm font-bold">Start the test</button>
        </div>
      </Shell>
    );
  }

  if (stage === 'submitting') {
    return <Shell><div className="flex flex-col items-center gap-3 py-24 text-sm text-slate-300"><Loader2 className="w-8 h-8 animate-spin text-indigo-400" />Finishing the test...</div></Shell>;
  }

  // stage === 'question'
  if (!current) return null;
  const answered = attempt.total - queue.length + index;
  const showPartHeader = index === 0 || queue[index - 1]?.part.id !== current.part.id;

  return (
    <Shell title={`${attempt.title} · Question ${answered + 1} of ${attempt.total}`}>
      <div className="h-1.5 w-full bg-slate-800 rounded-full overflow-hidden mb-4">
        <div className="h-full bg-indigo-500" style={{ width: `${(answered / attempt.total) * 100}%` }} />
      </div>
      <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div>
          <div className="text-xs font-bold text-indigo-300 uppercase tracking-wider">{current.part.title}</div>
          {showPartHeader && current.part.instructions && <p className="text-xs text-slate-400 mt-1">{current.part.instructions}</p>}
        </div>
        {current.part.image_url && (
          <img src={current.part.image_url} alt="Look at this picture" className="w-full max-h-[45vh] object-contain rounded-xl bg-black" />
        )}
        <p className="text-lg md:text-xl font-bold text-white leading-snug">{current.prompt}</p>

        {phase === 'reading' && (
          <p className="text-sm text-slate-400 flex items-center gap-2"><Volume2 className="w-4 h-4 animate-pulse text-indigo-300" />Listen to the question...</p>
        )}

        {phase === 'waiting' && (
          <div className="space-y-3">
            <p className="text-sm text-slate-300">
              {current.prep_seconds > 0 ? 'Think about your answer.' : 'Get ready.'} Recording starts in <b className="text-white text-lg">{countdown}</b> s.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <button onClick={startRecording} className="flex-1 py-3 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-bold flex items-center justify-center gap-2">
                <Mic className="w-4 h-4" />Start answering now
              </button>
              {maxRepeats > 0 && (
                <button onClick={repeatQuestion} disabled={repeats >= maxRepeats}
                        className="sm:w-56 py-3 rounded-xl bg-slate-900 border border-slate-800 text-slate-300 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-40">
                  <Repeat className="w-4 h-4" />{repeats >= maxRepeats ? 'Already repeated' : 'Hear the question again'}
                </button>
              )}
            </div>
          </div>
        )}

        {phase === 'recording' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm font-bold text-rose-400"><span className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />Recording - speak now</span>
              <span className="text-sm text-slate-300"><b className="text-white text-lg">{countdown}</b> s left</span>
            </div>
            <LevelBar level={mic.level} />
            <button onClick={stopRecording} disabled={Date.now() - startedAtRef.current < 3000}
                    className="w-full py-3 rounded-xl bg-slate-100 text-slate-900 text-sm font-bold flex items-center justify-center gap-2 disabled:opacity-60">
              <Square className="w-4 h-4" />I'm finished
            </button>
          </div>
        )}

        {phase === 'uploading' && (
          <p className="text-sm text-slate-300 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin text-indigo-300" />{uploadMsg || 'Saving your answer...'}</p>
        )}
      </div>
    </Shell>
  );
}
