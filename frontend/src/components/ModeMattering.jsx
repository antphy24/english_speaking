import React, { useState, useRef, useEffect } from 'react';
import {
  Mic, Square, Loader2, CheckCircle2, ArrowRight, Clock, AlertTriangle, Lightbulb,
  Users, GitBranch, Scale, FileText, Swords, BookOpen, Target, SkipForward, RotateCcw,
} from 'lucide-react';
import Spinner from './UI/Spinner';
import { Button } from './UI/Button';
import { Badge } from './UI/Badge';
import { Field, Select, Textarea } from './UI/Field';
import { RecordButton } from './UI/Recorder';
import { ErrorPanel } from './UI/ErrorPanel';
import { TextSizeControl, useReadingSize } from './UI/TextSizeControl';
import SubmissionProgress from './UI/SubmissionProgress';
import PinnedBar from './UI/PinnedBar';
import { DEFAULT_TIMERS, describeDuration } from '../utils/timerSettings';
import useSubmission from '../hooks/useSubmission';
import { useMediaRecorder } from '../hooks/useMediaRecorder';
import { getMatteringOpposition, saveSubmissionOnServer } from '../utils/api';

// A material is "motion on the first line, optional background below".
const DEFAULT_ISSUES = [
  {
    title: 'Phones in school',
    content: 'This House would ban smartphones in schools.\n'
      + 'Many schools now collect phones in the morning. Supporters point to distraction, cyberbullying and falling attention; '
      + 'critics point to safety, digital skills and the fact that students will use phones anyway after school.',
  },
  {
    title: 'Homework',
    content: 'This House would abolish homework.\n'
      + 'Homework gives extra practice, but it also depends on how much time, space and help a student has at home.',
  },
  {
    title: 'Social media age limit',
    content: 'This House would ban social media for children under 16.\n'
      + 'Some countries are raising the minimum age for social media accounts because of mental-health and safety concerns. '
      + 'Others say bans are hard to enforce and cut young people off from friends and information.',
  },
  {
    title: 'Single-use plastic',
    content: 'This House would ban single-use plastics.\n'
      + 'Plastic bags, straws and packaging are cheap and convenient but pollute rivers and seas. '
      + 'A ban affects small sellers, consumers and the companies that make packaging.',
  },
];

const AUDIO_SLOT = { argument: 'mattering', rebuttal: 'mattering_rebuttal' };
const GRACE_SECONDS = 15; // recording stops by itself this long after time is up

const BANDS = [
  ['69-70', 'No real contribution'],
  ['71-72', 'Minimal contribution'],
  ['73-74', 'Below average'],
  ['75', 'Average'],
  ['76-77', 'Slightly above average'],
  ['78-79', 'Strong'],
  ['80', 'Superior'],
  ['81', 'Exceptional'],
];

const NOTE_FIELDS = [
  {
    key: 'stakeholders', label: 'Stakeholders', icon: Users,
    hint: 'Who is affected? Who gains, who loses, who decides?',
    placeholder: 'e.g. students, teachers, parents, the school...',
  },
  {
    key: 'problem', label: 'Problem, cause and effect', icon: GitBranch,
    hint: 'What is the problem now? What causes it? What changes if the motion passes?',
    placeholder: 'Now: ...  Because: ...  If we do this: ...',
  },
  {
    key: 'principle', label: 'Principle at stake', icon: Scale,
    hint: 'Which big idea is this really about? (freedom, safety, fairness, responsibility...)',
    placeholder: 'e.g. protecting children vs. their freedom to choose',
  },
  {
    key: 'outline', label: 'My argument (AREL)', icon: FileText,
    hint: 'Assertion, Reasoning, Evidence/Example, Link back to the motion.',
    placeholder: 'A: ...\nR: ...\nE: ...\nL: ...',
  },
];

const EMPTY_NOTES = { stakeholders: '', problem: '', principle: '', outline: '' };

function parseIssue(material, idx) {
  const lines = String(material.content || '').split('\n');
  const motion = (lines.shift() || '').trim();
  return {
    id: material.id || `issue-${idx}`,
    title: (material.title || '').trim() || motion,
    motion,
    background: lines.join('\n').trim(),
  };
}

function notesToText(notes) {
  return NOTE_FIELDS
    .filter(f => (notes[f.key] || '').trim())
    .map(f => `${f.label}: ${notes[f.key].trim()}`)
    .join('\n');
}

const formatTime = (seconds) => {
  const safe = Math.max(0, seconds);
  const m = Math.floor(safe / 60).toString().padStart(2, '0');
  const s = (safe % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
};

export default function ModeMattering({ apiBase, onSaveScore, getSessionSeconds, isSaving, saveStatus, customIssues = [], timers = DEFAULT_TIMERS.mattering }) {
  // Times set by the teacher for this class (seconds)
  const BREAKDOWN_SECONDS = timers.breakdown;
  const ARGUMENT_SECONDS = timers.argument;
  const REBUTTAL_PREP_SECONDS = timers.rebuttal_prep;
  const REBUTTAL_SECONDS = timers.rebuttal;
  // setup -> breakdown -> argument -> working -> rebuttal -> working -> grading -> results   (or error)
  const [step, setStep] = useState('setup');
  const [issueId, setIssueId] = useState('');
  const [role, setRole] = useState('Affirmative');
  const [notes, setNotes] = useState(EMPTY_NOTES);
  const [timer, setTimer] = useState(BREAKDOWN_SECONDS);
  const [working, setWorking] = useState('transcribe'); // 'transcribe' | 'opposition'
  const [sparringBusy, setSparringBusy] = useState(false);
  const [argument, setArgument] = useState('');
  const [opposition, setOpposition] = useState('');
  const [rebuttal, setRebuttal] = useState('');
  const [result, setResult] = useState(null);
  const [errorMessage, setErrorMessage] = useState('');
  const [errorType, setErrorType] = useState(null); // 'argument' | 'rebuttal' | 'opposition' | 'grading' | 'mic'
  const readingSize = useReadingSize();
  const { style: readingStyle, ...readingSizeControl } = readingSize;

  const {
    isRecording, recordingTime, audioBlob, error: recordingError,
    startRecording, stopRecording, clearAudio,
  } = useMediaRecorder();

  // Each speech is transcribed through the live (priority) lane; the final
  // adjudication is one resumable text submission, like AI Conversation.
  const turn = useSubmission(apiBase, 'mattering_turn', { persist: false });
  const grader = useSubmission(apiBase, 'mattering');

  const issues = [
    ...(customIssues || []).map(parseIssue),
    ...DEFAULT_ISSUES.map((m, i) => parseIssue({ ...m, id: `default-${i}` }, i)),
  ].filter(i => i.motion);

  // Everything the grader needs, readable from async handlers without stale state.
  const dataRef = useRef({ title: '', motion: '', background: '', role: 'Affirmative', notes: '', argument: '', opposition: '', rebuttal: '' });
  const recordingForRef = useRef('argument'); // which speech the recorder is capturing
  const timerIntervalRef = useRef(null);

  const startCountdown = (seconds) => {
    clearInterval(timerIntervalRef.current);
    setTimer(seconds);
    timerIntervalRef.current = setInterval(() => {
      setTimer((prev) => {
        if (prev <= 1) {
          clearInterval(timerIntervalRef.current);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => () => clearInterval(timerIntervalRef.current), []);

  useEffect(() => {
    if (recordingError) {
      setErrorMessage(recordingError);
      setErrorType('mic');
      setStep('error');
    }
  }, [recordingError]);

  // Stop by itself shortly after the time limit so a speech can't run on forever.
  const speechLimit = recordingForRef.current === 'rebuttal' ? REBUTTAL_SECONDS : ARGUMENT_SECONDS;
  useEffect(() => {
    if (isRecording && recordingTime >= speechLimit + GRACE_SECONDS) stopRecording();
  }, [isRecording, recordingTime, speechLimit, stopRecording]);

  const fail = (type, err, fallback) => {
    if (err?.cancelled) return; // component unmounted
    if (err) console.error(err);
    setErrorMessage(err?.message || fallback);
    setErrorType(type);
    setStep('error');
  };

  // ---------------- Result + saving ----------------

  const showResult = async (view) => {
    const d = dataRef.current;
    const evaluation = view.result;
    setResult(evaluation);
    setStep('results');
    const scoreData = {
      ...evaluation,
      material_title: d.title || d.motion,
      motion: d.motion,
      role: d.role,
      notes: d.notes,
      transcript: d.argument,
      opposition: d.opposition,
      rebuttal_transcript: d.rebuttal,
    };
    const subId = grader.currentId();
    if (view.saved) {
      await onSaveScore('mattering', scoreData, { alreadySaved: true });
    } else {
      try {
        if (!subId) throw new Error('no submission id');
        await saveSubmissionOnServer(apiBase, subId);
        await onSaveScore('mattering', scoreData, { alreadySaved: true });
      } catch (err) {
        console.warn('Server save failed, saving from the browser instead', err);
        await onSaveScore('mattering', scoreData);
      }
    }
    grader.clear(); // result is shown and saved; don't resume it again
  };

  const runGrading = async () => {
    const d = dataRef.current;
    setStep('grading');
    try {
      const view = await grader.run({
        mode: 'mattering',
        textBody: {
          transcript: d.argument,
          motion: d.motion,
          role: d.role,
          notes: d.notes,
          opposition: d.opposition,
          rebuttal: d.rebuttal,
          audio_subs: d.audioSubs,
          material_title: d.title || d.motion,
          session_seconds: getSessionSeconds?.(),
        },
        meta: { ...d },
      });
      await showResult(view);
    } catch (err) {
      fail('grading', err, 'An error occurred during adjudication.');
    }
  };

  // Resume an adjudication that was still running (page refresh / tab switch)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await grader.resume();
      if (!pending || cancelled) return;
      const meta = pending.meta || {};
      dataRef.current = { ...dataRef.current, ...meta };
      if (meta.role) setRole(meta.role);
      setArgument(meta.argument || '');
      setOpposition(meta.opposition || '');
      setRebuttal(meta.rebuttal || '');
      setStep('grading');
      try {
        const view = await pending.promise;
        if (!cancelled) await showResult(view);
      } catch (err) {
        if (!cancelled) fail('grading', err, 'An error occurred during adjudication.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---------------- Round 1: argument ----------------

  const requestOpposition = async () => {
    const d = dataRef.current;
    setWorking('opposition');
    setSparringBusy(false);
    setStep('working');
    try {
      const text = await getMatteringOpposition(
        apiBase, { motion: d.motion, role: d.role, argument: d.argument },
        { onBusy: () => setSparringBusy(true) },
      );
      dataRef.current.opposition = text;
      setOpposition(text);
      setStep('rebuttal');
      startCountdown(REBUTTAL_PREP_SECONDS);
    } catch (err) {
      fail('opposition', err, 'The opposing argument could not be prepared.');
    } finally {
      setSparringBusy(false);
    }
  };

  const continueWithArgument = async (text) => {
    if (!text || !text.trim()) {
      fail('argument', null, 'No speech was detected. Check your microphone and record your argument again.');
      return;
    }
    dataRef.current.argument = text.trim();
    setArgument(text.trim());
    turn.clear();
    await requestOpposition();
  };

  // ---------------- Round 2: rebuttal ----------------

  const continueWithRebuttal = async (text) => {
    if (!text || !text.trim()) {
      fail('rebuttal', null, 'No speech was detected. Record your rebuttal again, or skip it.');
      return;
    }
    dataRef.current.rebuttal = text.trim();
    setRebuttal(text.trim());
    turn.clear();
    await runGrading();
  };

  const handleSkipRebuttal = async () => {
    clearInterval(timerIntervalRef.current);
    dataRef.current.rebuttal = '';
    if (dataRef.current.audioSubs) delete dataRef.current.audioSubs.mattering_rebuttal;
    setRebuttal('');
    turn.clear();
    await runGrading();
  };

  // ---------------- Recording ----------------

  // Which transcription turn holds each speech's recording (sent with the final grading request).
  const rememberAudio = (which, view) => {
    if (!view?.id || !AUDIO_SLOT[which]) return;
    dataRef.current.audioSubs = { ...(dataRef.current.audioSubs || {}), [AUDIO_SLOT[which]]: view.id };
  };

  const processRecording = async (blob) => {
    const which = recordingForRef.current;
    if (blob.size < 2000) {
      fail(which, null, 'The recording was too short. Please speak for at least a few seconds.');
      return;
    }
    setWorking('transcribe');
    setStep('working');
    try {
      const view = await turn.run({
        mode: 'transcribe', blob, duration: recordingTime,
        params: { keep_as: AUDIO_SLOT[which] }, // keep the recording so it can be replayed later
      });
      rememberAudio(which, view);
      const text = view.result?.text || view.transcript;
      if (which === 'rebuttal') await continueWithRebuttal(text);
      else await continueWithArgument(text);
    } catch (err) {
      fail(which, err, 'Your speech could not be transcribed.');
    }
  };

  const processRecordingRef = useRef(null);
  useEffect(() => { processRecordingRef.current = processRecording; });
  useEffect(() => {
    if (audioBlob && processRecordingRef.current) processRecordingRef.current(audioBlob);
  }, [audioBlob]);

  const beginRecording = (which) => {
    recordingForRef.current = which;
    clearInterval(timerIntervalRef.current);
    clearAudio();
    setErrorMessage('');
    startRecording();
  };

  // ---------------- Navigation ----------------

  const handleStartBreakdown = () => {
    const issue = issues.find(i => i.id === issueId);
    if (!issue) return;
    dataRef.current = {
      title: issue.title, motion: issue.motion, background: issue.background, role,
      notes: '', argument: '', opposition: '', rebuttal: '',
    };
    setStep('breakdown');
    startCountdown(BREAKDOWN_SECONDS);
  };

  const handleGoToArgument = () => {
    clearInterval(timerIntervalRef.current);
    dataRef.current.notes = notesToText(notes);
    recordingForRef.current = 'argument';
    clearAudio();
    setStep('argument');
  };

  const handleReset = () => {
    clearInterval(timerIntervalRef.current);
    grader.clear();
    turn.clear();
    clearAudio();
    setErrorMessage('');
    setErrorType(null);
    setIssueId('');
    setNotes(EMPTY_NOTES);
    setArgument('');
    setOpposition('');
    setRebuttal('');
    setResult(null);
    setStep('setup');
  };

  const handleRetry = async () => {
    setErrorMessage('');
    if (errorType === 'opposition') {
      await requestOpposition();
    } else if (errorType === 'grading') {
      setStep('grading');
      try {
        if (grader.hasRecording()) await showResult(await grader.retry());
        else await runGrading();
      } catch (err) {
        fail('grading', err, 'An error occurred during adjudication.');
      }
    } else {
      // continue the same recording from where it stopped
      setWorking('transcribe');
      setStep('working');
      try {
        const view = await turn.retry();
        rememberAudio(errorType, view);
        const text = view.result?.text || view.transcript;
        if (errorType === 'rebuttal') await continueWithRebuttal(text);
        else await continueWithArgument(text);
      } catch (err) {
        fail(errorType, err, 'Your speech could not be transcribed.');
      }
    }
  };

  const handleRecordAgain = () => {
    turn.clear();
    clearAudio();
    setErrorMessage('');
    const which = errorType === 'mic' ? recordingForRef.current : errorType;
    if (which === 'rebuttal') {
      recordingForRef.current = 'rebuttal';
      setStep('rebuttal');
      setTimer(0);
    } else {
      recordingForRef.current = 'argument';
      setStep('argument');
    }
  };

  const handleGradeWithoutRebuttal = async () => {
    dataRef.current.opposition = '';
    setOpposition('');
    await handleSkipRebuttal();
  };

  const d = dataRef.current;

  // ---------------- Shared pieces ----------------

  const roleBadge = (
    <Badge tone={d.role === 'Affirmative' ? 'brand' : 'warning'}>
      {d.role === 'Affirmative' ? 'Affirmative (Government)' : 'Negative (Opposition)'}
    </Badge>
  );

  const issuePanel = (
    <div className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-6 space-y-2">
      <span className="block text-[13px] font-semibold text-ink-muted">Motion</span>
      <p className="text-[15px] font-semibold text-ink leading-snug">{d.motion}</p>
      {roleBadge}
      {d.background && (
        <div className="pt-3">
          <span className="block text-[13px] font-semibold text-ink-muted">Background</span>
          <p className="text-sm text-ink-muted mt-1 leading-relaxed whitespace-pre-wrap">{d.background}</p>
        </div>
      )}
    </div>
  );

  const notesPanel = (
    <section className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-6 h-full flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-ink-subtle" aria-hidden="true" />
          <h2 className="text-base font-bold text-ink">Your breakdown</h2>
        </div>
        <TextSizeControl {...readingSizeControl} />
      </div>
      <div className="flex-1 min-h-[200px] bg-surface-muted rounded-xl p-4 text-ink whitespace-pre-wrap overflow-y-auto" style={readingStyle}>
        {d.notes || <span className="text-ink-subtle">No notes written during the breakdown.</span>}
      </div>
    </section>
  );

  const overtimeNote = (limit) => `Time is up - finish your sentence (stops in ${Math.max(0, limit + GRACE_SECONDS - recordingTime)}s).`;

  // Phones/tablets: the same timer and record button, pinned to the top of the screen
  const pinnedRecorder = (which, limit, label, note = '') => {
    const left = limit - recordingTime;
    const overtime = isRecording && left <= 0;
    return (
      <PinnedBar
        time={isRecording ? formatTime(left) : formatTime(limit)}
        tone={isRecording ? 'text-danger' : 'text-ink'}
        note={overtime ? overtimeNote(limit) : note}
      >
        {!isRecording ? (
          <Button size="sm" fullWidth icon={Mic} onClick={() => beginRecording(which)}>{label}</Button>
        ) : (
          <Button size="sm" fullWidth variant="danger" icon={Square} onClick={stopRecording}>Stop and submit</Button>
        )}
      </PinnedBar>
    );
  };

  // Wide screens: full-size timer and record button inside the card
  const recorder = (which, limit, label) => {
    const left = limit - recordingTime;
    const overtime = isRecording && left <= 0;
    return (
      <div className="hidden lg:flex flex-col items-center gap-3">
        <div className={`text-[44px] font-bold tabular-nums leading-none ${isRecording ? 'text-danger' : 'text-ink'}`}>
          {isRecording ? formatTime(left) : formatTime(limit)}
        </div>
        <p className="text-[13px] min-h-[1.25rem] text-danger" aria-live="polite">{overtime ? overtimeNote(limit) : ''}</p>
        <RecordButton
          isRecording={isRecording}
          onClick={isRecording ? stopRecording : () => beginRecording(which)}
          aria-label={isRecording ? `Stop recording, ${recordingTime} seconds recorded` : label}
        />
        <span className={`text-sm font-semibold ${isRecording ? 'text-danger' : 'text-ink'}`}>
          {isRecording ? 'Tap to stop and submit' : label}
        </span>
      </div>
    );
  };

  // ---------------- Screens ----------------

  if (step === 'setup') {
    return (
      <section className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-7 max-w-3xl animate-fadeIn">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-full bg-brand-tint text-brand-ink flex items-center justify-center shrink-0">
            <Lightbulb className="w-5 h-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-bold text-ink">Mattering</h2>
            <p className="text-sm text-ink-muted">Break an issue down, build one argument, then defend it.</p>
          </div>
        </div>

        <ol className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            ['1', 'Breakdown', `${describeDuration(BREAKDOWN_SECONDS)}, written`],
            ['2', 'Argument', `${describeDuration(ARGUMENT_SECONDS)}, spoken`],
            ['3', 'Rebuttal', REBUTTAL_PREP_SECONDS > 0 ? `${describeDuration(REBUTTAL_PREP_SECONDS)} prep + ${describeDuration(REBUTTAL_SECONDS)}` : describeDuration(REBUTTAL_SECONDS)],
            ['4', 'Speaker score', '69-81 scale'],
          ].map(([n, name, detail]) => (
            <li key={n} className="bg-surface-muted rounded-xl p-3.5">
              <span className="w-6 h-6 rounded-full bg-surface text-brand-ink text-xs font-bold flex items-center justify-center">{n}</span>
              <p className="mt-2 text-sm font-semibold text-ink">{name}</p>
              <p className="text-[13px] text-ink-subtle">{detail}</p>
            </li>
          ))}
        </ol>

        <div className="mt-6 space-y-5">
          <Field label="Issue">
            <Select value={issueId} onChange={(e) => setIssueId(e.target.value)}>
              <option value="" disabled>Choose a motion</option>
              {issues.map((i) => (
                <option key={i.id} value={i.id}>{i.motion}</option>
              ))}
            </Select>
          </Field>

          <fieldset>
            <legend className="text-sm font-semibold text-ink mb-1.5">Your side</legend>
            <div className="grid grid-cols-2 gap-3">
              {[['Affirmative', 'Affirmative', 'Government'], ['Negative', 'Negative', 'Opposition']].map(([value, label, sub]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRole(value)}
                  aria-pressed={role === value}
                  className={`min-h-[56px] px-4 py-2.5 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-ring ${
                    role === value ? 'bg-brand-tint border-brand ring-1 ring-inset ring-brand' : 'bg-surface border-line-strong hover:bg-surface-muted'
                  }`}
                >
                  <span className={`block text-[15px] font-semibold ${role === value ? 'text-brand-ink' : 'text-ink'}`}>{label}</span>
                  <span className="block text-[13px] text-ink-subtle">{sub}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <Button size="lg" fullWidth iconRight={ArrowRight} onClick={handleStartBreakdown} disabled={!issueId}>
            Start the breakdown
          </Button>
        </div>
      </section>
    );
  }

  if (step === 'breakdown') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 animate-fadeIn">
        <PinnedBar time={formatTime(timer)}>
          <Button size="sm" fullWidth icon={Mic} onClick={handleGoToArgument}>Deliver argument</Button>
        </PinnedBar>
        <aside className="lg:col-span-1 space-y-4">
          <div className="hidden lg:block bg-surface border border-line rounded-2xl shadow-card p-5 md:p-6 space-y-4">
            <div>
              <span className="flex items-center gap-2 text-[13px] font-semibold text-ink-muted">
                <Clock className="w-4 h-4" aria-hidden="true" /> Breakdown time left
              </span>
              <div className="mt-1 text-[44px] font-bold tabular-nums text-ink leading-none">{formatTime(timer)}</div>
            </div>
            <Button fullWidth icon={Mic} onClick={handleGoToArgument}>I'm ready - deliver my argument</Button>
          </div>
          {issuePanel}
        </aside>

        <section className="lg:col-span-2 bg-surface border border-line rounded-2xl shadow-card p-5 md:p-6 space-y-5">
          {NOTE_FIELDS.map(({ key, label, icon: Icon, hint, placeholder }) => (
            <div key={key} className="space-y-1.5">
              <label htmlFor={`mattering-${key}`} className="flex items-center gap-2 text-sm font-semibold text-ink">
                <Icon className="w-4 h-4 text-brand-ink" aria-hidden="true" />
                {label}
              </label>
              <p className="text-[13px] text-ink-subtle">{hint}</p>
              <Textarea
                id={`mattering-${key}`}
                rows={key === 'outline' ? 4 : 2}
                maxLength={900}
                value={notes[key]}
                onChange={(e) => setNotes((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
              />
            </div>
          ))}
          <p className="text-[13px] text-ink-subtle">
            Your notes stay visible while you speak. They are not scored - only your speech is.
          </p>
        </section>
      </div>
    );
  }

  if (step === 'argument') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 animate-fadeIn">
        {pinnedRecorder('argument', ARGUMENT_SECONDS, 'Record argument')}
        <aside className="lg:col-span-1 space-y-4">
          <div className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-6 space-y-4">
            <div className="text-center">
              <span className="text-[13px] font-semibold text-brand-ink">Round 1</span>
              <h2 className="text-base font-bold text-ink">Your argument</h2>
              <p className="text-sm text-ink-muted mt-1">One argument, {describeDuration(ARGUMENT_SECONDS)}: claim, reasoning, example, link back.</p>
            </div>
            {recorder('argument', ARGUMENT_SECONDS, 'Record argument')}
          </div>
          {issuePanel}
        </aside>
        <div className="lg:col-span-2">{notesPanel}</div>
      </div>
    );
  }

  if (step === 'working') {
    return (
      <div className="animate-fadeIn">
        {working === 'opposition' ? (
          <div className="bg-surface border border-line rounded-2xl shadow-card py-6">
            <Spinner message="The other side is preparing a counter-argument..." />
            {sparringBusy && (
              <p className="text-sm text-warning text-center -mt-2 pb-2">The AI is busy right now - still trying, please wait.</p>
            )}
          </div>
        ) : (
          <SubmissionProgress progress={turn.progress} transcriptLabel="What you said" />
        )}
      </div>
    );
  }

  if (step === 'rebuttal') {
    const prepping = !isRecording && timer > 0;
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 animate-fadeIn">
        {pinnedRecorder('rebuttal', REBUTTAL_SECONDS, 'Record rebuttal')}
        <aside className="lg:col-span-1 space-y-4">
          <div className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-6 space-y-4">
            <div className="text-center">
              <span className="text-[13px] font-semibold text-brand-ink">Round 2</span>
              <h2 className="text-base font-bold text-ink">Rebuttal</h2>
              <p className="text-sm text-ink-muted mt-1">
                {prepping
                  ? `Prep time left: ${formatTime(timer)}. You can start early.`
                  : `Answer the other side in ${describeDuration(REBUTTAL_SECONDS)}.`}
              </p>
            </div>
            {recorder('rebuttal', REBUTTAL_SECONDS, 'Record rebuttal')}
            {!isRecording && (
              <Button variant="subtle" fullWidth icon={SkipForward} onClick={handleSkipRebuttal}>
                Skip rebuttal and get my score
              </Button>
            )}
            <p className="text-[13px] text-ink-subtle leading-relaxed">
              Scores of 76 and above need rebuttal and engagement, so skipping limits how high you can score.
            </p>
          </div>
        </aside>

        <div className="lg:col-span-2 space-y-4">
          <section className="bg-warning-tint rounded-2xl p-5 md:p-6">
            <div className="flex items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2">
                <Swords className="w-5 h-5 text-warning" aria-hidden="true" />
                <h2 className="text-base font-bold text-ink">The other side says</h2>
              </div>
              <TextSizeControl {...readingSizeControl} />
            </div>
            <p className="text-ink whitespace-pre-wrap" style={readingStyle}>{opposition}</p>
            <p className="text-[13px] text-ink-muted mt-4">
              Tip: say which point you are answering, why it is wrong or not enough, and why your side still wins.
            </p>
          </section>
          <section className="bg-surface border border-line rounded-2xl p-5 md:p-6">
            <span className="block text-[13px] font-semibold text-ink-muted">Your argument (what the AI heard)</span>
            <p className="text-ink-muted leading-relaxed mt-2 whitespace-pre-wrap" style={readingStyle}>{argument}</p>
          </section>
        </div>
      </div>
    );
  }

  if (step === 'grading') {
    return (
      <div className="space-y-4 animate-fadeIn">
        <p className="text-[15px] text-ink-muted">
          Your argument{rebuttal ? ' and rebuttal are' : ' is'} being scored on the speaker scale.
        </p>
        <SubmissionProgress progress={grader.progress} transcriptLabel="Your argument" />
      </div>
    );
  }

  if (step === 'error') {
    const retryable = errorType === 'opposition' || errorType === 'grading'
      || ((errorType === 'argument' || errorType === 'rebuttal') && turn.progress?.retryable && turn.hasRecording());
    return (
      <ErrorPanel
        icon={AlertTriangle}
        title={retryable ? 'Not finished yet' : 'Something went wrong'}
        message={errorMessage}
        note={retryable && errorType !== 'mic' ? 'Your work so far is kept. Tap Retry - you do not need to speak again.' : undefined}
      >
        {retryable && <Button onClick={handleRetry}>Retry</Button>}
        {(errorType === 'argument' || errorType === 'rebuttal' || (errorType === 'mic' && d.motion)) && (
          <Button variant="secondary" icon={Mic} onClick={handleRecordAgain}>Record again</Button>
        )}
        {errorType === 'rebuttal' && (
          <Button variant="secondary" onClick={handleSkipRebuttal}>Skip rebuttal</Button>
        )}
        {errorType === 'opposition' && (
          <Button variant="secondary" onClick={handleGradeWithoutRebuttal}>Score my argument only</Button>
        )}
        <Button variant="subtle" onClick={handleReset}>Start over</Button>
      </ErrorPanel>
    );
  }

  if (step === 'results' && result) {
    const score = result.speaker_score;
    const inBand = (range) => {
      const [low, high] = range.split('-').map(Number);
      return score >= low && score <= (high || low);
    };
    return (
      <div className="space-y-5 animate-fadeIn">
        <section className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0 flex-1">
              <span className="text-[13px] font-semibold text-brand-ink">Mattering result</span>
              <h2 className="text-lg md:text-xl font-bold text-ink leading-snug">{d.motion}</h2>
              <div className="mt-2">{roleBadge}</div>
              <p className="mt-3 text-[13px] flex items-center gap-1.5 text-ink-muted" aria-live="polite">
                {isSaving && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
                {saveStatus === 'success' && <CheckCircle2 className="w-4 h-4 text-success" aria-hidden="true" />}
                <span className={saveStatus === 'error' ? 'text-danger' : saveStatus === 'success' ? 'text-success font-semibold' : ''}>
                  {saveStatus === 'success' ? 'Saved to your record'
                    : saveStatus === 'error' ? 'The score was not saved' : 'Saving your score...'}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-4 p-4 border border-line rounded-2xl">
              <div className="text-center">
                <div className="text-[13px] font-semibold text-ink-muted">Speaker score</div>
                <div className="text-5xl font-bold text-ink tabular-nums leading-tight">{score}</div>
                <div className="text-[13px] text-ink-subtle">scale 69-81 · 75 is average</div>
              </div>
            </div>
          </div>

          {/* Where the score sits on the scale */}
          <div className="mt-5">
            <span className="block text-[13px] font-semibold text-ink-muted mb-2">{result.band}</span>
            <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
              {BANDS.map(([range, label]) => {
                const here = inBand(range);
                return (
                  <div
                    key={range}
                    aria-current={here ? 'true' : undefined}
                    className={`rounded-xl p-2 text-center ${here ? 'bg-brand text-white' : 'bg-surface-muted text-ink-muted'}`}
                  >
                    <div className="text-sm font-bold tabular-nums">{range}</div>
                    <div className="text-xs leading-tight mt-0.5">{label}</div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="flex gap-3 p-5 md:p-6 rounded-2xl bg-brand-tint">
          <Lightbulb className="w-5 h-5 text-brand-ink shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h3 className="text-[15px] font-semibold text-brand-ink">Adjudicator's feedback</h3>
            <p className="text-[15px] text-ink leading-relaxed mt-1 whitespace-pre-wrap">{result.overall_feedback}</p>
          </div>
        </section>

        <div className={`grid grid-cols-1 gap-4 ${result.rebuttal_feedback ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
          <section className="bg-surface border border-line rounded-2xl p-5">
            <h3 className="flex items-center gap-2 text-base font-bold text-ink"><Target className="w-4 h-4 text-brand-ink" aria-hidden="true" />Your argument</h3>
            <p className="mt-2 text-[15px] text-ink-muted leading-relaxed">{result.argument_feedback}</p>
          </section>
          {result.rebuttal_feedback && (
            <section className="bg-surface border border-line rounded-2xl p-5">
              <h3 className="flex items-center gap-2 text-base font-bold text-ink"><Swords className="w-4 h-4 text-warning" aria-hidden="true" />Your rebuttal</h3>
              <p className="mt-2 text-[15px] text-ink-muted leading-relaxed">{result.rebuttal_feedback}</p>
            </section>
          )}
          <section className="bg-surface border border-line rounded-2xl p-5">
            <h3 className="flex items-center gap-2 text-base font-bold text-ink"><BookOpen className="w-4 h-4 text-success" aria-hidden="true" />Read up on</h3>
            <p className="mt-2 text-[15px] text-ink-muted leading-relaxed">{result.knowledge_gaps}</p>
          </section>
        </div>

        <section className="bg-surface border border-line rounded-2xl p-5 md:p-6 space-y-5">
          <div>
            <h3 className="text-[15px] font-semibold text-ink mb-2">Your argument (what the AI heard)</h3>
            <p className="text-[15px] text-ink leading-relaxed bg-surface-muted rounded-xl p-4 whitespace-pre-wrap">{argument}</p>
          </div>
          {opposition && (
            <div>
              <h3 className="text-[15px] font-semibold text-ink mb-2">The other side said</h3>
              <p className="text-[15px] text-ink leading-relaxed bg-surface-muted rounded-xl p-4 whitespace-pre-wrap">{opposition}</p>
            </div>
          )}
          {opposition && (
            <div>
              <h3 className="text-[15px] font-semibold text-ink mb-2">Your rebuttal (what the AI heard)</h3>
              <p className="text-[15px] text-ink leading-relaxed bg-surface-muted rounded-xl p-4 whitespace-pre-wrap">{rebuttal || 'Skipped.'}</p>
            </div>
          )}
        </section>

        <div className="flex justify-end">
          <Button icon={RotateCcw} onClick={handleReset}>Start a new drill</Button>
        </div>
      </div>
    );
  }

  return null;
}
