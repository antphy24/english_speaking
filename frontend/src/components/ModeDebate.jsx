import React, { useState, useRef, useEffect } from 'react';
import { Square, Save, Mic, CheckCircle2, Users, FileText, ArrowRight, Clock, AlertTriangle, RotateCcw, Lightbulb } from 'lucide-react';
import { Button } from './UI/Button';
import { Badge } from './UI/Badge';
import { Field, Select, Textarea } from './UI/Field';
import { RecordButton } from './UI/Recorder';
import { ErrorPanel } from './UI/ErrorPanel';
import { ScoreRing, scoreBand } from './UI/ScoreCard';
import { TextSizeControl, useReadingSize } from './UI/TextSizeControl';
import Spinner from './UI/Spinner';
import useSubmission from '../hooks/useSubmission';
import { saveSubmissionOnServer } from '../utils/api';
import SubmissionProgress from './UI/SubmissionProgress';
import PinnedBar from './UI/PinnedBar';
import { DEFAULT_TIMERS, describeDuration } from '../utils/timerSettings';
import { useMediaRecorder } from '../hooks/useMediaRecorder';

const DEFAULT_MOTIONS = [
  "This House would ban the use of AI in educational assessments.",
  "This House believes that developing nations should prioritize economic growth over environmental protection.",
  "This House would implement a 4-day work week.",
  "This House regrets the rise of cancel culture."
];

export default function ModeDebate({ studentName, apiBase, onSaveScore, getSessionSeconds, isSaving, saveStatus, customMotions = [], timers = DEFAULT_TIMERS.debate }) {
  // Times set by the teacher for this class (seconds)
  const PREP_SECONDS = timers.prep;
  const SPEECH_SECONDS = timers.speech;
  const [step, setStep] = useState('setup'); // setup -> case_building -> recording -> grading -> results
  
  const [motion, setMotion] = useState('');
  const [role, setRole] = useState('Affirmative');
  const [scratchpad, setScratchpad] = useState('');
  
  const [timer, setTimer] = useState(PREP_SECONDS); // case building first, then the speech
  
  const [isRecordingState, setIsRecordingState] = useState(false); // Remove if not needed, wait actually I should just use the hook
  const [audioUrl, setAudioUrl] = useState(null);
  
  const {
    isRecording,
    recordingTime,
    audioBlob,
    error: recordingError,
    startRecording,
    stopRecording,
    clearAudio
  } = useMediaRecorder();
  
  const [errorMessage, setErrorMessage] = useState('');
  const readingSize = useReadingSize();
  const { style: readingStyle, ...readingSizeControl } = readingSize;
  
  const [resultData, setResultData] = useState(null);
  const submission = useSubmission(apiBase, 'debate');

  const timerIntervalRef = useRef(null);

  const availableMotions = [...(customMotions || []).map(m => m.content), ...DEFAULT_MOTIONS];

  useEffect(() => {
    return () => {
      clearInterval(timerIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (recordingError) {
      setErrorMessage(recordingError);
      setStep('error');
    }
  }, [recordingError]);

  const processAudioRef = useRef(null);
  useEffect(() => {
    processAudioRef.current = handleProcessSpeech;
  });
  useEffect(() => {
    if (audioBlob && processAudioRef.current) {
      processAudioRef.current(audioBlob);
    }
  }, [audioBlob]);

  const handleStartCaseBuilding = () => {
    if (!motion) {
      alert("Please select or type a motion first.");
      return;
    }
    setStep('case_building');
    setTimer(PREP_SECONDS);
    startTimer();
  };

  const startTimer = () => {
    clearInterval(timerIntervalRef.current);
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

  const handleSkipToSpeech = () => {
    clearInterval(timerIntervalRef.current);
    setStep('recording');
    setTimer(SPEECH_SECONDS);
  };

  const handleBeginSpeech = () => {
    clearAudio();
    setErrorMessage('');
    startRecording();
    startTimer();
  };

  const handleFinishSpeech = () => {
    stopRecording();
    clearInterval(timerIntervalRef.current);
  };

  const showResult = (view) => {
    const evalData = view.result;
    // Calculate overall score (Matter 40%, Manner 40%, Method 20%)
    const finalScore = (evalData.matter_score * 4) + (evalData.manner_score * 4) + (evalData.method_score * 2);
    setResultData({ ...evalData, transcript: view.transcript, finalScore });
    setStep('results');
  };

  const showError = (err) => {
    if (err?.cancelled) return; // component unmounted; it will resume later
    console.error(err);
    setErrorMessage(err?.message || "Error processing your speech. Please try again.");
    setStep('error');
  };

  // Resume a speech that was still being graded (page refresh / tab switch)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await submission.resume();
      if (!pending || cancelled) return;
      const meta = pending.meta || {};
      if (meta.motion) setMotion(meta.motion);
      if (meta.role) setRole(meta.role);
      if (meta.scratchpad) setScratchpad(meta.scratchpad);
      if (pending.blob) setAudioUrl(URL.createObjectURL(pending.blob));
      setStep('grading');
      try {
        const view = await pending.promise;
        if (!cancelled) showResult(view);
      } catch (err) {
        if (!cancelled) showError(err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleProcessSpeech = async (blob) => {
    const url = URL.createObjectURL(blob);
    setAudioUrl(url);
    setErrorMessage('');
    setStep('grading');
    try {
      const view = await submission.run({
        mode: 'debate',
        blob,
        // Debate scores are logged only when the student presses the save button.
        params: { motion, role, auto_save: 'false', session_seconds: getSessionSeconds?.() },
        duration: recordingTime,
        meta: { motion, role, scratchpad },
      });
      showResult(view);
    } catch (err) {
      showError(err);
    }
  };

  // Continue from where it stopped - the speech is never lost
  const handleRetry = async () => {
    setErrorMessage('');
    setStep('grading');
    try {
      showResult(await submission.retry());
    } catch (err) {
      showError(err);
    }
  };

  const handleSaveToLeaderboard = async () => {
    if (!resultData) return;
    const scoreData = { ...resultData, material_title: motion, motion, role };
    const subId = submission.currentId();
    try {
      // The server saves it with the student's verified identity (works even if
      // the browser's login session has expired while waiting).
      if (!subId) throw new Error('no submission id');
      await saveSubmissionOnServer(apiBase, subId);
      await onSaveScore('debate', scoreData, { alreadySaved: true });
    } catch (err) {
      console.warn('Server save failed, saving from the browser instead', err);
      await onSaveScore('debate', scoreData);
    }
    submission.clear();
  };

  const handleReset = () => {
    submission.clear();
    clearAudio();
    setErrorMessage('');
    setStep('setup');
    setMotion('');
    setScratchpad('');
    setAudioUrl(null);
    setResultData(null);
  };

  const handleBackToSpeech = () => {
    submission.clear();
    clearAudio();
    setErrorMessage('');
    setAudioUrl(null);
    setStep('recording');
    setTimer(SPEECH_SECONDS);
  };

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // ---------------- Render Helpers ----------------

  const roleBadge = (
    <Badge tone={role === 'Affirmative' ? 'brand' : 'warning'}>
      {role === 'Affirmative' ? 'Affirmative (Government)' : 'Negative (Opposition)'}
    </Badge>
  );

  const motionCard = (
    <div className="space-y-2">
      <span className="block text-[13px] font-semibold text-ink-muted">Motion</span>
      <p className="text-[15px] font-semibold text-ink leading-snug">{motion}</p>
      {roleBadge}
    </div>
  );

  if (step === 'setup') {
    return (
      <section className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-7 max-w-2xl animate-fadeIn">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-full bg-brand-tint text-brand-ink flex items-center justify-center shrink-0">
            <Users className="w-5 h-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-bold text-ink">Set up your debate</h2>
            <p className="text-sm text-ink-muted">
              Choose a motion and your side. You get {describeDuration(PREP_SECONDS)} to prepare and {describeDuration(SPEECH_SECONDS)} to speak.
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-5">
          <Field label="Motion">
            <Select value={motion} onChange={(e) => setMotion(e.target.value)}>
              <option value="" disabled>Choose a motion</option>
              {availableMotions.map((m, i) => (
                <option key={i} value={m}>{m}</option>
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

          <Button size="lg" fullWidth iconRight={ArrowRight} onClick={handleStartCaseBuilding} disabled={!motion}>
            Start preparing
          </Button>
        </div>
      </section>
    );
  }

  if (step === 'case_building') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 animate-fadeIn">
        <PinnedBar time={formatTime(timer)}>
          <Button size="sm" fullWidth icon={Mic} onClick={handleSkipToSpeech}>I'm ready - speak</Button>
        </PinnedBar>

        <aside className="lg:col-span-1">
          <div className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-6 space-y-5 lg:sticky lg:top-6">
            <div className="hidden lg:block">
              <span className="flex items-center gap-2 text-[13px] font-semibold text-ink-muted">
                <Clock className="w-4 h-4" aria-hidden="true" /> Preparation time left
              </span>
              <div className="mt-1 text-[44px] font-bold tabular-nums text-ink leading-none">{formatTime(timer)}</div>
            </div>
            {motionCard}
            <Button fullWidth icon={Mic} onClick={handleSkipToSpeech} className="hidden lg:inline-flex">
              I'm ready - start my speech
            </Button>
          </div>
        </aside>

        <section className="lg:col-span-2 bg-surface border border-line rounded-2xl shadow-card p-5 md:p-6 flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <FileText className="w-5 h-5 text-ink-subtle" aria-hidden="true" />
            <h2 className="text-base font-bold text-ink">Notes</h2>
          </div>
          <p className="text-sm text-ink-muted">
            Plan your arguments: Assertion, Explanation, Link back. Your notes stay on screen while you speak.
          </p>
          <Textarea
            value={scratchpad}
            onChange={(e) => setScratchpad(e.target.value)}
            placeholder="Argument 1: ..."
            aria-label="Notes"
            className="flex-1 min-h-[260px] lg:min-h-[360px] resize-none"
          />
        </section>
      </div>
    );
  }

  if (step === 'recording') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 animate-fadeIn">
        <PinnedBar time={formatTime(timer)} tone={isRecording ? 'text-danger' : 'text-ink'}>
          {!isRecording ? (
            <Button size="sm" fullWidth icon={Mic} onClick={handleBeginSpeech}>Record speech</Button>
          ) : (
            <Button size="sm" fullWidth variant="danger" icon={Square} onClick={handleFinishSpeech}>Stop and submit</Button>
          )}
        </PinnedBar>

        <aside className="lg:col-span-1 space-y-4">
          <div className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-6 space-y-5 lg:sticky lg:top-6">
            <div className="hidden lg:flex flex-col items-center text-center gap-3">
              <span className="text-[13px] font-semibold text-ink-muted">Speech time {describeDuration(SPEECH_SECONDS)}</span>
              <div className={`text-[44px] font-bold tabular-nums leading-none ${isRecording ? 'text-danger' : 'text-ink'}`}>{formatTime(timer)}</div>
              <RecordButton
                isRecording={isRecording}
                onClick={isRecording ? handleFinishSpeech : handleBeginSpeech}
                aria-label={isRecording ? `Stop recording, ${recordingTime} seconds recorded` : 'Record speech'}
              />
              <span className={`text-sm font-semibold ${isRecording ? 'text-danger' : 'text-ink'}`} aria-live="polite">
                {isRecording ? `Recording ${formatTime(recordingTime)} - tap to stop and submit` : 'Tap the microphone to start your speech'}
              </span>
            </div>
            {motionCard}
          </div>

          <div className="bg-surface border border-line rounded-2xl p-5">
            <h3 className="text-sm font-semibold text-ink">How you are scored</h3>
            <ul className="mt-2 space-y-1.5 text-sm text-ink-muted">
              <li><strong className="text-ink">Matter (40%)</strong> - logic, structure, depth</li>
              <li><strong className="text-ink">Manner (40%)</strong> - fluency, vocabulary, delivery</li>
              <li><strong className="text-ink">Method (20%)</strong> - signposting, time management</li>
            </ul>
          </div>
        </aside>

        <section className="lg:col-span-2 bg-surface border border-line rounded-2xl shadow-card p-5 md:p-6 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <FileText className="w-5 h-5 text-ink-subtle" aria-hidden="true" />
              <h2 className="text-base font-bold text-ink">Your notes</h2>
            </div>
            <TextSizeControl {...readingSizeControl} />
          </div>
          <div className="flex-1 min-h-[200px] bg-surface-muted rounded-xl p-4 text-ink whitespace-pre-wrap overflow-y-auto" style={readingStyle}>
            {scratchpad || <span className="text-ink-subtle">You did not write notes during preparation.</span>}
          </div>
        </section>
      </div>
    );
  }

  if (step === 'error') {
    return (
      <ErrorPanel
        icon={AlertTriangle}
        title={submission.progress?.retryable ? 'Not finished yet' : 'Something went wrong'}
        message={errorMessage}
        note={submission.progress?.retryable ? 'Your speech is saved. Tap Retry - you do not need to deliver it again.' : undefined}
      >
        {submission.progress?.retryable && submission.hasRecording() && (
          <Button onClick={handleRetry}>Retry</Button>
        )}
        {motion && (
          <Button variant="secondary" icon={Mic} onClick={handleBackToSpeech}>Record the speech again</Button>
        )}
        <Button variant="subtle" onClick={handleReset}>Start over</Button>
      </ErrorPanel>
    );
  }

  if (step === 'grading') {
    return (
      <div className="space-y-4 animate-fadeIn">
        <p className="text-[15px] text-ink-muted">
          Your speech is turned into text and then judged on Matter, Manner and Method.
        </p>
        <SubmissionProgress progress={submission.progress} />
      </div>
    );
  }

  if (step === 'results' && resultData) {
    const parts = [
      { key: 'Matter', sub: 'Substance · 40%', score: resultData.matter_score, feedback: resultData.matter_feedback },
      { key: 'Manner', sub: 'Delivery · 40%', score: resultData.manner_score, feedback: resultData.manner_feedback },
      { key: 'Method', sub: 'Structure · 20%', score: resultData.method_score, feedback: resultData.method_feedback },
    ];
    const band = scoreBand(resultData.finalScore);
    return (
      <div className="space-y-5 animate-fadeIn">
        <section className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-7">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <span className="text-[13px] font-semibold text-brand-ink">Debate result</span>
              <h2 className="text-lg md:text-xl font-bold text-ink leading-snug">{motion}</h2>
              <div className="mt-2">{roleBadge}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" icon={RotateCcw} onClick={handleReset}>New debate</Button>
              <Button
                onClick={handleSaveToLeaderboard}
                disabled={isSaving || saveStatus === 'success'}
                loading={isSaving}
                icon={saveStatus === 'success' ? CheckCircle2 : Save}
                variant={saveStatus === 'success' ? 'secondary' : 'primary'}
              >
                {isSaving ? 'Saving...' : saveStatus === 'success' ? 'Saved to your record' : 'Save score'}
              </Button>
            </div>
          </div>

          <div className="mt-5 grid gap-4 md:grid-cols-12">
            <div className="md:col-span-5 flex items-center gap-5 p-4 md:p-5 border border-line rounded-2xl">
              <ScoreRing value={resultData.finalScore} size={104} label="Overall score" />
              <div>
                <div className="text-[13px] font-semibold text-ink-muted">Overall score</div>
                <div className={`text-xl font-bold ${band.text}`}>{band.label}</div>
                <div className="text-[13px] text-ink-subtle mt-1">out of 100</div>
              </div>
            </div>
            <div className="md:col-span-7 grid grid-cols-3 gap-3">
              {parts.map((p) => (
                <div key={p.key} className="p-4 border border-line rounded-2xl">
                  <div className="text-[13px] font-semibold text-ink-muted">{p.key}</div>
                  <div className="text-[28px] font-bold text-ink tabular-nums leading-tight">
                    {p.score}<span className="text-base font-medium text-ink-subtle">/10</span>
                  </div>
                  <div className="text-xs text-ink-subtle">{p.sub}</div>
                </div>
              ))}
            </div>
          </div>

          {audioUrl && (
            <div className="mt-5">
              <span className="block text-[13px] font-semibold text-ink-muted mb-1.5">Your speech</span>
              <audio controls src={audioUrl} className="w-full h-10" />
            </div>
          )}
        </section>

        <section className="flex gap-3 p-5 md:p-6 rounded-2xl bg-brand-tint">
          <Lightbulb className="w-5 h-5 text-brand-ink shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h3 className="text-[15px] font-semibold text-brand-ink">Adjudicator's overall feedback</h3>
            <p className="text-[15px] text-ink leading-relaxed mt-1 whitespace-pre-wrap">{resultData.overall_feedback}</p>
          </div>
        </section>

        <div className="grid gap-4 md:grid-cols-3">
          {parts.map((p) => (
            <section key={p.key} className="bg-surface border border-line rounded-2xl p-5">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-base font-bold text-ink">{p.key}</h3>
                <span className="text-sm font-semibold text-ink-muted tabular-nums">{p.score}/10</span>
              </div>
              <p className="mt-2 text-[15px] text-ink-muted leading-relaxed">{p.feedback}</p>
            </section>
          ))}
        </div>

        <section className="bg-surface border border-line rounded-2xl p-5 md:p-6">
          <h3 className="text-[15px] font-semibold text-ink">What the AI heard</h3>
          <p className="mt-2 text-[15px] text-ink leading-relaxed bg-surface-muted rounded-xl p-4 whitespace-pre-wrap">
            {resultData.transcript}
          </p>
        </section>
      </div>
    );
  }

  return null;
}
