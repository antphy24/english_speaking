import React, { useState, useEffect, useRef } from 'react';
import { useMediaRecorder } from '../hooks/useMediaRecorder';
import { speakEnglish } from '../utils/speech';
import ScoreCard from './UI/ScoreCard';
import Spinner from './UI/Spinner';
import { useConfirm } from './UI/ConfirmModal';
import { Mic, Volume2, VolumeX, User, Bot, AlertTriangle, MessageSquare, ArrowRight } from 'lucide-react';
import { Field, Select } from './UI/Field';
import { Button } from './UI/Button';
import { RecorderBar } from './UI/Recorder';
import { ErrorPanel } from './UI/ErrorPanel';
import { TextSizeControl, useReadingSize } from './UI/TextSizeControl';
import { getChatReplyWithRetry } from '../utils/api';
import useSubmission from '../hooks/useSubmission';
import SubmissionProgress from './UI/SubmissionProgress';

const DEFAULT_GREETINGS = [
  { id: 'def-1', title: "General Chat", content: "Hello {studentName}! I am your AI English conversation partner. What is a topic you would like to chat about today? Or we can talk about your hobbies!" },
  { id: 'def-2', title: "Job Interview Practice", content: "Hello {studentName}! I will be acting as your hiring manager today. To start, please introduce yourself and tell me about your background." },
  { id: 'def-3', title: "Travel & Tourism", content: "Hi {studentName}! Imagine we just met at a hostel in Tokyo. What brings you to Japan?" }
];

export function ModeConversation({ studentName, apiBase, onSaveScore, getSessionSeconds, customGreetings = [] }) {
  const confirm = useConfirm();
  const [step, setStep] = useState('setup'); // setup -> chatting
  const availableGreetings = [
    ...(customGreetings || []).map((m, idx) => ({
      id: m.id || `custom-${idx}`,
      title: m.title || `Custom Topic ${idx + 1}`,
      content: m.content
    })),
    ...DEFAULT_GREETINGS
  ];
  
  const [selectedTopic, setSelectedTopic] = useState(availableGreetings[0]);

  // Prevent reversion bug
  useEffect(() => {
    if (availableGreetings.length > 0) {
      setSelectedTopic(prev => {
        const stillExists = availableGreetings.find(g => g.id === prev?.id);
        return stillExists || availableGreetings[0];
      });
    }
  }, [customGreetings]);

  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState('idle'); // 'idle' | 'recording' | 'transcribing' | 'bot_replying' | 'grading' | 'graded' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const readingSize = useReadingSize();
  const { style: readingStyle, ...readingSizeControl } = readingSize;
  const [evaluation, setEvaluation] = useState(null);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [errorType, setErrorType] = useState(null); // null | 'turn' | 'reply' | 'grading'
  const [tutorBusy, setTutorBusy] = useState(false);
  // Each spoken turn is transcribed through the queue (priority lane);
  // the final evaluation is a separate, resumable submission.
  const turn = useSubmission(apiBase, 'conversation_turn', { persist: false });
  const grader = useSubmission(apiBase, 'conversation');
  const topicRef = useRef(null);
  const savedOnServerRef = useRef(false);
  useEffect(() => {
    return () => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Custom Recording Hook
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
  const [saveStatus, setSaveStatus] = useState('');
  const chatEndRef = useRef(null);

  // Sync recording error
  useEffect(() => {
    if (recordingError) {
      setStatus('error');
      setErrorMessage(recordingError);
    }
  }, [recordingError]);

  const handleSaveToLeaderboardRef = useRef(null);
  const processAudioRef = useRef(null);
  const hasGreetedRef = useRef(false);

  useEffect(() => {
    handleSaveToLeaderboardRef.current = handleSaveToLeaderboard;
    processAudioRef.current = processAudio;
  });

  // Auto-save score when grading completes
  useEffect(() => {
    if (status === 'graded' && evaluation) {
      grader.clear(); // result is in hand; don't resume/save it twice
      handleSaveToLeaderboardRef.current?.();
    }
  }, [status, evaluation]);

  // Resume an evaluation that was still running (page refresh / tab switch)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await grader.resume();
      if (!pending || cancelled) return;
      const meta = pending.meta || {};
      hasGreetedRef.current = true;
      if (meta.topic) { setSelectedTopic(meta.topic); topicRef.current = meta.topic; }
      if (meta.messages) setMessages(meta.messages);
      setStep('chatting');
      setStatus('grading');
      try {
        const view = await pending.promise;
        if (!cancelled) { savedOnServerRef.current = !!view.saved; setEvaluation(view.result); setStatus('graded'); }
      } catch (err) {
        if (!cancelled && !err?.cancelled) {
          setErrorMessage(err.message || 'An error occurred during evaluation.');
          setErrorType('grading');
          setStatus('error');
        }
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Handle when audio is recorded
  useEffect(() => {
    if (audioBlob && processAudioRef.current) {
      processAudioRef.current(audioBlob);
    }
  }, [audioBlob]);

  // Scroll to bottom on new message
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, status]);

  // Start conversation with a greeting from the AI tutor
  useEffect(() => {
    if (step === 'chatting' && messages.length === 0 && !hasGreetedRef.current) {
      hasGreetedRef.current = true;
      const greetingText = selectedTopic.content.replace('{studentName}', studentName || 'there');
      setMessages([{ role: 'assistant', content: greetingText }]);
      // Read aloud the greeting after a brief delay so voices can load
      setTimeout(() => {
        speakText(greetingText);
      }, 500);
    }
  }, [step, selectedTopic, studentName, messages.length]);

  // Helper to read text aloud via Web Speech API
  const speakText = (text) => {
    if (!ttsEnabled) return;
    speakEnglish(text, { rate: 1.0 });
  };

  const requestTutorReply = async (history) => {
    setStatus('bot_replying');
    setTutorBusy(false);
    try {
      const reply = await getChatReplyWithRetry(apiBase, history, { onBusy: () => setTutorBusy(true) });
      setMessages([...history, { role: 'assistant', content: reply }]);
      speakText(reply);
      setStatus('idle');
    } catch (err) {
      console.error(err);
      setErrorMessage(err.message || 'The tutor could not reply.');
      setErrorType('reply');
      setStatus('error');
    } finally {
      setTutorBusy(false);
    }
  };

  const continueWithTranscript = async (text) => {
    if (!text || text.trim().length === 0) {
      setErrorMessage("No speech was detected. Please make sure your mic is working and try again.");
      setErrorType('turn');
      setStatus('error');
      return;
    }
    const updatedMessages = [...messages, { role: 'user', content: text }];
    setMessages(updatedMessages);
    turn.clear();
    await requestTutorReply(updatedMessages);
  };

  const handleTurnError = (err) => {
    if (err?.cancelled) return;
    console.error(err);
    setErrorMessage(err?.message || 'An error occurred during dialogue.');
    setErrorType('turn');
    setStatus('error');
  };

  const processAudio = async (blob) => {
    if (blob.size < 2000) {
      setErrorMessage("Recording was too short. Please speak clearly for at least 2 seconds.");
      setErrorType('turn');
      setStatus('error');
      return;
    }
    setStatus('transcribing');
    try {
      const view = await turn.run({ mode: 'transcribe', blob, duration: recordingTime });
      await continueWithTranscript(view.result?.text || view.transcript);
    } catch (err) {
      handleTurnError(err);
    }
  };

  const handleRetryTurn = async () => {
    setStatus('transcribing');
    try {
      const view = await turn.retry();
      await continueWithTranscript(view.result?.text || view.transcript);
    } catch (err) {
      handleTurnError(err);
    }
  };

  const handleToggleRecord = () => {
    if (isRecording) {
      stopRecording();
    } else {
      clearAudio();
      setErrorMessage('');
      setStatus('recording');
      startRecording();
    }
  };

  // User decides to evaluate the conversation
  const handleEndConversation = async () => {
    // Calculate student turns (messages with role 'user')
    const studentTurns = messages.filter(m => m.role === 'user').length;
    if (studentTurns < 3) {
      const confirmEnd = await confirm({
        title: 'End Conversation Early?',
        message: `You have only spoken ${studentTurns} time${studentTurns !== 1 ? 's' : ''}. We recommend 3–5 speaking turns for a high-quality IELTS evaluation. Grade now anyway?`,
        confirmLabel: 'Grade Now',
        cancelLabel: 'Keep Talking',
        variant: 'warning',
      });
      if (!confirmEnd) return;
    }

    // Stop speaking
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    await runGrading();
  };

  const showGradingError = (err) => {
    if (err?.cancelled) return;
    console.error(err);
    setErrorMessage(err?.message || 'An error occurred during evaluation.');
    setErrorType('grading');
    setStatus('error');
  };

  const runGrading = async () => {
    setStatus('grading');
    topicRef.current = selectedTopic;
    try {
      const view = await grader.run({
        mode: 'conversation',
        textBody: { messages, material_title: selectedTopic.title, session_seconds: getSessionSeconds?.() },
        meta: { messages, topic: selectedTopic },
      });
      savedOnServerRef.current = !!view.saved;
      setEvaluation(view.result);
      setStatus('graded');
    } catch (err) {
      showGradingError(err);
    }
  };

  // Continue the evaluation from where it stopped (conversation is kept)
  const handleRetryGrading = async () => {
    setStatus('grading');
    try {
      const view = grader.hasRecording() ? await grader.retry() : null;
      if (!view) return runGrading();
      savedOnServerRef.current = !!view.saved;
      setEvaluation(view.result);
      setStatus('graded');
    } catch (err) {
      showGradingError(err);
    }
  };

  const handleRestart = () => {
    grader.clear();
    turn.clear();
    setStep('setup');
    setMessages([]);
    hasGreetedRef.current = false;
    setEvaluation(null);
    setSaveStatus('');
    setErrorType(null);
    setStatus('idle');
  };

  const handleSaveToLeaderboard = async () => {
    if (!evaluation || !studentName) return;
    setIsSaving(true);
    setSaveStatus('');
    try {
      const title = (topicRef.current || selectedTopic)?.title;
      await onSaveScore('conversation', { ...evaluation, material_title: title }, { alreadySaved: savedOnServerRef.current });
      setSaveStatus('success');
    } catch (err) {
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  const studentTurnsCount = messages.filter(m => m.role === 'user').length;

  // ---------------- Render Helpers ----------------
  
  if (step === 'setup') {
    return (
      <section className="bg-surface border border-line rounded-2xl shadow-card p-5 md:p-7 max-w-2xl animate-fadeIn">
        <div className="flex items-center gap-3">
          <span className="w-11 h-11 rounded-full bg-brand-tint text-brand-ink flex items-center justify-center shrink-0">
            <MessageSquare className="w-5 h-5" aria-hidden="true" />
          </span>
          <div>
            <h2 className="text-lg font-bold text-ink">Choose a topic</h2>
            <p className="text-sm text-ink-muted">Your AI partner starts the conversation. Answer by voice, 3-5 times.</p>
          </div>
        </div>

        <div className="mt-6 space-y-5">
          <Field label="Topic">
            <Select
              value={selectedTopic.id}
              onChange={(e) => {
                const topic = availableGreetings.find(g => g.id.toString() === e.target.value);
                if (topic) setSelectedTopic(topic);
              }}
            >
              {availableGreetings.map((g) => (
                <option key={g.id} value={g.id}>{g.title}</option>
              ))}
            </Select>
          </Field>

          <div className="p-4 bg-surface-muted rounded-xl">
            <span className="block text-[13px] font-semibold text-ink-muted mb-1">Your partner will start with</span>
            <p className="text-[15px] text-ink leading-relaxed">“{selectedTopic.content.replace('{studentName}', studentName || 'there')}”</p>
          </div>

          <Button size="lg" fullWidth iconRight={ArrowRight} onClick={() => setStep('chatting')}>
            Start conversation
          </Button>
        </div>
      </section>
    );
  }

  const busy = status === 'bot_replying' || status === 'transcribing';
  const typingDots = (
    <span className="flex gap-1" aria-hidden="true">
      {[0, 0.15, 0.3].map((d) => (
        <span key={d} className="w-1.5 h-1.5 bg-brand rounded-full animate-pulse" style={{ animationDelay: `${d}s` }} />
      ))}
    </span>
  );

  return (
    <div className="space-y-6">
      {status !== 'graded' && status !== 'error' && status !== 'grading' && (
        <section className="flex flex-col h-[72dvh] min-h-[440px] md:h-[620px] bg-surface border border-line rounded-2xl shadow-card overflow-hidden">
          {/* Chat header */}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 md:px-6 py-3 border-b border-line">
            <div className="flex items-center gap-3 min-w-0">
              <span className="w-9 h-9 rounded-full bg-brand-tint text-brand-ink flex items-center justify-center shrink-0">
                <Bot className="w-5 h-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 leading-tight">
                <h2 className="text-[15px] font-bold text-ink truncate">AI conversation partner</h2>
                <p className="text-[13px] text-ink-subtle">
                  Turn {studentTurnsCount} of 5 · aim for 3-5 turns, then end to get your score
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="subtle"
                size="sm"
                icon={ttsEnabled ? Volume2 : VolumeX}
                onClick={() => setTtsEnabled(!ttsEnabled)}
                aria-pressed={ttsEnabled}
                title="Read the partner's replies out loud"
              >
                {ttsEnabled ? 'Voice on' : 'Voice off'}
              </Button>
              <Button size="sm" onClick={handleEndConversation} disabled={busy}>
                End and get score
              </Button>
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 md:px-6 py-5 space-y-4 bg-canvas" aria-live="polite">
            {messages.map((msg, index) => {
              const mine = msg.role === 'user';
              return (
                <div key={index} className={`flex items-end gap-2 md:gap-3 max-w-[92%] md:max-w-[78%] ${mine ? 'ml-auto flex-row-reverse' : ''}`}>
                  <span
                    className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${mine ? 'bg-brand text-white' : 'bg-surface border border-line text-brand-ink'}`}
                    aria-hidden="true"
                  >
                    {mine ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                  </span>
                  <div
                    className={`px-4 py-3 rounded-2xl leading-relaxed ${
                      mine ? 'bg-brand text-white rounded-br-md' : 'bg-surface border border-line text-ink rounded-bl-md'
                    }`}
                    style={readingStyle}
                  >
                    <span className="sr-only">{mine ? 'You: ' : 'Partner: '}</span>
                    <p>{msg.content}</p>
                    {!mine && (
                      <button
                        type="button"
                        onClick={() => speakText(msg.content)}
                        className="mt-1.5 -mb-1 inline-flex items-center gap-1.5 min-h-[32px] text-[13px] font-semibold text-brand-ink hover:underline underline-offset-4"
                      >
                        <Volume2 className="w-3.5 h-3.5" aria-hidden="true" />
                        Play again
                      </button>
                    )}
                  </div>
                </div>
              );
            })}

            {status === 'transcribing' && (
              <div className="flex items-center gap-2.5 text-sm text-ink-muted">
                {typingDots}
                <span>
                  {turn.progress?.offline
                    ? 'Connection problem - retrying...'
                    : turn.progress?.position
                      ? `Waiting to turn your message into text (#${turn.progress.position} in line)...`
                      : turn.progress?.phase === 'waiting'
                        ? 'The server is busy - your message is saved, please wait...'
                        : 'Turning your voice message into text...'}
                </span>
              </div>
            )}

            {status === 'bot_replying' && (
              <div className="flex items-center gap-2.5 text-sm text-ink-muted">
                {typingDots}
                <span>{tutorBusy ? 'Your partner is busy with other students - retrying, please wait...' : 'Your partner is typing...'}</span>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          <div className="flex items-center gap-2 px-4 md:px-6 pt-1 pb-0 bg-surface border-t border-line md:hidden">
            <TextSizeControl {...readingSizeControl} className="my-2" />
            <span className="text-[13px] text-ink-subtle">Text size</span>
          </div>

          <RecorderBar
            sticky={false}
            isRecording={isRecording}
            seconds={recordingTime}
            onToggle={handleToggleRecord}
            disabled={busy}
            idleTitle={busy ? 'Please wait...' : 'Tap the microphone to speak'}
            idleHint="Your message is sent when you tap again."
            recordingHint="Tap the button to send your message."
            className="rounded-none md:rounded-b-2xl"
          >
            <TextSizeControl {...readingSizeControl} className="hidden md:inline-flex" />
          </RecorderBar>
        </section>
      )}

      {/* Grading */}
      {status === 'grading' && <SubmissionProgress progress={grader.progress} />}

      {/* Result */}
      {status === 'graded' && (
        <ScoreCard
          mode="conversation"
          score={evaluation}
          onRestart={handleRestart}
          isSaving={isSaving}
          saveStatus={saveStatus}
          onSaveToLeaderboard={handleSaveToLeaderboard}
        />
      )}

      {/* Error state */}
      {status === 'error' && (
        <ErrorPanel
          icon={AlertTriangle}
          title={errorType === 'grading' ? 'Scoring did not finish' : 'The conversation was interrupted'}
          message={errorMessage}
        >
          {errorType === 'grading' && (
            <>
              <Button onClick={handleRetryGrading}>Try scoring again</Button>
              <Button variant="secondary" onClick={() => { setStatus('idle'); setErrorType(null); }}>Back to the chat</Button>
            </>
          )}
          {errorType === 'reply' && (
            <Button onClick={() => requestTutorReply(messages)}>Ask for the reply again</Button>
          )}
          {errorType === 'turn' && (
            <>
              {turn.progress?.retryable && turn.hasRecording() && (
                <Button onClick={handleRetryTurn}>Send my message again</Button>
              )}
              <Button
                variant="secondary"
                icon={Mic}
                onClick={() => { setStatus('idle'); setErrorType(null); clearAudio(); turn.clear(); }}
              >
                Record the message again
              </Button>
            </>
          )}
          <Button variant="danger-outline" onClick={handleRestart}>Start a new conversation</Button>
        </ErrorPanel>
      )}
    </div>
  );
}
export default ModeConversation;
