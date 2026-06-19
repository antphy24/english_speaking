import React, { useState, useEffect, useRef } from 'react';
import { useMediaRecorder } from '../hooks/useMediaRecorder';
import ScoreCard from './UI/ScoreCard';
import Spinner from './UI/Spinner';
import { Mic, Info, RefreshCw, Volume2 } from 'lucide-react';
import { fetchWithRetry, parseError } from '../utils/api';

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

export function ModeReadAloud({ studentName, apiBase, onSaveScore, customParagraphs = [] }) {
  const paragraphsList = customParagraphs && customParagraphs.length > 0
    ? customParagraphs.map((m, idx) => ({
        id: m.id,
        title: m.title || `Custom Paragraph ${idx + 1}`,
        text: m.content
      }))
    : PARAGRAPHS;

  const [selectedParagraph, setSelectedParagraph] = useState(paragraphsList[0]);

  useEffect(() => {
    if (paragraphsList.length > 0) {
      setSelectedParagraph(paragraphsList[0]);
    }
  }, [customParagraphs]);

  const [status, setStatus] = useState('idle'); // 'idle' | 'transcribing' | 'grading' | 'graded' | 'error'
  const [errorMessage, setErrorMessage] = useState('');
  const [transcript, setTranscript] = useState('');
  const [evaluation, setEvaluation] = useState(null);

  const pointerDownTimeRef = useRef(0);
  const [isToggleRecording, setIsToggleRecording] = useState(false);

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

  // Auto-save score when grading completes
  useEffect(() => {
    if (status === 'graded' && evaluation) {
      handleSaveToLeaderboard();
    }
  }, [status, evaluation]);


  // Handle when audio is recorded
  useEffect(() => {
    if (audioBlob) {
      processAudio(audioBlob);
    }
  }, [audioBlob]);

  const processAudio = async (blob) => {
    if (blob.size < 2000) {
      setErrorMessage("Recording was too short. Please hold down the button and speak clearly.");
      setStatus('error');
      return;
    }
    setStatus('transcribing');
    try {
      // 1. Send audio blob to /transcribe with the correct file extension based on mimeType
      const extension = blob.type ? (blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : blob.type.includes('wav') ? 'wav' : 'webm') : 'webm';
      const formData = new FormData();
      formData.append('file', blob, `recording.${extension}`);

      const transcribeRes = await fetchWithRetry(`${apiBase}/transcribe`, {
        method: 'POST',
        body: formData,
      });

      if (!transcribeRes.ok) {
        const errMsg = await parseError(transcribeRes, 'Failed to transcribe audio.');
        throw new Error(errMsg);
      }

      const { text } = await transcribeRes.json();
      setTranscript(text);

      if (!text || text.trim().length === 0) {
        throw new Error("No speech was detected. Make sure your microphone is working and speak clearly.");
      }

      // 2. Send transcript + original text to /grade
      setStatus('grading');
      const gradeRes = await fetchWithRetry(`${apiBase}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'read_aloud',
          transcript: text,
          source_text: selectedParagraph.text
        })
      });

      if (!gradeRes.ok) {
        const errMsg = await parseError(gradeRes, 'Failed to evaluate reading.');
        throw new Error(errMsg);
      }

      const gradeData = await gradeRes.json();
      setEvaluation(gradeData);
      setStatus('graded');
    } catch (err) {
      console.error(err);
      setErrorMessage(err.message || 'An error occurred during speech evaluation.');
      setStatus('error');
    }
  };

  const handleRetryGrading = async () => {
    if (!transcript) return;
    setStatus('grading');
    setErrorMessage('');
    try {
      const gradeRes = await fetchWithRetry(`${apiBase}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'read_aloud',
          transcript: transcript,
          source_text: selectedParagraph.text
        })
      });

      if (!gradeRes.ok) {
        const errMsg = await parseError(gradeRes, 'Failed to evaluate reading.');
        throw new Error(errMsg);
      }

      const gradeData = await gradeRes.json();
      setEvaluation(gradeData);
      setStatus('graded');
    } catch (err) {
      console.error(err);
      setErrorMessage(err.message || 'An error occurred during speech evaluation.');
      setStatus('error');
    }
  };

  const handleRestart = () => {
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
      await onSaveScore('read_aloud', evaluation);
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

      {/* Loading States */}
      {status === 'transcribing' && <Spinner message="Sending audio to Whisper for transcription..." />}
      {status === 'grading' && (
        <div className="space-y-4">
          <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-xl">
            <span className="block text-xs text-indigo-400 font-semibold tracking-wider uppercase mb-1">Whisper Transcript</span>
            <p className="text-sm italic text-white">"{transcript}"</p>
          </div>
          <Spinner message="Comparing transcript to source and grading with Gemini..." />
        </div>
      )}

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
            <h4 className="text-lg font-bold text-white">Recording Failed</h4>
            <p className="text-sm text-rose-300">{errorMessage}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {audioBlob && transcript && (
              <button 
                onClick={handleRetryGrading}
                className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-semibold transition cursor-pointer"
              >
                Retry Evaluation
              </button>
            )}
            {audioBlob && (
              <button 
                onClick={() => processAudio(audioBlob)}
                className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition cursor-pointer"
              >
                {transcript ? 'Retry Full Upload' : 'Retry Upload'}
              </button>
            )}
            <button 
              onClick={handleRestart}
              className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-sm font-semibold transition cursor-pointer"
            >
              {audioBlob ? 'Record Again' : 'Try Again'}
            </button>
          </div>
        </div>
      )}
      
    </div>
  );
}
export default ModeReadAloud;
