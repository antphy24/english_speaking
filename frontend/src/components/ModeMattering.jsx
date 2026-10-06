import React, { useState, useRef, useEffect } from 'react';
import {
  Mic, Square, Loader2, CheckCircle2, ArrowRight, Clock, AlertTriangle, Lightbulb,
  Users, GitBranch, Scale, FileText, Swords, BookOpen, Target, SkipForward,
} from 'lucide-react';
import Spinner from './UI/Spinner';
import SubmissionProgress from './UI/SubmissionProgress';
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

const BREAKDOWN_SECONDS = 300;
const ARGUMENT_SECONDS = 120;
const REBUTTAL_PREP_SECONDS = 60;
const REBUTTAL_SECONDS = 60;
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

export default function ModeMattering({ apiBase, onSaveScore, getSessionSeconds, isSaving, saveStatus, customIssues = [] }) {
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

  const issuePanel = (
    <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-6 shadow-xl">
      <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Motion</span>
      <p className="text-sm font-medium text-slate-200 mt-1">{d.motion}</p>
      <span className="text-xs text-slate-500 uppercase font-bold tracking-wider block mt-4">Your side</span>
      <p className={`text-sm font-bold mt-1 ${d.role === 'Affirmative' ? 'text-indigo-400' : 'text-rose-400'}`}>{d.role}</p>
      {d.background && (
        <>
          <span className="text-xs text-slate-500 uppercase font-bold tracking-wider block mt-4">Background</span>
          <p className="text-xs text-slate-400 mt-1 leading-relaxed whitespace-pre-wrap">{d.background}</p>
        </>
      )}
    </div>
  );

  const notesPanel = (
    <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl h-full flex flex-col">
      <div className="flex items-center space-x-3 mb-4">
        <FileText className="w-5 h-5 text-slate-400" />
        <h3 className="font-bold text-white">Your breakdown</h3>
      </div>
      <div className="flex-1 w-full bg-slate-950 border border-slate-800 text-slate-400 rounded-xl p-4 font-mono text-sm leading-relaxed overflow-y-auto whitespace-pre-wrap">
        {d.notes || 'No notes written during the breakdown.'}
      </div>
    </div>
  );

  const recorder = (which, limit, label) => {
    const left = limit - recordingTime;
    const overtime = isRecording && left <= 0;
    return (
      <>
        <div className={`text-4xl font-mono font-bold text-center tracking-wider mb-2 bg-slate-950 py-4 rounded-xl border border-slate-800 ${overtime ? 'text-rose-400' : 'text-slate-200'}`}>
          {isRecording ? formatTime(left) : formatTime(limit)}
        </div>
        <p className="text-xs mb-4 h-4 text-rose-400">
          {overtime ? `Time is up - finish your sentence (stops in ${Math.max(0, limit + GRACE_SECONDS - recordingTime)}s).` : ''}
        </p>
        {!isRecording ? (
          <button
            onClick={() => beginRecording(which)}
            aria-label={label}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 px-4 rounded-xl transition-all flex justify-center items-center space-x-3 shadow-lg shadow-indigo-900/20 cursor-pointer"
          >
            <Mic className="w-5 h-5" />
            <span>{label}</span>
          </button>
        ) : (
          <button
            onClick={stopRecording}
            aria-label={`Stop recording, ${recordingTime} seconds elapsed`}
            className="w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-4 px-4 rounded-xl transition-all flex justify-center items-center space-x-3 animate-pulse shadow-lg shadow-rose-900/20 cursor-pointer"
          >
            <Square className="w-5 h-5 fill-current" />
            <span>Stop Recording</span>
          </button>
        )}
      </>
    );
  };

  // ---------------- Screens ----------------

  if (step === 'setup') {
    return (
      <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 md:p-8 animate-fadeIn shadow-2xl">
        <div className="flex items-center space-x-3 mb-6">
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-xl border border-indigo-500/20">
            <Lightbulb className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Mattering Drill</h3>
            <p className="text-sm text-slate-400">Break an issue down, build one argument, then defend it.</p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-6">
          {[
            ['1', 'Breakdown', '5 min, written'],
            ['2', 'Argument', '2 min, spoken'],
            ['3', 'Rebuttal', '1 min prep + 1 min'],
            ['4', 'Speaker score', '69-81 scale'],
          ].map(([n, name, detail]) => (
            <div key={n} className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] font-mono text-indigo-400">STEP {n}</span>
              <p className="text-sm font-bold text-white">{name}</p>
              <p className="text-[11px] text-slate-500">{detail}</p>
            </div>
          ))}
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Select Issue</label>
            <select
              value={issueId}
              onChange={(e) => setIssueId(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-xl p-3 focus:outline-none focus:border-indigo-500/50 transition-colors"
            >
              <option value="" disabled>-- Choose a motion --</option>
              {issues.map((i) => (
                <option key={i.id} value={i.id}>{i.motion}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Select Side</label>
            <div className="flex space-x-4">
              {[['Affirmative', 'Affirmative (Gov)', 'bg-indigo-600/20 border-indigo-500 text-indigo-300'],
                ['Negative', 'Negative (Opp)', 'bg-rose-600/20 border-rose-500 text-rose-300']].map(([value, label, active]) => (
                <button
                  key={value}
                  onClick={() => setRole(value)}
                  className={`flex-1 py-3 px-4 rounded-xl font-bold text-sm transition-all border cursor-pointer ${
                    role === value ? active : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={handleStartBreakdown}
            disabled={!issueId}
            className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 px-4 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 shadow-lg shadow-indigo-900/20 cursor-pointer"
          >
            <span>Start Breakdown</span>
            <ArrowRight className="w-5 h-5" />
          </button>
        </div>
      </div>
    );
  }

  if (step === 'breakdown') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center space-x-3 mb-4">
              <Clock className="w-5 h-5 text-indigo-400" />
              <h3 className="font-bold text-white">Breakdown Time</h3>
            </div>
            <div className="text-4xl font-mono font-bold text-center text-indigo-300 tracking-wider mb-4 bg-slate-950 py-4 rounded-xl border border-slate-800">
              {formatTime(timer)}
            </div>
            <button
              onClick={handleGoToArgument}
              className="w-full bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center space-x-2 cursor-pointer"
            >
              <span>Ready? Deliver Argument</span>
              <Mic className="w-4 h-4" />
            </button>
          </div>
          {issuePanel}
        </div>

        <div className="lg:col-span-2 bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl space-y-5">
          {NOTE_FIELDS.map(({ key, label, icon: Icon, hint, placeholder }) => (
            <div key={key}>
              <label htmlFor={`mattering-${key}`} className="flex items-center space-x-2 text-sm font-bold text-white">
                <Icon className="w-4 h-4 text-indigo-400" />
                <span>{label}</span>
              </label>
              <p className="text-xs text-slate-500 mt-0.5 mb-2">{hint}</p>
              <textarea
                id={`mattering-${key}`}
                rows={key === 'outline' ? 4 : 2}
                maxLength={900}
                value={notes[key]}
                onChange={(e) => setNotes((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={placeholder}
                className="w-full bg-slate-950 border border-slate-800 text-slate-300 rounded-xl p-3 focus:outline-none focus:border-indigo-500/50 resize-y font-mono text-sm leading-relaxed"
              />
            </div>
          ))}
          <p className="text-[11px] text-slate-500">
            Your notes stay visible while you speak. They are not scored - only your speech is.
          </p>
        </div>
      </div>
    );
  }

  if (step === 'argument') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-6 shadow-xl text-center">
            <h3 className="font-bold text-white mb-1">Round 1: Your Argument</h3>
            <p className="text-xs text-slate-400 mb-5">One argument, 2 minutes: claim, reasoning, example, link back.</p>
            {recorder('argument', ARGUMENT_SECONDS, 'Record Argument')}
          </div>
          {issuePanel}
        </div>
        <div className="lg:col-span-2">{notesPanel}</div>
      </div>
    );
  }

  if (step === 'working') {
    return (
      <div className="flex flex-col items-center justify-center py-16 animate-fadeIn">
        {working === 'opposition' ? (
          <>
            <Spinner message="Your sparring partner is preparing a counter-argument..." />
            {sparringBusy && (
              <p className="text-xs text-amber-300/90 -mt-2">The AI is busy right now - still trying, please wait.</p>
            )}
          </>
        ) : (
          <div className="w-full max-w-xl">
            <SubmissionProgress progress={turn.progress} transcriptLabel="Your Speech" />
          </div>
        )}
      </div>
    );
  }

  if (step === 'rebuttal') {
    const prepping = !isRecording && timer > 0;
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-6 shadow-xl text-center">
            <h3 className="font-bold text-white mb-1">Round 2: Rebuttal</h3>
            <p className="text-xs text-slate-400 mb-5">
              {prepping
                ? `Prep time left: ${formatTime(timer)}. You can start early.`
                : 'Answer the opposing argument in 1 minute.'}
            </p>
            {recorder('rebuttal', REBUTTAL_SECONDS, 'Record Rebuttal')}
            {!isRecording && (
              <button
                onClick={handleSkipRebuttal}
                className="w-full mt-3 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold py-2.5 px-4 rounded-xl transition-colors text-xs flex justify-center items-center space-x-2 cursor-pointer"
              >
                <SkipForward className="w-4 h-4" />
                <span>Skip rebuttal and get my score</span>
              </button>
            )}
            <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">
              Scores of 76 and above need rebuttal and engagement, so skipping limits how high you can score.
            </p>
          </div>
        </div>

        <div className="lg:col-span-2 space-y-6">
          <div className="bg-rose-950/20 border border-rose-500/20 rounded-2xl p-6">
            <div className="flex items-center space-x-2 mb-3">
              <Swords className="w-5 h-5 text-rose-400" />
              <h3 className="font-bold text-white">The other side says</h3>
            </div>
            <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{opposition}</p>
            <p className="text-xs text-slate-500 mt-4">
              Tip: say which point you are answering, why it is wrong or not enough, and why your side still wins.
            </p>
          </div>
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
            <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Your argument (what we heard)</span>
            <p className="text-sm text-slate-400 font-mono leading-relaxed mt-2 whitespace-pre-wrap">{argument}</p>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'grading') {
    return (
      <div className="flex flex-col items-center justify-center py-16 animate-fadeIn">
        <h3 className="text-xl font-bold text-white mb-2">Adjudicating your drill</h3>
        <p className="text-slate-400 text-sm max-w-md text-center mb-2">
          Your argument{rebuttal ? ' and rebuttal are' : ' is'} being scored on the speaker scale.
        </p>
        <div className="w-full max-w-xl">
          <SubmissionProgress progress={grader.progress} transcriptLabel="Your Argument" />
        </div>
      </div>
    );
  }

  if (step === 'error') {
    const retryable = errorType === 'opposition' || errorType === 'grading'
      || ((errorType === 'argument' || errorType === 'rebuttal') && turn.progress?.retryable && turn.hasRecording());
    return (
      <div className="glass-panel p-6 rounded-xl border border-red-500/20 text-center space-y-4 animate-fadeIn">
        <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto text-red-500">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h4 className="text-lg font-bold text-white">{retryable ? 'Not finished yet' : 'Something went wrong'}</h4>
          <p className="text-sm text-rose-300">{errorMessage}</p>
          {retryable && errorType !== 'mic' && (
            <p className="text-xs text-slate-400">Your work so far is kept. Tap Retry - you do not need to speak again.</p>
          )}
        </div>
        <div className="flex flex-wrap justify-center gap-3 mt-4">
          {retryable && (
            <button onClick={handleRetry} className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition cursor-pointer">
              Retry
            </button>
          )}
          {(errorType === 'argument' || errorType === 'rebuttal' || (errorType === 'mic' && d.motion)) && (
            <button onClick={handleRecordAgain} className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-sm font-semibold transition cursor-pointer">
              Record Again
            </button>
          )}
          {errorType === 'rebuttal' && (
            <button onClick={handleSkipRebuttal} className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-sm font-semibold transition cursor-pointer">
              Skip Rebuttal
            </button>
          )}
          {errorType === 'opposition' && (
            <button onClick={handleGradeWithoutRebuttal} className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-sm font-semibold transition cursor-pointer">
              Score My Argument Only
            </button>
          )}
          <button onClick={handleReset} className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-sm font-semibold transition cursor-pointer">
            Start Over
          </button>
        </div>
      </div>
    );
  }

  if (step === 'results' && result) {
    const score = result.speaker_score;
    const inBand = (range) => {
      const [low, high] = range.split('-').map(Number);
      return score >= low && score <= (high || low);
    };
    return (
      <div className="space-y-8 animate-fadeIn pb-10">
        <div className="bg-gradient-to-r from-indigo-900/40 to-slate-900/80 backdrop-blur-xl border border-indigo-500/20 rounded-3xl p-8 flex flex-col md:flex-row items-center md:items-stretch justify-between gap-6 shadow-2xl">
          <div className="flex-1 w-full text-center md:text-left">
            <div className="inline-block px-3 py-1 bg-indigo-500/20 text-indigo-300 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-indigo-500/20 mb-4">
              Mattering Drill
            </div>
            <h3 className="text-3xl font-extrabold text-white mb-2 tracking-tight">{result.band}</h3>
            <p className="text-sm text-slate-300 mb-1">{d.motion}</p>
            <p className={`text-xs font-bold ${d.role === 'Affirmative' ? 'text-indigo-400' : 'text-rose-400'}`}>{d.role}</p>
          </div>
          <div className="flex flex-col items-center justify-center px-10 py-4 bg-slate-950/40 rounded-2xl border border-slate-800/50 min-w-[200px]">
            <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Speaker Score</span>
            <div className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-indigo-400">
              {score}
            </div>
            <span className="text-sm text-slate-400 font-medium mt-1">scale 69-81 · 75 is average</span>
          </div>
        </div>

        {/* Where the score sits on the scale */}
        <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
          {BANDS.map(([range, label]) => (
            <div
              key={range}
              className={`rounded-xl border p-2 text-center ${
                inBand(range) ? 'bg-indigo-600/20 border-indigo-500 text-white' : 'bg-slate-900/50 border-slate-800 text-slate-500'
              }`}
            >
              <div className="text-sm font-bold font-mono">{range}</div>
              <div className="text-[10px] leading-tight mt-0.5">{label}</div>
            </div>
          ))}
        </div>

        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
          <h4 className="font-bold text-white mb-3">Adjudicator Feedback</h4>
          <p className="text-sm text-indigo-200/90 leading-relaxed">{result.overall_feedback}</p>
        </div>

        <div className={`grid grid-cols-1 gap-6 ${result.rebuttal_feedback ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
            <h4 className="font-bold text-white mb-3 flex items-center space-x-2">
              <Target className="w-4 h-4 text-blue-400" /><span>Your Argument</span>
            </h4>
            <p className="text-sm text-slate-300 leading-relaxed">{result.argument_feedback}</p>
          </div>
          {result.rebuttal_feedback && (
            <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
              <h4 className="font-bold text-white mb-3 flex items-center space-x-2">
                <Swords className="w-4 h-4 text-rose-400" /><span>Your Rebuttal</span>
              </h4>
              <p className="text-sm text-slate-300 leading-relaxed">{result.rebuttal_feedback}</p>
            </div>
          )}
          <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6">
            <h4 className="font-bold text-white mb-3 flex items-center space-x-2">
              <BookOpen className="w-4 h-4 text-emerald-400" /><span>Read Up On</span>
            </h4>
            <p className="text-sm text-slate-300 leading-relaxed">{result.knowledge_gaps}</p>
          </div>
        </div>

        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 space-y-5">
          <div>
            <h4 className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-2">Your argument (transcript)</h4>
            <p className="text-sm text-slate-400 font-mono leading-loose bg-slate-950/50 p-4 rounded-xl border border-slate-800/50 whitespace-pre-wrap">{argument}</p>
          </div>
          {opposition && (
            <div>
              <h4 className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-2">The other side said</h4>
              <p className="text-sm text-slate-400 leading-relaxed bg-slate-950/50 p-4 rounded-xl border border-slate-800/50 whitespace-pre-wrap">{opposition}</p>
            </div>
          )}
          {opposition && (
            <div>
              <h4 className="text-xs text-slate-500 uppercase font-bold tracking-wider mb-2">Your rebuttal (transcript)</h4>
              <p className="text-sm text-slate-400 font-mono leading-loose bg-slate-950/50 p-4 rounded-xl border border-slate-800/50 whitespace-pre-wrap">
                {rebuttal || 'Skipped.'}
              </p>
            </div>
          )}
        </div>

        <div className="flex flex-col sm:flex-row justify-end items-center gap-4 pt-4 border-t border-slate-800">
          <span className={`text-xs flex items-center space-x-1.5 ${saveStatus === 'error' ? 'text-rose-400' : 'text-slate-400'}`}>
            {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
            {saveStatus === 'success' && <CheckCircle2 className="w-4 h-4 text-emerald-400" />}
            <span>
              {saveStatus === 'success' ? 'Saved to the leaderboard'
                : saveStatus === 'error' ? 'Score was not saved' : 'Saving your score...'}
            </span>
          </span>
          <button
            onClick={handleReset}
            className="px-6 py-3 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-xl transition-colors text-sm cursor-pointer"
          >
            Start New Drill
          </button>
        </div>
      </div>
    );
  }

  return null;
}
