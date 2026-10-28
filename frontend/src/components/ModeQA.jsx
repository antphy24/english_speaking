import React, { useState, useEffect, useRef } from 'react';
import { useMediaRecorder } from '../hooks/useMediaRecorder';
import ScoreCard from './UI/ScoreCard';
import Spinner from './UI/Spinner';
import { Mic, MicOff, RefreshCw } from 'lucide-react';
import { Button } from './UI/Button';
import { PickerList } from './UI/PickerList';
import { RecorderBar } from './UI/Recorder';
import { ErrorPanel } from './UI/ErrorPanel';
import { TextSizeControl, useReadingSize } from './UI/TextSizeControl';
import useSubmission from '../hooks/useSubmission';
import SubmissionProgress from './UI/SubmissionProgress';

const QUESTIONS = [
  {
    id: 1,
    topic: "Problem Solving",
    prompt: "Describe a time you solved a difficult problem. You should explain what the problem was, how you went about solving it, and what you learned from this experience."
  },
  {
    id: 2,
    topic: "Memorable Journey",
    prompt: "Describe a place you have visited that made a strong impression on you. You should say where it is, when and why you went there, and explain what made it so memorable."
  },
  {
    id: 3,
    topic: "Healthy Hobby",
    prompt: "Describe a hobby or physical activity you enjoy to stay healthy. You should explain what the activity is, how often you do it, and why you would recommend it to others."
  }
];

export function ModeQA({ studentName, apiBase, onSaveScore, getSessionSeconds, customQuestions = [] }) {
  const customMapped = (customQuestions || []).map((m, idx) => ({
    id: m.id,
    topic: m.title || `Custom Topic ${idx + 1}`,
    prompt: m.content
  }));
  
  const questionsList = [...customMapped, ...QUESTIONS];

  const [selectedQuestion, setSelectedQuestion] = useState(questionsList[0]);
  const readingSize = useReadingSize();

  useEffect(() => {
    if (questionsList.length > 0) {
      setSelectedQuestion(prev => {
        const stillExists = questionsList.find(q => q.id === prev?.id);
        return stillExists || questionsList[0];
      });
    }
  }, [customQuestions]);
  const [status, setStatus] = useState('idle'); // 'idle' | 'recording' | 'processing' | 'graded' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [transcript, setTranscript] = useState('');
  const [evaluation, setEvaluation] = useState(null);

  const {
    isRecording,
    recordingTime,
    audioBlob,
    error: recordingError,
    startRecording,
    stopRecording,
    clearAudio
  } = useMediaRecorder();

  const [isSaving, setIsSaving] = useState(false);
  const submission = useSubmission(apiBase, 'qa');
  const resultMetaRef = useRef({});
  const [saveStatus, setSaveStatus] = useState('');

  // Sync recording error
  useEffect(() => {
    if (recordingError) {
      setStatus('error');
      setErrorMessage(recordingError);
    }
  }, [recordingError]);

  const handleSaveToLeaderboardRef = useRef(null);
  const processAudioRef = useRef(null);

  useEffect(() => {
    handleSaveToLeaderboardRef.current = handleSaveToLeaderboard;
    processAudioRef.current = processAudio;
  });

  // Auto-save score when grading completes
  useEffect(() => {
    if (status === 'graded' && evaluation) {
      submission.clear(); // result is in hand; don't resume/save it twice
      handleSaveToLeaderboardRef.current();
    }
  }, [status, evaluation]);

  // Handle when audio is recorded
  useEffect(() => {
    if (audioBlob && processAudioRef.current) {
      processAudioRef.current(audioBlob);
    }
  }, [audioBlob]);

  const savedOnServerRef = useRef(false);

  const showResult = (view) => {
    savedOnServerRef.current = !!view.saved;
    setTranscript(view.transcript || '');
    setEvaluation(view.result);
    setStatus('graded');
  };

  const showError = (err) => {
    if (err?.cancelled) return; // component unmounted; it will resume later
    console.error(err);
    setErrorMessage(err?.message || 'An error occurred during evaluation.');
    setStatus('error');
  };

  // Resume a submission that was still in progress (page refresh / tab switch)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await submission.resume();
      if (!pending || cancelled) return;
      resultMetaRef.current = pending.meta || {};
      if (pending.meta?.question) setSelectedQuestion(pending.meta.question);
      setStatus('processing');
      try {
        const view = await pending.promise;
        if (!cancelled) showResult(view);
      } catch (err) {
        if (!cancelled) showError(err);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const processAudio = async (blob) => {
    if (blob.size < 2000) {
      setErrorMessage("Recording was too short. Please speak clearly for at least 2 seconds.");
      setStatus('error');
      return;
    }
    setStatus('processing');
    setErrorMessage('');
    resultMetaRef.current = { question: selectedQuestion, material_title: selectedQuestion.topic };
    try {
      const view = await submission.run({
        mode: 'qa',
        blob,
        params: { question: selectedQuestion.prompt, material_title: selectedQuestion.topic, session_seconds: getSessionSeconds?.() },
        duration: recordingTime,
        meta: resultMetaRef.current,
      });
      showResult(view);
    } catch (err) {
      showError(err);
    }
  };

  const handleToggleRecord = () => {
    if (isRecording) {
      stopRecording();
    } else {
      clearAudio();
      setTranscript('');
      setEvaluation(null);
      setSaveStatus('');
      setStatus('recording');
      startRecording();
    }
  };

  // Continue from where it stopped - never needs a new recording
  const handleRetry = async () => {
    setStatus('processing');
    setErrorMessage('');
    try {
      showResult(await submission.retry());
    } catch (err) {
      showError(err);
    }
  };

  const handleRestart = () => {
    submission.clear();
    clearAudio();
    setTranscript('');
    setEvaluation(null);
    setSaveStatus('');
    setStatus('idle');
  };

  const handleSaveToLeaderboard = async () => {
    if (!evaluation || !studentName) return;
    setIsSaving(true);
    setSaveStatus('');
    try {
      const title = resultMetaRef.current?.material_title || selectedQuestion.topic;
      await onSaveScore('qa', { ...evaluation, material_title: title }, { alreadySaved: savedOnServerRef.current });
      setSaveStatus('success');
    } catch (err) {
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const { style: readingStyle, ...readingSizeControl } = readingSize;

  return (
    <div className="space-y-6">
      {(status === 'idle' || status === 'recording') && (
        <div className="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
          <PickerList
            title="Questions"
            items={questionsList.map((q) => ({ id: q.id, title: q.topic, meta: 'Speaking prompt' }))}
            selectedId={selectedQuestion.id}
            onSelect={(item) => setSelectedQuestion(questionsList.find((q) => q.id === item.id))}
            disabled={isRecording}
          />

          <section className="flex-1 min-w-0 bg-surface border border-line rounded-2xl shadow-card">
            <div className="p-5 md:p-7 space-y-4 md:space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="block text-[13px] font-semibold text-brand-ink">Answer this question</span>
                  <h2 className="text-lg font-bold text-ink leading-snug">{selectedQuestion.topic}</h2>
                </div>
                <TextSizeControl {...readingSizeControl} />
              </div>
              <p className="text-ink" style={readingStyle}>{selectedQuestion.prompt}</p>
              <p className="text-sm text-ink-subtle">
                Aim for 1-2 minutes. You are scored on fluency, vocabulary, grammar and pronunciation.
              </p>
            </div>

            <RecorderBar
              isRecording={isRecording}
              seconds={recordingTime}
              onToggle={handleToggleRecord}
              idleTitle="Tap the microphone to answer"
              idleHint="Think for a moment, then speak. Tap again when you finish."
              recordingHint="Tap the button when you finish your answer."
            />
          </section>
        </div>
      )}

      {/* Loading state */}
      {status === 'processing' && <SubmissionProgress progress={submission.progress} />}

      {/* Result */}
      {status === 'graded' && (
        <div className="space-y-4">
          <ScoreCard
            mode="qa"
            score={evaluation}
            onRestart={handleRestart}
            isSaving={isSaving}
            saveStatus={saveStatus}
            onSaveToLeaderboard={handleSaveToLeaderboard}
          />
          <div className="bg-surface border border-line rounded-2xl p-5 md:px-7">
            <span className="block text-[13px] font-semibold text-ink-muted mb-1.5">What the AI heard</span>
            <p className="text-[15px] text-ink leading-relaxed">“{transcript}”</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {status === 'error' && (
        <ErrorPanel
          icon={MicOff}
          title={submission.progress?.retryable ? 'Not finished yet' : 'Recording stopped'}
          message={errorMessage}
          note={submission.progress?.retryable ? 'Your recording is saved. Tap Retry - you do not need to record again.' : undefined}
        >
          {submission.progress?.retryable && submission.hasRecording() && (
            <Button icon={RefreshCw} onClick={handleRetry}>Retry</Button>
          )}
          <Button variant="secondary" icon={Mic} onClick={handleRestart}>Record again</Button>
        </ErrorPanel>
      )}
    </div>
  );
}
export default ModeQA;
