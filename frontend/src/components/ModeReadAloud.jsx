import React, { useState, useEffect, useRef } from 'react';
import { useMediaRecorder } from '../hooks/useMediaRecorder';
import ScoreCard from './UI/ScoreCard';
import Spinner from './UI/Spinner';
import { Mic, MicOff, RefreshCw, Volume2, Square, ArrowRight, AlertCircle } from 'lucide-react';
import { Button } from './UI/Button';
import { TextSizeControl, useReadingSize } from './UI/TextSizeControl';
import useSubmission from '../hooks/useSubmission';
import SubmissionProgress from './UI/SubmissionProgress';
import { speakEnglish, stopSpeaking } from '../utils/speech';
import useSwipeRow from '../hooks/useSwipeRow';

const PARAGRAPHS = [
  {
    id: 1,
    title: "Vocal Warmup (Easy)",
    text: "The quick brown fox jumps over the lazy dog. This pangram contains every letter of the English alphabet at least once. It is often used for keyboard typing practice."
  },
  {
    id: 2,
    title: "Climate Change (Medium)",
    text: "Climate change is one of the most pressing global challenges of our time. Rising temperatures, melting glaciers, and extreme weather events are causing significant disruptions to ecosystems and human societies worldwide. Transitioning to renewable energy sources is essential to mitigate these impacts."
  },
  {
    id: 3,
    title: "Digital Technology (Hard)",
    text: "Technology has revolutionized the way we communicate and access information. While it has brought people closer together and made learning more accessible, it has also raised concerns about digital privacy and the decline of face-to-face social interactions. Striking a balance is crucial."
  }
];

export function ModeReadAloud({ studentName, apiBase, onSaveScore, getSessionSeconds, customParagraphs = [] }) {
  const customMapped = (customParagraphs || []).map((m, idx) => ({
    id: m.id,
    title: m.title || `Custom Paragraph ${idx + 1}`,
    text: m.content
  }));
  
  const paragraphsList = [...customMapped, ...PARAGRAPHS];

  const [selectedParagraph, setSelectedParagraph] = useState(paragraphsList[0]);
  const swipeRef = useSwipeRow();
  const readingSize = useReadingSize();

  useEffect(() => {
    if (paragraphsList.length > 0) {
      setSelectedParagraph(prev => {
        const stillExists = paragraphsList.find(p => p.id === prev?.id);
        return stillExists || paragraphsList[0];
      });
    }
  }, [customParagraphs]);

  const [status, setStatus] = useState('idle'); // 'idle' | 'processing' | 'graded' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [transcript, setTranscript] = useState('');
  const [evaluation, setEvaluation] = useState(null);
  const submission = useSubmission(apiBase, 'read_aloud');
  const resultMetaRef = useRef({});

  const pointerDownTimeRef = useRef(0);
  const [isToggleRecording, setIsToggleRecording] = useState(false);

  const [isSpeaking, setIsSpeaking] = useState(false);
  const [speechNotice, setSpeechNotice] = useState('');

  useEffect(() => () => stopSpeaking(), []);

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

  // Recording gestures.
  // - Touch screens (iPhone, Android) and keyboard: tap to start, tap again to stop.
  //   Recording starts from the click itself, because iPhone Safari only treats a
  //   finished tap - not the first touch - as permission to open the microphone.
  // - Mouse: tap to toggle, or hold the button down and release to submit.
  const mouseGestureRef = useRef(false);
  const startedOnPressRef = useRef(false);

  const handlePointerDown = (e) => {
    if (e.pointerType !== 'mouse' || e.button !== 0) return;
    mouseGestureRef.current = true;
    pointerDownTimeRef.current = Date.now();
    startedOnPressRef.current = !isRecording;
    if (!isRecording) {
      startRecording();
      setIsToggleRecording(false);
    }
  };

  const handlePointerUp = (e) => {
    if (e.pointerType !== 'mouse' || !mouseGestureRef.current) return;
    const duration = Date.now() - pointerDownTimeRef.current;
    if (startedOnPressRef.current && duration < 300) {
      // Short click: keep recording until the next click
      setIsToggleRecording(true);
    } else {
      // Released after holding, or clicked again while recording
      stopRecording();
      setIsToggleRecording(false);
    }
  };

  const handlePointerLeave = (e) => {
    if (e.pointerType !== 'mouse' || !mouseGestureRef.current) return;
    mouseGestureRef.current = false;
    if (!isToggleRecording) stopRecording();
  };

  const handleRecordClick = () => {
    if (mouseGestureRef.current) {
      // Already handled by the mouse press/release above
      mouseGestureRef.current = false;
      return;
    }
    if (isRecording) {
      stopRecording();
      setIsToggleRecording(false);
    } else {
      setIsToggleRecording(true);
      startRecording();
    }
  };

  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // '' | 'success' | 'error'

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
    setErrorMessage(err?.message || 'An error occurred during speech evaluation.');
    setStatus('error');
  };

  // Resume a submission that was still in progress (page refresh / tab switch)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const pending = await submission.resume();
      if (!pending || cancelled) return;
      resultMetaRef.current = pending.meta || {};
      if (pending.meta?.paragraph) setSelectedParagraph(pending.meta.paragraph);
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
      setErrorMessage("Recording was too short. Tap the microphone, read the text clearly, then tap again to finish.");
      setStatus('error');
      return;
    }
    setStatus('processing');
    setErrorMessage('');
    resultMetaRef.current = { paragraph: selectedParagraph, material_title: selectedParagraph.title };
    try {
      const view = await submission.run({
        mode: 'read_aloud',
        blob,
        params: { source_text: selectedParagraph.text, material_title: selectedParagraph.title, session_seconds: getSessionSeconds?.() },
        duration: recordingTime,
        meta: resultMetaRef.current,
      });
      showResult(view);
    } catch (err) {
      showError(err);
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
    setIsToggleRecording(false);
    setStatus('idle');
  };

  const handleSaveToLeaderboard = async () => {
    if (!evaluation || !studentName) return;
    setIsSaving(true);
    setSaveStatus('');
    try {
      const title = resultMetaRef.current?.material_title || selectedParagraph.title;
      await onSaveScore('read_aloud', { ...evaluation, material_title: title }, { alreadySaved: savedOnServerRef.current });
      setSaveStatus('success');
    } catch (err) {
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  // Read the paragraph to the student in clear American English
  const speakParagraph = () => {
    if (isSpeaking) {
      stopSpeaking();
      setIsSpeaking(false);
      return;
    }
    setSpeechNotice('');
    const started = speakEnglish(selectedParagraph.text, { rate: 0.9, onEnd: () => setIsSpeaking(false) });
    if (started) setIsSpeaking(true);
    else setSpeechNotice('This browser cannot play the sample voice.');
  };

  // A different paragraph was chosen: stop reading the old one
  useEffect(() => {
    stopSpeaking();
    setIsSpeaking(false);
  }, [selectedParagraph?.id]);

  const { style: readingStyle, ...readingSizeControl } = readingSize;
  const wordCount = (text = '') => text.trim().split(/\s+/).filter(Boolean).length;
  const clock = `${Math.floor(recordingTime / 60)}:${String(recordingTime % 60).padStart(2, '0')}`;
  const selectedIndex = Math.max(0, paragraphsList.findIndex((p) => p.id === selectedParagraph?.id));
  const goToNextParagraph = () => {
    handleRestart();
    setSelectedParagraph(paragraphsList[(selectedIndex + 1) % paragraphsList.length]);
  };

  return (
    <div className="space-y-6">
      {status === 'idle' && (
        <div className="flex flex-col md:flex-row md:items-start gap-4 md:gap-6">
          {/* Paragraph picker: swipeable cards on phones, list on laptops */}
          <section aria-label="Paragraphs" className="md:w-64 lg:w-72 shrink-0 min-w-0 space-y-2.5">
            <h2 className="text-sm font-semibold text-ink-muted">
              Paragraphs
              {paragraphsList.length > 1 && <span className="md:hidden font-normal text-ink-subtle"> · swipe for more</span>}
            </h2>
            <div ref={swipeRef} className="no-scrollbar flex md:flex-col gap-2.5 overflow-x-auto md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0 pb-1 md:pb-0">
              {paragraphsList.map((p) => {
                const active = selectedParagraph.id === p.id;
                const words = wordCount(p.text);
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedParagraph(p)}
                    aria-pressed={active}
                    className={`shrink-0 md:w-full text-left px-4 py-3.5 rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-ring ${
                      paragraphsList.length > 1 ? 'w-[72%]' : 'w-full'
                    } ${
                      active
                        ? 'bg-brand-tint border-brand ring-1 ring-inset ring-brand'
                        : 'bg-surface border-line hover:border-line-strong'
                    }`}
                  >
                    <span className={`block text-[15px] font-semibold line-clamp-2 ${active ? 'text-brand-ink' : 'text-ink'}`}>{p.title}</span>
                    <span className="block text-[13px] text-ink-subtle mt-1">{words} words</span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* Reading card */}
          <section className="flex-1 min-w-0 bg-surface border border-line rounded-2xl shadow-card">
            <div className="p-5 md:p-7 space-y-4 md:space-y-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="block text-[13px] font-semibold text-brand-ink">Read this aloud</span>
                  <h2 className="text-lg font-bold text-ink leading-snug">{selectedParagraph.title}</h2>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <TextSizeControl {...readingSizeControl} />
                  <Button
                    variant="secondary"
                    size="sm"
                    icon={Volume2}
                    onClick={speakParagraph}
                    title="Listen to a model reading in American English"
                  >
                    {isSpeaking ? 'Stop' : 'Listen first'}
                  </Button>
                </div>
              </div>
              {speechNotice && <p className="text-sm text-warning">{speechNotice}</p>}

              <p className="text-ink select-none" style={readingStyle}>
                {selectedParagraph.text}
              </p>
            </div>

            {/* Recorder: always pinned to the bottom of the screen (phones and laptops), so the
                mic stays in reach while the student reads from the first sentence */}
            <div className="sticky bottom-0 z-20 flex items-center gap-4 md:gap-5 px-5 md:px-7 pt-3.5 pb-safe md:py-4 bg-surface border-t border-line rounded-b-2xl shadow-[0_-6px_16px_rgb(16_24_40/0.08)]">
              <button
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerLeave}
                onClick={handleRecordClick}
                onContextMenu={(e) => e.preventDefault()}
                type="button"
                aria-label={isRecording ? `Recording in progress, ${recordingTime} seconds. Tap to stop` : 'Tap to record your reading'}
                style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent' }}
                className={`relative w-16 h-16 md:w-[72px] md:h-[72px] rounded-full flex items-center justify-center text-white transition-colors select-none shrink-0 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-ring ${
                  isRecording
                    ? 'bg-danger-solid animate-mic-ring'
                    : 'bg-brand hover:bg-brand-hover shadow-mic active:scale-95'
                }`}
              >
                {isRecording ? <Square className="w-6 h-6 fill-current" aria-hidden="true" /> : <Mic className="w-7 h-7 md:w-8 md:h-8" aria-hidden="true" />}
              </button>

              <div className="flex-1 min-w-0" aria-live="polite">
                <span className={`block text-base font-semibold ${isRecording ? 'text-danger' : 'text-ink'}`}>
                  {isRecording ? `Recording ${clock}` : 'Tap the microphone to start'}
                </span>
                <span className="block text-[13px] md:text-sm text-ink-muted mt-0.5">
                  {isRecording
                    ? (isToggleRecording ? 'Tap the button when you finish reading.' : 'Release to submit.')
                    : 'Find a quiet spot and read at a natural pace. Tap again when you finish.'}
                </span>
              </div>

              {isRecording && (
                <div className="flex items-center gap-1 h-7 shrink-0" aria-hidden="true">
                  {[0, 0.15, 0.3, 0.45].map((d) => (
                    <span key={d} className="w-1 h-[22px] rounded-sm bg-danger animate-level-bar" style={{ animationDelay: `${d}s` }} />
                  ))}
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {/* Loading State */}
      {status === 'processing' && <SubmissionProgress progress={submission.progress} />}

      {/* Result */}
      {status === 'graded' && (
        <div className="space-y-4">
          <ScoreCard
            mode="read_aloud"
            score={evaluation}
            onRestart={handleRestart}
            isSaving={isSaving}
            saveStatus={saveStatus}
            onSaveToLeaderboard={handleSaveToLeaderboard}
            nextAction={paragraphsList.length > 1 && (
              <Button icon={ArrowRight} onClick={goToNextParagraph}>Next paragraph</Button>
            )}
          />
          <div className="bg-surface border border-line rounded-2xl p-5 md:px-7">
            <span className="block text-[13px] font-semibold text-ink-muted mb-1.5">What the AI heard</span>
            <p className="text-[15px] text-ink leading-relaxed">“{transcript}”</p>
          </div>
        </div>
      )}

      {/* Error state */}
      {status === 'error' && (
        <div className="bg-surface border border-line rounded-2xl shadow-card p-6 md:p-8 flex flex-col items-center text-center gap-4">
          <div className="w-12 h-12 rounded-full bg-danger-tint text-danger flex items-center justify-center">
            {submission.progress?.retryable ? <AlertCircle className="w-6 h-6" aria-hidden="true" /> : <MicOff className="w-6 h-6" aria-hidden="true" />}
          </div>
          <div className="space-y-1.5 max-w-md">
            <h3 className="text-lg font-bold text-ink">
              {submission.progress?.retryable ? 'Not finished yet' : 'Recording failed'}
            </h3>
            <p className="text-[15px] text-ink-muted">{errorMessage}</p>
            {submission.progress?.retryable && (
              <p className="text-sm text-ink-subtle">Your recording is saved. Tap Retry - you do not need to record again.</p>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {submission.progress?.retryable && submission.hasRecording() && (
              <Button icon={RefreshCw} onClick={handleRetry}>Retry</Button>
            )}
            <Button variant="secondary" icon={Mic} onClick={handleRestart}>Record again</Button>
          </div>
        </div>
      )}
    </div>
  );
}
export default ModeReadAloud;
