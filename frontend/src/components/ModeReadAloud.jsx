import React, { useState, useEffect, useRef } from 'react';
import { useMediaRecorder } from '../hooks/useMediaRecorder';
import ScoreCard from './UI/ScoreCard';
import Spinner from './UI/Spinner';
import { Mic, Info, RefreshCw, Volume2 } from 'lucide-react';
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

  return (
    <div className="space-y-6">
      
      {/* Intro info */}
      <div className="hidden md:flex items-start space-x-3 bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-xl">
        <Info className="w-5 h-5 text-indigo-400 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-indigo-200 leading-relaxed">
          <strong className="text-white block mb-0.5">Mode 1: Read Aloud Assessment</strong>
          Select a text paragraph, review it, then tap the microphone button and read it aloud. Tap the button again when you finish to transcribe and automatically grade your pronunciation and accuracy.
        </div>
      </div>

      {status === 'idle' && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 md:gap-6">
          {/* Paragraph selector: swipeable row on phones, list on desktop */}
          <div className="md:col-span-1 space-y-2 md:space-y-3 min-w-0">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">
              Select Paragraph{paragraphsList.length > 1 && <span className="md:hidden normal-case font-normal text-slate-500"> · swipe for more</span>}
            </h4>
            <div ref={swipeRef} className="no-scrollbar flex md:flex-col gap-2 md:gap-0 md:space-y-2 overflow-x-auto md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0">
              {paragraphsList.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedParagraph(p)}
                  className={`p-3 text-left rounded-xl border transition-all duration-200 shrink-0 md:w-auto ${paragraphsList.length > 1 ? 'w-[72%]' : 'w-full'} ${
                    selectedParagraph.id === p.id
                      ? 'bg-purple-600/15 border-purple-500 text-white shadow-md shadow-purple-500/5'
                      : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
                  }`}
                >
                  <div className="font-bold text-sm line-clamp-2 md:line-clamp-none">{p.title}</div>
                  <div className="text-[10px] opacity-80 mt-1 line-clamp-1">{p.text}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Reading Arena */}
          <div className="md:col-span-3 min-w-0 flex flex-col justify-between glass-panel rounded-2xl p-4 md:p-6 border-slate-800 space-y-4 md:space-y-6">
            <div className="flex justify-between items-center">
              <span className="text-xs font-medium text-purple-400 tracking-widest uppercase">Target Text</span>
              <button 
                onClick={speakParagraph}
                className="flex items-center space-x-1.5 px-3 py-2 md:py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs transition-colors"
                title="Listen to a model reading in American English"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>{isSpeaking ? 'Stop Sample' : 'Hear Sample'}</span>
              </button>
            </div>
            {speechNotice && <p className="text-xs text-amber-300">{speechNotice}</p>}
            
            <p className="text-lg text-white font-medium leading-relaxed tracking-wide py-4 border-y border-slate-850 px-1 md:px-2 select-none">
              {selectedParagraph.text}
            </p>

            {/* Recording controls: pinned to the bottom of the screen on phones (so the text
                stays readable while recording), inline on desktop */}
            <div className="
              sticky bottom-0 z-20 -mx-4 -mb-4 px-5 pt-3 pb-safe flex flex-row-reverse items-center justify-between bg-[#0a0f1a] border-t border-slate-800 rounded-b-2xl shadow-[0_-10px_30px_rgba(0,0,0,0.5)]
              md:static md:mx-0 md:mb-0 md:px-0 md:pt-2 md:flex-col md:justify-center md:space-y-3 md:bg-transparent md:border-0 md:rounded-none md:shadow-none
            ">
              <button
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerLeave}
                onClick={handleRecordClick}
                onContextMenu={(e) => e.preventDefault()}
                type="button"
                aria-label={isRecording ? `Recording in progress, ${recordingTime} seconds. Tap to stop` : 'Tap to record your reading'}
                style={{ touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitTapHighlightColor: 'transparent' }}
                className={`relative w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center transition-all duration-350 select-none shrink-0 ${
                  isRecording 
                    ? 'bg-red-500 text-white animate-record-pulse'
                    : 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/30 active:scale-95'
                }`}
              >
                <Mic className="w-6 h-6 md:w-8 md:h-8" />
              </button>
              
              <div className="text-left md:text-center flex-1 md:flex-none min-w-0">
                <span className="block text-sm font-semibold text-slate-300">
                  {isRecording ? `Recording... ${recordingTime}s` : 'Read Aloud'}
                </span>
                <span className="text-xs text-slate-500 block mt-0.5 max-w-[200px] md:max-w-none">
                  {isRecording 
                    ? (isToggleRecording ? 'Tap button to stop' : 'Release to submit') 
                    : 'Tap to start, tap again to finish'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading State */}
      {status === 'processing' && <SubmissionProgress progress={submission.progress} />}

      {/* Evaluated Score Card */}
      {status === 'graded' && (
        <div className="space-y-4">
          <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-xl">
            <span className="block text-xs text-indigo-400 font-semibold tracking-wider uppercase mb-1">Your Speech Transcript</span>
            <p className="text-sm italic text-white">"{transcript}"</p>
          </div>
          <ScoreCard
            mode="read_aloud"
            score={evaluation}
            onRestart={handleRestart}
            isSaving={isSaving}
            saveStatus={saveStatus}
            onSaveToLeaderboard={handleSaveToLeaderboard}
          />
        </div>
      )}

      {/* Error state */}
      {status === 'error' && (
        <div className="glass-panel p-4 md:p-6 rounded-xl border border-red-500/20 text-center space-y-4">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto text-red-500">
            <Mic className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="text-lg font-bold text-white">
              {submission.progress?.retryable ? 'Not finished yet' : 'Recording Failed'}
            </h4>
            <p className="text-sm text-rose-300">{errorMessage}</p>
            {submission.progress?.retryable && (
              <p className="text-xs text-slate-400">Your recording is saved. Tap Retry - you do not need to record again.</p>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {submission.progress?.retryable && submission.hasRecording() && (
              <button 
                onClick={handleRetry}
                className="px-5 py-2.5 md:py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-semibold transition cursor-pointer"
              >
                Retry
              </button>
            )}
            <button 
              onClick={handleRestart}
              className="px-5 py-2.5 md:py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-sm font-semibold transition cursor-pointer"
            >
              Record Again
            </button>
          </div>
        </div>
      )}
      
    </div>
  );
}
export default ModeReadAloud;
