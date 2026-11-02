import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Mic, MicOff, RefreshCw, Volume2, Repeat, Square, Loader2, ListChecks, X } from 'lucide-react';
import ScoreCard from './UI/ScoreCard';
import { Button } from './UI/Button';
import { PickerList } from './UI/PickerList';
import { ErrorPanel } from './UI/ErrorPanel';
import { TextSizeControl, useReadingSize } from './UI/TextSizeControl';
import SubmissionProgress from './UI/SubmissionProgress';
import useSubmission from '../hooks/useSubmission';
import {
  newClientId,
  retrySubmissionOnServer,
  submitRecording,
  waitForSubmission,
} from '../utils/api';
import { speakEnglish, stopSpeaking, speechSupported } from '../utils/speech';
import { buildQaSets } from '../utils/qaSets';
import { DEFAULT_TIMERS, describeDuration } from '../utils/timerSettings';

/*
 * Q&A practice, run like the research speaking test: the student answers a whole
 * set of questions in one session. Each question is read aloud, the student gets a
 * short thinking time, then one recording per answer (with a time limit). Answers
 * upload and transcribe in the background while the next question runs; at the end
 * the whole session is graded once with the research rubric (Brown, 2004:
 * pronunciation, fluency, vocabulary, grammar, comprehension - 1-5 each).
 */

const MAX_REPEATS = 1;          // "Hear the question again" per question, as in the research test
const MIN_ANSWER_SECONDS = 3;   // "I'm finished" unlocks after this
const TURN_ATTEMPTS = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const isApple = () => /iPhone|iPad|iPod/i.test(navigator.userAgent || '') ||
  (/Macintosh/i.test(navigator.userAgent || '') && navigator.maxTouchPoints > 1);

function pickMime() {
  if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) return '';
  const list = isApple()
    ? ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm']
    : ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus'];
  return list.find((t) => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || '';
}

/** One microphone for the whole session: one permission prompt, a level meter, one recorder per answer. */
function useLiveMic() {
  const streamRef = useRef(null);
  const ctxRef = useRef(null);
  const rafRef = useRef(null);
  const [level, setLevel] = useState(0);

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
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      ctx.createMediaStreamSource(stream).connect(analyser);
      ctxRef.current = ctx;
      const data = new Uint8Array(analyser.fftSize);
      const tick = () => {
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i += 1) { const v = (data[i] - 128) / 128; sum += v * v; }
        setLevel(Math.min(1, Math.sqrt(sum / data.length) * 4));
        rafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* the level meter is optional */ }
    return stream;
  }, []);

  const close = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    try { ctxRef.current?.close(); } catch { /* ignore */ }
    ctxRef.current = null;
    setLevel(0);
  }, []);

  useEffect(() => close, [close]);
  return { open, close, level, streamRef };
}

function LevelBar({ level }) {
  return (
    <div className="h-3 w-full bg-surface-muted rounded-full overflow-hidden" role="meter" aria-label="Microphone level"
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(level * 100)}>
      <div className="h-full bg-success rounded-full transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
    </div>
  );
}

const combinedTranscript = (answers) => answers
  .map((a, i) => `Q${i + 1}. ${a.question}\nAnswer: ${a.transcript || '(no speech)'}`)
  .join('\n\n');

export function ModeQA({ studentName, apiBase, onSaveScore, getSessionSeconds, customQuestions = [], timers = DEFAULT_TIMERS.qa }) {
  const sets = buildQaSets(customQuestions);
  const [selectedSet, setSelectedSet] = useState(sets[0]);
  const readingSize = useReadingSize();
  const mic = useLiveMic();

  // Keep the selection valid when the teacher's materials load or change.
  useEffect(() => {
    setSelectedSet((prev) => sets.find((s) => s.id === prev?.id) || sets[0]);
  }, [customQuestions]); // eslint-disable-line react-hooks/exhaustive-deps

  // stage: pick | session | finishing | grading | graded | error
  const [stage, setStage] = useState('pick');
  const [errorMessage, setErrorMessage] = useState('');
  const [errorKind, setErrorKind] = useState(''); // 'mic' | 'turns' | 'grade' | 'empty'
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState('reading'); // reading | waiting | recording
  const [countdown, setCountdown] = useState(0);
  const [repeats, setRepeats] = useState(0);
  const [turnsReady, setTurnsReady] = useState(0);
  const [evaluation, setEvaluation] = useState(null);
  const [answers, setAnswers] = useState([]);       // [{question, transcript, ...}] shown with the result
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  const grader = useSubmission(apiBase, 'qa');
  const sessionRef = useRef(null);   // { set, timers, turns: [], controller }
  const timerRef = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const startedAtRef = useRef(0);
  const repeatsRef = useRef(0);
  const savedOnServerRef = useRef(false);
  const resultMetaRef = useRef({});

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

  // Stop everything when the student leaves the tab; graded results resume on return.
  useEffect(() => () => {
    clearTimer();
    stopSpeaking();
    sessionRef.current?.controller.abort();
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') { rec.onstop = null; try { rec.stop(); } catch { /* ignore */ } }
  }, []);

  // ------------------------------------------------------------------ background transcription
  const processTurn = async (turn, signal) => {
    for (let attempt = 1; attempt <= TURN_ATTEMPTS; attempt += 1) {
      try {
        if (!turn.subId) {
          turn.uploadId = turn.uploadId || newClientId();
          const view = await submitRecording(apiBase, {
            blob: turn.blob, mode: 'transcribe', duration: turn.duration,
            params: { keep_as: turn.slot }, // keep the recording so student and teacher can replay it
            clientId: turn.uploadId,
          });
          turn.subId = view.id;
        } else if (attempt > 1) {
          await retrySubmissionOnServer(apiBase, turn.subId);
        }
        const view = await waitForSubmission(apiBase, turn.subId, { signal });
        turn.transcript = (view.transcript || view.result?.text || '').trim();
        turn.status = 'done';
        return;
      } catch (err) {
        if (err?.cancelled || signal.aborted) { turn.status = 'cancelled'; return; }
        if (err?.needsRerecord) { turn.transcript = ''; turn.status = 'empty'; return; } // nothing usable was heard
        if (err?.lost) { turn.subId = null; turn.uploadId = null; }
        const giveUp = attempt === TURN_ATTEMPTS || err?.view?.daily_limit || (!err?.retryable && !err?.lost);
        if (giveUp) { turn.status = 'failed'; turn.error = err?.message || 'Network problem.'; return; }
        await sleep(3000 * attempt);
      }
    }
  };

  const runTurn = (turn) => {
    const session = sessionRef.current;
    turn.status = 'working';
    turn.promise = processTurn(turn, session.controller.signal).finally(() => {
      if (sessionRef.current === session) {
        setTurnsReady(session.turns.filter((t) => t.status === 'done' || t.status === 'empty').length);
      }
    });
    return turn.promise;
  };

  // ------------------------------------------------------------------ session flow
  const resetResult = () => {
    grader.clear();
    setEvaluation(null);
    setAnswers([]);
    setSaveStatus('');
    setErrorMessage('');
    setErrorKind('');
  };

  const startSession = async () => {
    resetResult();
    speakEnglish("Let's begin."); // must happen inside the tap: unlocks speech on iPhone
    try {
      await mic.open();
    } catch (e) {
      stopSpeaking();
      setErrorKind('mic');
      setErrorMessage(e?.name === 'NotAllowedError'
        ? 'The microphone is blocked. Allow the microphone for this site in your browser settings, then try again.'
        : (e?.message || 'No microphone was found.'));
      setStage('error');
      return;
    }
    sessionRef.current?.controller.abort();
    sessionRef.current = { set: selectedSet, timers, turns: [], controller: new AbortController() };
    setTurnsReady(0);
    setIndex(0);
    setStage('session');
  };

  const quitSession = () => {
    readTokenRef.current += 1;
    clearTimer();
    stopSpeaking();
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') { rec.onstop = null; try { rec.stop(); } catch { /* ignore */ } }
    sessionRef.current?.controller.abort();
    sessionRef.current = null;
    mic.close();
    setStage('pick');
  };

  // Each reading gets a token, so a late "finished reading" (speech end event or the
  // fallback timer) from an earlier reading can never restart the countdown.
  const readTokenRef = useRef(0);

  const readQuestion = (question, isRepeat = false) => {
    const token = ++readTokenRef.current;
    if (!isRepeat) { repeatsRef.current = 0; setRepeats(0); }
    setPhase('reading');
    const afterReading = () => {
      if (token !== readTokenRef.current || !sessionRef.current) return;
      readTokenRef.current += 1; // handled once
      setPhase('waiting');
      startCountdown(sessionRef.current.timers.think, () => startRecordingRef.current?.());
    };
    if (!speechSupported() || !speakEnglish(question, { rate: 0.9, onEnd: afterReading })) {
      afterReading();
      return;
    }
    // Some phones never fire onend: continue after a generous estimate.
    setTimeout(afterReading, 2500 + question.split(/\s+/).length * 600);
  };

  const currentQuestion = stage === 'session' ? sessionRef.current?.set.questions[index] : null;

  useEffect(() => {
    if (stage === 'session' && currentQuestion) readQuestion(currentQuestion);
  }, [stage, index]); // eslint-disable-line react-hooks/exhaustive-deps

  const repeatQuestion = () => {
    if (!currentQuestion || repeatsRef.current >= MAX_REPEATS || phase !== 'waiting') return;
    clearTimer();
    repeatsRef.current += 1;
    setRepeats(repeatsRef.current);
    readQuestion(currentQuestion, true);
  };

  const startRecordingRef = useRef(null);
  const startRecording = () => {
    readTokenRef.current += 1;
    clearTimer();
    stopSpeaking();
    const session = sessionRef.current;
    const stream = mic.streamRef.current;
    if (!session) return;
    if (!stream) {
      setErrorKind('mic');
      setErrorMessage('The microphone was disconnected. Start the set again.');
      setStage('error');
      return;
    }
    const mimeType = pickMime();
    let rec;
    try {
      rec = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 });
    } catch {
      rec = new MediaRecorder(stream);
    }
    const questionIndex = index;
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
    rec.onstop = () => {
      const type = (rec.mimeType || mimeType || 'audio/webm').split(';')[0];
      const blob = new Blob(chunksRef.current, { type });
      const duration = Math.round(((Date.now() - startedAtRef.current) / 1000) * 10) / 10;
      finishAnswer(questionIndex, blob, duration);
    };
    recorderRef.current = rec;
    rec.start(1000);
    startedAtRef.current = Date.now();
    setPhase('recording');
    startCountdown(session.timers.answer, () => stopRecording());
  };
  startRecordingRef.current = startRecording;

  const stopRecording = () => {
    clearTimer();
    const rec = recorderRef.current;
    if (rec && rec.state !== 'inactive') rec.stop();
  };

  const finishAnswer = (questionIndex, blob, duration) => {
    const session = sessionRef.current;
    if (!session) return;
    const turn = {
      index: questionIndex,
      slot: `qa_${questionIndex + 1}`,
      question: session.set.questions[questionIndex],
      blob,
      duration,
      repeats: repeatsRef.current,
      transcript: '',
      status: 'new',
    };
    session.turns[questionIndex] = turn;
    if (blob.size < 2000) {
      turn.status = 'empty'; // nothing was recorded
      turn.promise = Promise.resolve();
    } else {
      runTurn(turn);
    }
    if (questionIndex + 1 < session.set.questions.length) {
      setIndex(questionIndex + 1);
    } else {
      mic.close();
      finishSession();
    }
  };

  // ------------------------------------------------------------------ grading
  const finishSession = async () => {
    const session = sessionRef.current;
    if (!session) return;
    setStage('finishing');
    await Promise.all(session.turns.map((t) => t?.promise));
    if (sessionRef.current !== session) return; // quit meanwhile

    const failed = session.turns.filter((t) => t.status === 'failed');
    if (failed.length) {
      setErrorKind('turns');
      setErrorMessage(failed[0].error || 'Some answers could not be processed.');
      setStage('error');
      return;
    }
    if (session.turns.every((t) => !t.transcript)) {
      setErrorKind('empty');
      setErrorMessage('We could not hear any of your answers. Check your microphone, then try the set again.');
      setStage('error');
      return;
    }

    const sessionAnswers = session.turns.map((t) => ({
      question: t.question,
      transcript: t.transcript,
      duration_s: t.duration,
      speak_seconds: session.timers.answer,
      repeats: t.repeats,
      max_repeats: MAX_REPEATS,
    }));
    const audioSubs = Object.fromEntries(session.turns.filter((t) => t.subId && t.status === 'done').map((t) => [t.slot, t.subId]));
    resultMetaRef.current = { material_title: session.set.title, answers: sessionAnswers };
    setAnswers(sessionAnswers);
    await gradeSession({
      transcript: combinedTranscript(sessionAnswers),
      answers: sessionAnswers,
      material_title: session.set.title,
      audio_subs: audioSubs,
      session_seconds: getSessionSeconds?.(),
    });
  };

  const showResult = (view) => {
    savedOnServerRef.current = !!view.saved;
    setEvaluation(view.result);
    setStage('graded');
  };

  const showGradeError = (err) => {
    if (err?.cancelled) return; // left the tab; it resumes later
    console.error(err);
    setErrorKind('grade');
    setErrorMessage(err?.message || 'An error occurred during grading.');
    setStage('error');
  };

  const gradeSession = async (textBody) => {
    setStage('grading');
    try {
      showResult(await grader.run({ mode: 'qa', textBody, meta: resultMetaRef.current }));
    } catch (err) {
      showGradeError(err);
    }
  };

  // Resume a session that was being graded (page refresh / tab switch)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await grader.resume();
      if (!pending || cancelled) return;
      resultMetaRef.current = pending.meta || {};
      setAnswers(pending.meta?.answers || []);
      setStage('grading');
      try {
        const view = await pending.promise;
        if (!cancelled) showResult(view);
      } catch (err) {
        if (!cancelled) showGradeError(err);
      }
    })();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRetry = async () => {
    setErrorMessage('');
    if (errorKind === 'turns') {
      const session = sessionRef.current;
      if (!session) { setStage('pick'); return; }
      session.turns.filter((t) => t.status === 'failed').forEach((t) => runTurn(t));
      await finishSession();
      return;
    }
    setStage('grading');
    try {
      showResult(await grader.retry());
    } catch (err) {
      showGradeError(err);
    }
  };

  const handleRestart = () => {
    resetResult();
    sessionRef.current?.controller.abort();
    sessionRef.current = null;
    mic.close();
    setStage('pick');
  };

  // Auto-save the score when grading completes (normally the server already saved it)
  const handleSaveToLeaderboard = async () => {
    if (!evaluation || !studentName) return;
    setIsSaving(true);
    setSaveStatus('');
    try {
      const title = resultMetaRef.current?.material_title || selectedSet?.title;
      await onSaveScore('qa', { ...evaluation, material_title: title }, { alreadySaved: savedOnServerRef.current });
      setSaveStatus('success');
    } catch {
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };
  const saveRef = useRef(handleSaveToLeaderboard);
  saveRef.current = handleSaveToLeaderboard;
  useEffect(() => {
    if (stage === 'graded' && evaluation) {
      grader.clear(); // result is in hand; don't resume/save it twice
      saveRef.current();
    }
  }, [stage, evaluation]); // eslint-disable-line react-hooks/exhaustive-deps

  const { style: readingStyle, ...readingSizeControl } = readingSize;
  const activeTimers = sessionRef.current?.timers || timers;
  const total = sessionRef.current?.set.questions.length || selectedSet?.questions.length || 0;

  // ------------------------------------------------------------------ screens
  if (stage === 'pick') {
    const count = selectedSet?.questions.length || 0;
    const minutes = Math.max(1, Math.round((count * (timers.think + timers.answer)) / 60));
    return (
      <div className="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
        <PickerList
          title="Question sets"
          items={sets.map((s) => ({ id: s.id, title: s.title, meta: `${s.questions.length} question${s.questions.length === 1 ? '' : 's'}` }))}
          selectedId={selectedSet?.id}
          onSelect={(item) => setSelectedSet(sets.find((s) => s.id === item.id))}
        />
        <section className="flex-1 min-w-0 bg-surface border border-line rounded-2xl shadow-card p-5 md:p-7 space-y-5">
          <div>
            <span className="block text-[13px] font-semibold text-brand-ink">Speaking practice</span>
            <h2 className="text-lg font-bold text-ink leading-snug">{selectedSet?.title}</h2>
            <p className="text-sm text-ink-muted mt-1">
              {count} question{count === 1 ? '' : 's'} · about {minutes} min
            </p>
          </div>
          <ul className="text-sm text-ink-muted list-disc pl-5 space-y-1.5">
            <li>Each question is read aloud and shown on the screen.</li>
            <li>You get {describeDuration(timers.think)} to think, then recording starts by itself (or tap "Start answering now").</li>
            <li>You may hear each question again once before you answer.</li>
            <li>Each answer can be up to {describeDuration(timers.answer)}. Tap "I'm finished" when you are done.</li>
            <li>You cannot go back to a question after answering it. Your score comes after the last question.</li>
          </ul>
          <p className="text-sm text-ink-subtle">
            Scored with the research rubric: pronunciation, fluency, vocabulary, grammar and comprehension (1-5 each).
            Use a quiet place and headphones or a loud enough speaker.
          </p>
          <Button size="lg" fullWidth icon={Mic} onClick={startSession} disabled={!count}>Start the questions</Button>
        </section>
      </div>
    );
  }

  if (stage === 'session' && currentQuestion) {
    return (
      <section className="max-w-2xl mx-auto w-full space-y-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[13px] font-semibold text-ink-muted">
            {sessionRef.current.set.title} · Question {index + 1} of {total}
          </span>
          <Button variant="subtle" size="sm" icon={X} onClick={quitSession}>Quit</Button>
        </div>
        <div className="h-2 w-full bg-line rounded-full overflow-hidden" role="progressbar" aria-label="Progress"
          aria-valuemin={0} aria-valuemax={total} aria-valuenow={index}>
          <div className="h-full bg-brand rounded-full transition-[width]" style={{ width: `${(index / total) * 100}%` }} />
        </div>
        <div className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-7 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <p className="font-semibold text-ink leading-snug text-lg md:text-xl" style={readingStyle}>{currentQuestion}</p>
            <TextSizeControl {...readingSizeControl} />
          </div>

          {phase === 'reading' && (
            <p className="text-[15px] text-ink-muted flex items-center gap-2" aria-live="polite">
              <Volume2 className="w-5 h-5 animate-pulse text-brand-ink" />Listen to the question...
            </p>
          )}

          {phase === 'waiting' && (
            <div className="space-y-3">
              <p className="text-[15px] text-ink-muted" aria-live="polite">
                Think about your answer. Recording starts in <b className="text-ink text-xl tabular-nums">{countdown}</b> s.
              </p>
              <div className="flex flex-col sm:flex-row gap-2">
                <Button size="lg" icon={Mic} onClick={startRecording} className="flex-1">Start answering now</Button>
                <Button size="lg" variant="secondary" icon={Repeat} onClick={repeatQuestion} disabled={repeats >= MAX_REPEATS} className="sm:w-60">
                  {repeats >= MAX_REPEATS ? 'Already repeated' : 'Hear the question again'}
                </Button>
              </div>
            </div>
          )}

          {phase === 'recording' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-[15px] font-semibold text-danger">
                  <span className="w-2.5 h-2.5 rounded-full bg-danger-solid animate-pulse" />Recording - speak now
                </span>
                <span className="text-[15px] text-ink-muted"><b className="text-ink text-xl tabular-nums">{countdown}</b> s left</span>
              </div>
              <LevelBar level={mic.level} />
              <Button size="lg" fullWidth variant="danger" icon={Square} onClick={stopRecording}
                disabled={Date.now() - startedAtRef.current < MIN_ANSWER_SECONDS * 1000}>
                I'm finished
              </Button>
            </div>
          )}
        </div>
        <p className="text-[13px] text-ink-subtle text-center">
          {activeTimers && `Up to ${describeDuration(activeTimers.answer)} per answer.`} Your answers are saved as you go.
        </p>
      </section>
    );
  }

  if (stage === 'finishing') {
    return (
      <div className="bg-surface border border-line rounded-2xl shadow-card p-8 flex flex-col items-center gap-3 text-center">
        <Loader2 className="w-8 h-8 animate-spin text-brand-ink" />
        <p className="text-[15px] font-semibold text-ink">Getting your answers ready...</p>
        <p className="text-sm text-ink-muted tabular-nums">{turnsReady} of {total} answers transcribed</p>
      </div>
    );
  }

  if (stage === 'grading') {
    return <SubmissionProgress progress={grader.progress} />;
  }

  if (stage === 'graded') {
    return (
      <div className="space-y-4">
        <ScoreCard
          mode="qa"
          score={evaluation}
          onRestart={handleRestart}
          isSaving={isSaving}
          saveStatus={saveStatus}
          onSaveToLeaderboard={handleSaveToLeaderboard}
        />
        {answers.length > 0 && (
          <div className="bg-surface border border-line rounded-2xl p-5 md:px-7 space-y-4">
            <h4 className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              <ListChecks className="w-4 h-4 text-ink-subtle" aria-hidden="true" />What the AI heard
            </h4>
            {answers.map((a, i) => (
              <div key={i} className="space-y-1">
                <div className="text-[13px] font-semibold text-ink-muted">Q{i + 1}. {a.question}</div>
                <p className="text-[15px] text-ink leading-relaxed">
                  {a.transcript ? `“${a.transcript}”` : <span className="text-ink-subtle">(no speech was heard)</span>}
                </p>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // stage === 'error'
  const canRetry = errorKind === 'turns' || (errorKind === 'grade' && grader.progress?.retryable && grader.hasRecording());
  return (
    <ErrorPanel
      icon={MicOff}
      title={canRetry ? 'Not finished yet' : 'Session stopped'}
      message={errorMessage}
      note={canRetry ? 'Your answers are saved. Tap Retry - you do not need to answer again.' : undefined}
    >
      {canRetry && <Button icon={RefreshCw} onClick={handleRetry}>Retry</Button>}
      <Button variant="secondary" icon={Mic} onClick={handleRestart}>Start again</Button>
    </ErrorPanel>
  );
}
export default ModeQA;
