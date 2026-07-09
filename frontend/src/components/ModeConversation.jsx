import React, { useState, useEffect, useRef } from 'react';
import { useMediaRecorder } from '../hooks/useMediaRecorder';
import ScoreCard from './UI/ScoreCard';
import Spinner from './UI/Spinner';
import { useConfirm } from './UI/ConfirmModal';
import { Mic, MicOff, Info, Send, Volume2, VolumeX, User, Bot, AlertTriangle } from 'lucide-react';
import { fetchWithRetry, parseError } from '../utils/api';

const DEFAULT_GREETINGS = [
  { id: 'def-1', title: "General Chat", content: "Hello {studentName}! I am your AI English conversation partner. What is a topic you would like to chat about today? Or we can talk about your hobbies!" },
  { id: 'def-2', title: "Job Interview Practice", content: "Hello {studentName}! I will be acting as your hiring manager today. To start, please introduce yourself and tell me about your background." },
  { id: 'def-3', title: "Travel & Tourism", content: "Hi {studentName}! Imagine we just met at a hostel in Tokyo. What brings you to Japan?" }
];

export function ModeConversation({ studentName, apiBase, onSaveScore, customGreetings = [] }) {
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
  const [evaluation, setEvaluation] = useState(null);
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [errorType, setErrorType] = useState(null); // null | 'turn' | 'grading'
  
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
      handleSaveToLeaderboardRef.current?.();
    }
  }, [status, evaluation]);

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
    if (!ttsEnabled || !('speechSynthesis' in window)) return;
    
    // Stop any current speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Load voices
    const voices = window.speechSynthesis.getVoices();
    // Prefer Google English voices, otherwise standard English
    const preferredVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Google') || v.name.includes('Natural'))) 
                         || voices.find(v => v.lang.startsWith('en'));
    
    if (preferredVoice) {
      utterance.voice = preferredVoice;
    }
    
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    
    window.speechSynthesis.speak(utterance);
  };

  const processAudio = async (blob) => {
    if (blob.size < 2000) {
      setErrorMessage("Recording was too short. Please speak clearly for at least 2 seconds.");
      setStatus('error');
      return;
    }
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

      if (!text || text.trim().length === 0) {
        throw new Error("No speech was detected. Please make sure your mic is working and try again.");
      }

      // 2. Append user message to history
      const updatedMessages = [...messages, { role: 'user', content: text }];
      setMessages(updatedMessages);

      // 3. Request Llama-3.3-70B response
      setStatus('bot_replying');
      const chatRes = await fetchWithRetry(`${apiBase}/chat_reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: updatedMessages })
      });

      if (!chatRes.ok) {
        const errMsg = await parseError(chatRes, 'Failed to get a response from Llama tutor.');
        throw new Error(errMsg);
      }

      const { reply } = await chatRes.json();
      setMessages([...updatedMessages, { role: 'assistant', content: reply }]);
      
      // 4. Speak response aloud
      speakText(reply);
      setStatus('idle');
    } catch (err) {
      console.error(err);
      setErrorMessage(err.message || 'An error occurred during dialogue.');
      setErrorType('turn');
      setStatus('error');
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

    setStatus('grading');
    try {
      const gradeRes = await fetchWithRetry(`${apiBase}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'conversation',
          messages: messages
        })
      });

      if (!gradeRes.ok) {
        const errMsg = await parseError(gradeRes, 'Failed to evaluate conversation.');
        throw new Error(errMsg);
      }

      const gradeData = await gradeRes.json();
      setEvaluation(gradeData);
      setStatus('graded');
    } catch (err) {
      console.error(err);
      setErrorMessage(err.message || 'An error occurred during evaluation.');
      setErrorType('grading');
      setStatus('error');
    }
  };

  const handleRestart = () => {
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
      await onSaveScore('conversation', { ...evaluation, material_title: selectedTopic.title });
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
      <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 md:p-8 animate-fadeIn shadow-2xl">
        <div className="flex items-center space-x-3 mb-6">
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-xl border border-indigo-500/20">
            <User className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Conversation Setup</h3>
            <p className="text-sm text-slate-400">Select a topic for your conversation practice.</p>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Select Topic</label>
            <select
              value={selectedTopic.id}
              onChange={(e) => {
                const topic = availableGreetings.find(g => g.id.toString() === e.target.value);
                if (topic) setSelectedTopic(topic);
              }}
              className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-xl p-3 focus:outline-none focus:border-indigo-500/50 transition-colors"
            >
              {availableGreetings.map((g) => (
                <option key={g.id} value={g.id}>{g.title}</option>
              ))}
            </select>
          </div>

          <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 text-sm text-slate-400">
            <strong className="text-indigo-400">Tutor's Opening:</strong><br />
            {selectedTopic.content.replace('{studentName}', studentName || 'there')}
          </div>

          <div className="pt-4">
            <button
              onClick={() => setStep('chatting')}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 px-4 rounded-xl transition-colors flex items-center justify-center space-x-2 shadow-lg shadow-indigo-900/20"
            >
              <span>Start Conversation</span>
              <Send className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      
      {/* Informative banner */}
      <div className="flex items-start space-x-3 bg-indigo-500/10 border border-indigo-500/20 p-4 rounded-xl">
        <Info className="w-5 h-5 text-indigo-400 mt-0.5 flex-shrink-0" />
        <div className="text-xs text-indigo-200 leading-relaxed flex-grow">
          <strong className="text-white block mb-0.5">Mode 3: Interactive Speaking Practice</strong>
          Click the record button to speak to the AI Tutor. The tutor will answer you audibly. We recommend holding <strong>3-5 speaking turns</strong> (currently at <strong>{studentTurnsCount}/5</strong>) before ending the conversation to receive your final grading report.
        </div>
        <button
          onClick={() => setTtsEnabled(!ttsEnabled)}
          className={`flex items-center space-x-1.5 px-3 py-1 rounded-lg text-xs font-semibold border transition ${
            ttsEnabled 
              ? 'bg-purple-600/25 border-purple-500/40 text-purple-300 hover:bg-purple-600/40' 
              : 'bg-slate-800 border-slate-700 text-slate-400 hover:bg-slate-700'
          }`}
          title="Toggle Text-to-Speech audio reading"
        >
          {ttsEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          <span>{ttsEnabled ? 'Speech ON' : 'Speech OFF'}</span>
        </button>
      </div>

      {status !== 'graded' && status !== 'error' && (
        <div className="flex flex-col h-[500px] glass-panel rounded-2xl border-slate-800 overflow-hidden shadow-2xl">
          
          {/* Chat Headers */}
          <div className="flex justify-between items-center bg-slate-900/60 px-6 py-4 border-b border-slate-850">
            <div className="flex items-center space-x-3">
              <div className="w-2.5 h-2.5 rounded-full bg-green-500 animate-pulse"></div>
              <div>
                <h4 className="text-sm font-bold text-white">English AI Conversation Partner</h4>
                <p className="text-[10px] text-slate-400">Llama-3.3-70B model</p>
              </div>
            </div>
            
            <div className="flex items-center space-x-4">
              <span className="text-xs font-medium text-slate-400 bg-slate-800/60 px-2.5 py-1 rounded-full border border-slate-750">
                Turns: {studentTurnsCount} / 5
              </span>
              
              <button
                onClick={handleEndConversation}
                disabled={status === 'bot_replying' || status === 'transcribing'}
                className="px-4 py-1.5 bg-gradient-to-r from-red-600 to-rose-600 hover:from-red-500 hover:to-rose-500 text-white text-xs font-bold rounded-lg shadow-md transition disabled:opacity-50"
              >
                End Conversation
              </button>
            </div>
          </div>

          {/* Messages Feed */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-900/10">
            {messages.map((msg, index) => (
              <div
                key={index}
                className={`flex items-start space-x-3 max-w-[85%] ${
                  msg.role === 'user' ? 'ml-auto flex-row-reverse space-x-reverse' : ''
                }`}
              >
                {/* Avatar */}
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs flex-shrink-0 font-bold border ${
                  msg.role === 'user' 
                    ? 'bg-purple-600/10 border-purple-500/20 text-purple-400' 
                    : 'bg-indigo-600/10 border-indigo-500/20 text-indigo-400'
                }`}>
                  {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>

                {/* Message Bubble */}
                <div className={`p-4 rounded-2xl text-sm leading-relaxed border ${
                  msg.role === 'user'
                    ? 'bg-purple-600/15 border-purple-500/20 text-white rounded-tr-none'
                    : 'bg-slate-900/60 border-slate-800 text-slate-200 rounded-tl-none'
                }`}>
                  <p>{msg.content}</p>
                  
                  {msg.role === 'assistant' && (
                    <button 
                      onClick={() => speakText(msg.content)}
                      className="mt-2 text-[10px] text-indigo-400 hover:text-indigo-300 font-semibold flex items-center space-x-1"
                    >
                      <Volume2 className="w-3 h-3" />
                      <span>Replay Audio</span>
                    </button>
                  )}
                </div>
              </div>
            ))}

            {/* Transcription State */}
            {status === 'transcribing' && (
              <div className="flex items-center space-x-2 text-xs text-slate-400 italic">
                <div className="flex space-x-1">
                  <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                  <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-1.5 h-1.5 bg-purple-500 rounded-full animate-bounce"></div>
                </div>
                <span>Tutor is transcribing your voice message...</span>
              </div>
            )}

            {/* Bot Replying State */}
            {status === 'bot_replying' && (
              <div className="flex items-center space-x-2 text-xs text-slate-400 italic">
                <div className="flex space-x-1">
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                  <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full animate-bounce"></div>
                </div>
                <span>Tutor is thinking of a response...</span>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>

          {/* Recording / Voice Panel footer */}
          <div className="p-4 bg-slate-900/80 border-t border-slate-850 flex flex-col items-center justify-center space-y-3">
            {isRecording ? (
              <div className="flex items-center space-x-1.5 h-8">
                {[...Array(6)].map((_, i) => (
                  <div 
                    key={i} 
                    className="w-1 bg-red-500 rounded-full animate-eq-bar"
                    style={{ 
                      height: '100%', 
                      animationDelay: `${i * 0.15}s`,
                      transformOrigin: 'bottom'
                    }}
                  />
                ))}
              </div>
            ) : null}

            <div className="flex items-center justify-center space-x-4 w-full">
              <button
                onClick={handleToggleRecord}
                disabled={status === 'bot_replying' || status === 'transcribing'}
                className={`w-16 h-16 rounded-full flex items-center justify-center transition shadow-lg ${
                  isRecording 
                    ? 'bg-red-500 text-white animate-record-pulse'
                    : 'bg-purple-600 hover:bg-purple-500 text-white hover:scale-105 active:scale-95 disabled:opacity-50'
                }`}
              >
                {isRecording ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </button>
            </div>

            <span className="text-xs text-slate-400 font-medium select-none">
              {isRecording ? `Recording... Click to send (${recordingTime}s)` : 'Click to Speak'}
            </span>
          </div>

        </div>
      )}

      {/* Evaluation Loading Screen */}
      {status === 'grading' && <Spinner message="Gemini is analyzing the dialogue history and grading your conversational abilities..." />}

      {/* Evaluated Score Card */}
      {status === 'graded' && (
        <div className="space-y-4">
          <ScoreCard
            mode="conversation"
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
            <AlertTriangle className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h4 className="text-lg font-bold text-white">
              {errorType === 'grading' ? 'Evaluation Failed' : 'Dialogue Interrupted'}
            </h4>
            <p className="text-sm text-rose-300">{errorMessage}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {errorType === 'grading' && (
              <>
                <button 
                  onClick={handleEndConversation}
                  className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-semibold transition cursor-pointer"
                >
                  Retry Evaluation
                </button>
                <button 
                  onClick={() => { setStatus('idle'); setErrorType(null); }}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition cursor-pointer"
                >
                  Return to Chat
                </button>
              </>
            )}
            {errorType === 'turn' && (
              <>
                {audioBlob && (
                  <button 
                    onClick={() => processAudio(audioBlob)}
                    className="px-5 py-2 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-semibold transition cursor-pointer"
                  >
                    Retry Sending Message
                  </button>
                )}
                <button 
                  onClick={() => { setStatus('idle'); setErrorType(null); clearAudio(); }}
                  className="px-5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition cursor-pointer"
                >
                  Record Message Again
                </button>
              </>
            )}
            <button 
              onClick={handleRestart}
              className="px-5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-sm font-semibold transition cursor-pointer"
            >
              Reset Entire Chat
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
export default ModeConversation;
