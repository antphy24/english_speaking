import React, { useState, useEffect } from 'react';
import { useMediaRecorder } from '../hooks/useMediaRecorder';
import ScoreCard from './UI/ScoreCard';
import Spinner from './UI/Spinner';
import { Mic, MicOff, Info, HelpCircle } from 'lucide-react';
import { fetchWithRetry, parseError } from '../utils/api';

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

export function ModeQA({ studentName, apiBase, onSaveScore, customQuestions = [] }) {
  const questionsList = customQuestions && customQuestions.length > 0
    ? customQuestions.map((m, idx) => ({
        id: m.id,
        topic: m.title || `Custom Topic ${idx + 1}`,
        prompt: m.content
      }))
    : QUESTIONS;

  const [selectedQuestion, setSelectedQuestion] = useState(questionsList[0]);

  useEffect(() => {
    if (questionsList.length > 0) {
      setSelectedQuestion(questionsList[0]);
    }
  }, [customQuestions]);
  const [status, setStatus] = useState('idle'); // 'idle' | 'recording' | 'transcribing' | 'grading' | 'graded' | 'error'
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
  const [saveStatus, setSaveStatus] = useState('');

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
    setStatus('transcribing');
    try {
      // 1. Send audio blob to /transcribe with the correct file extension based on mimeType
      const extension = blob.type ? (blob.type.includes('mp4') ? 'mp4' : blob.type.includes('ogg') ? 'ogg' : blob.type.includes('wav') ? 'wav' : 'webm') : 'webm';
      const formData = new FormData();
      formData.append('file', blob, `recording.${extension}`);

      // 1. Send audio blob to /transcribe
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
        throw new Error("No speech was detected. Please try speaking again and check your microphone input.");
      }

      // 2. Send transcript + question to /grade
      setStatus('grading');
      const gradeRes = await fetchWithRetry(`${apiBase}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'qa',
          transcript: text,
          question: selectedQuestion.prompt
        })
      });

      if (!gradeRes.ok) {
        const errMsg = await parseError(gradeRes, 'Failed to grade your response.');
        throw new Error(errMsg);
      }

      const gradeData = await gradeRes.json();
      setEvaluation(gradeData);
      setStatus('graded');
    } catch (err) {
      console.error(err);
      setErrorMessage(err.message || 'An error occurred during evaluation.');
      setStatus('error');
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

  const handleRestart = () => {
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
      await onSaveScore('qa', evaluation);
      setSaveStatus('success');
    } catch (err) {
      setSaveStatus('error');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Informative banner */}
      <div className="flex items-start space-x-3 bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-xl">
        <Info className="w-5 h-5 text-indigo-400 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-indigo-200 leading-relaxed">
          <strong className="text-white block mb-0.5">Mode 2: IELTS Q&A Prompt</strong>
          Select a topic card below to view the topic prompt. Click the record button to start speaking, and click it again to finish. Gemini will grade your speaking against official IELTS band rubrics.
        </div>
      </div>

      {(status === 'idle' || status === 'recording') && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          
          {/* Topic selector */}
          <div className="md:col-span-1 space-y-3">
            <h4 className="text-xs font-semibold text-slate-400 uppercase tracking-wider">IELTS Topics</h4>
            <div className="flex flex-col space-y-2">
              {questionsList.map((q) => (
                <button
                  key={q.id}
                  disabled={isRecording}
                  onClick={() => setSelectedQuestion(q)}
                  className={`p-3 text-left rounded-xl border transition-all duration-200 ${
                    selectedQuestion.id === q.id
                      ? 'bg-purple-600/15 border-purple-500 text-white'
                      : 'bg-slate-900/40 border-slate-800 text-slate-400 hover:bg-slate-900/60 hover:text-slate-200'
                  } ${isRecording ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <div className="font-bold text-sm">{q.topic}</div>
                  <div className="text-[10px] opacity-75 mt-0.5">IELTS Speaking Prompt</div>
                </button>
              ))}
            </div>
          </div>

          {/* Prompt Detail Arena */}
          <div className="md:col-span-3 flex flex-col justify-between glass-panel rounded-2xl p-6 border-slate-800 space-y-6">
            <div className="flex items-center space-x-2 text-xs font-medium text-purple-400 tracking-widest uppercase">
              <HelpCircle className="w-4 h-4" />
              <span>Prompt Card</span>
            </div>
            
            <p className="text-lg text-slate-100 font-medium leading-relaxed py-4 border-y border-slate-850 px-2">
              {selectedQuestion.prompt}
            </p>

            {/* Toggle-to-record Button Area */}
            <div className="flex flex-col items-center justify-center space-y-3 pt-2">
              <button
                onClick={handleToggleRecord}
                className={`relative w-20 h-20 rounded-full flex items-center justify-center transition-all duration-300 ${
                  isRecording 
                    ? 'bg-red-500 text-white animate-record-pulse glow-purple-lg'
                    : 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/30'
                }`}
              >
                {isRecording ? <MicOff className="w-8 h-8" /> : <Mic className="w-8 h-8" />}
              </button>
              
              <div className="text-center">
                <span className="block text-sm font-semibold text-slate-300">
                  {isRecording ? `Recording in progress: ${recordingTime}s` : 'Start Assessment'}
                </span>
                <span className="text-xs text-slate-500">
                  {isRecording ? 'Click button again to complete recording' : 'Click to start recording your response'}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Loading states */}
      {status === 'transcribing' && <Spinner message="Whisper-large-v3 is transcribing your speech..." />}
      {status === 'grading' && (
        <div className="space-y-4">
          <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-xl">
            <span className="block text-xs text-indigo-400 font-semibold tracking-wider uppercase mb-1">Whisper Speech Transcript</span>
            <p className="text-sm italic text-slate-300">"{transcript}"</p>
          </div>
          <Spinner message="IELTS Examiner (Gemini) is analyzing lexical range, grammar, and pronunciation..." />
        </div>
      )}

      {/* Evaluated Score Card */}
      {status === 'graded' && (
        <div className="space-y-4">
          <div className="p-4 bg-slate-900/40 border border-slate-800 rounded-xl">
            <span className="block text-xs text-indigo-400 font-semibold tracking-wider uppercase mb-1">Transcribed Response</span>
            <p className="text-sm italic text-slate-300">"{transcript}"</p>
          </div>
          <ScoreCard
            mode="qa"
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
        <div className="glass-panel p-6 rounded-xl border border-red-500/20 text-center space-y-4 animate-fadeIn">
          <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto text-red-500">
            <MicOff className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="text-lg font-bold text-white">Assessment Interrupted</h4>
            <p className="text-sm text-rose-300">{errorMessage}</p>
          </div>
          <button 
            onClick={handleRestart}
            className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-sm font-semibold transition"
          >
            Try Again
          </button>
        </div>
      )}

    </div>
  );
}
export default ModeQA;
