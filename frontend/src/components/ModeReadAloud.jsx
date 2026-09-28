import React, { useState, useEffect, useRef } from 'react';
import { useMediaRecorder } from '../hooks/useMediaRecorder';
import ScoreCard from './UI/ScoreCard';
import Spinner from './UI/Spinner';
import { Mic, Info, RefreshCw, Volume2 } from 'lucide-react';
import useSubmission from '../hooks/useSubmission';
import SubmissionProgress from './UI/SubmissionProgress';

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

  const handlePointerDown = (e) => {
    e.preventDefault();
    pointerDownTimeRef.current = Date.now();
    if (!isRecording) {
      startRecording();
      setIsToggleRecording(false);
    }
  };

  const handlePointerUp = (e) => {
    e.preventDefault();
    const duration = Date.now() - pointerDownTimeRef.current;
    if (duration < 300) {
      // It's a short tap!
      if (isToggleRecording) {
        stopRecording();
        setIsToggleRecording(false);
      } else {
        setIsToggleRecording(true);
      }
    } else {
      // It's a long hold! Stop recording on release
      stopRecording();
      setIsToggleRecording(false);
    }
  };

  const handlePointerLeave = () => {
    if (isRecording && !isToggleRecording) {
      stopRecording();
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
      setErrorMessage("Recording was too short. Please hold down the button and speak clearly.");
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

  // Browser TTS to read paragraph to the student
  const speakParagraph = () => {
    if ('speechSynthesis' in window) {
      // Cancel active speaking
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(selectedParagraph.text);
      utterance.rate = 0.9; // Slightly slower for clear instruction
      window.speechSynthesis.speak(utterance);
    } else {
      alert("Text-to-speech not supported in this browser.");
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Intro info */}
      <div className="flex items-start space-x-3 bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-xl">
        <Info className="w-5 h-5 text-indigo-400 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-indigo-200 leading-relaxed">
          <strong className="text-white block mb-0.5">Mode 1: Read Aloud Assessment</strong>
          Select a text paragraph, review it, then hold down the microphone button to read it aloud. Releasing the button will transcribe and automatically grade your pronunciation and accuracy.
        </div>
      </div>

      {status === 'idle' && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {/* Paragraph selector */}
          <div className="md:col-span-1 space-y-3">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Select Paragraph</h4>
            <div className="flex flex-col space-y-2">
              {paragraphsList.map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSelectedParagraph(p)}
                  className={`p-3 text-left rounded-xl border transition-all duration-200 ${
                    selectedParagraph.id === p.id
                      ? 'bg-purple-600/15 border-purple-500 text-white shadow-md shadow-purple-500/5'
                      : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
                  }`}
                >
                  <div className="font-bold text-sm">{p.title}</div>
                  <div className="text-[10px] opacity-80 mt-1 line-clamp-1">{p.text}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Reading Arena */}
          <div className="md:col-span-3 flex flex-col justify-between glass-panel rounded-2xl p-6 pb-28 md:pb-6 border-slate-800 space-y-6">
            <div className="flex justify-between items-center">
              <span className="text-xs font-medium text-purple-400 tracking-widest uppercase">Target Text</span>
              <button 
                onClick={speakParagraph}
                className="flex items-center space-x-1 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-xs transition-colors"
                title="Listen to native model reading"
              >
                <Volume2 className="w-3.5 h-3.5" />
                <span>Hear Sample</span>
              </button>
            </div>
            
            <p className="text-lg text-white font-medium leading-relaxed tracking-wide py-4 border-y border-slate-850 px-2 select-none">
              {selectedParagraph.text}
            </p>

            {/* Adaptive Recording Controls (Inline on Desktop, Sticky Bottom Bar on Mobile) */}
            <div className="
              flex flex-col items-center justify-center space-y-3 pt-2
              md:relative md:bg-transparent md:border-0 md:p-0 md:shadow-none md:flex-col md:space-y-3 md:gap-0
              max-md:fixed max-md:bottom-0 max-md:left-0 max-md:right-0 max-md:bg-[#070b13]/95 max-md:backdrop-blur-md max-md:border-t max-md:border-slate-900 max-md:p-4 max-md:pb-6 max-md:shadow-[0_-10px_30px_rgba(0,0,0,0.5)] max-md:z-40 max-md:flex-row-reverse max-md:justify-between max-md:space-y-0 max-md:px-6
            ">
              <button
                onPointerDown={handlePointerDown}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerLeave}
                onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handlePointerDown(); } }}
                onKeyUp={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); handlePointerUp(); } }}
                aria-label={isRecording ? `Recording in progress, ${recordingTime} seconds` : 'Hold to record your reading'}
                role="button"
                tabIndex={0}
                className={`relative w-16 h-16 md:w-20 md:h-20 rounded-full flex items-center justify-center transition-all duration-350 select-none shrink-0 ${
                  isRecording 
                    ? 'bg-red-500 text-white animate-record-pulse'
                    : 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/30 active:scale-95'
                }`}
              >
                <Mic className="w-6 h-6 md:w-8 md:h-8" />
              </button>
              
              <div className="text-left md:text-center max-md:flex-1">
                <span className="block text-sm font-semibold text-slate-300">
                  {isRecording ? `Recording... ${recordingTime}s` : 'Read Aloud'}
                </span>
                <span className="text-xs text-slate-500 block mt-0.5 max-w-[200px] md:max-w-none">
                  {isRecording 
                    ? (isToggleRecording ? 'Tap button to stop' : 'Release to submit') 
                    : 'Tap to toggle or hold to record'}
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
        <div className="glass-panel p-6 rounded-xl border border-red-500/20 text-center space-y-4">
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
                className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-semibold transition cursor-pointer"
              >
                Retry
              </button>
            )}
            <button 
              onClick={handleRestart}
              className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-sm font-semibold transition cursor-pointer"
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
