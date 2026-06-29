import React, { useState, useRef, useEffect } from 'react';
import { Play, Square, Loader2, Save, Mic, ShieldAlert, CheckCircle2, ChevronRight, XCircle, BrainCircuit, Users, Target, FileText, ArrowRight, Clock } from 'lucide-react';
import Spinner from './UI/Spinner';

const DEFAULT_MOTIONS = [
  "This House would ban the use of AI in educational assessments.",
  "This House believes that developing nations should prioritize economic growth over environmental protection.",
  "This House would implement a 4-day work week.",
  "This House regrets the rise of cancel culture."
];

export default function ModeDebate({ studentName, apiBase, onSaveScore, isSaving, saveStatus, customMotions = [] }) {
  const [step, setStep] = useState('setup'); // setup -> case_building -> recording -> grading -> results
  
  const [motion, setMotion] = useState('');
  const [role, setRole] = useState('Affirmative');
  const [scratchpad, setScratchpad] = useState('');
  
  const [timer, setTimer] = useState(900); // 15 mins for case building, 435s for speech
  
  const [isRecording, setIsRecording] = useState(false);
  const [recordingTime, setRecordingTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState(null);
  
  const [resultData, setResultData] = useState(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const timerIntervalRef = useRef(null);
  const recordingIntervalRef = useRef(null);

  const availableMotions = customMotions.length > 0 ? customMotions.map(m => m.content) : DEFAULT_MOTIONS;

  useEffect(() => {
    return () => {
      clearInterval(timerIntervalRef.current);
      clearInterval(recordingIntervalRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state === 'recording') {
        mediaRecorderRef.current.stop();
      }
    };
  }, []);

  const handleStartCaseBuilding = () => {
    if (!motion) {
      alert("Please select or type a motion first.");
      return;
    }
    setStep('case_building');
    setTimer(900); // 15 mins
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
    setTimer(435); // 7 mins 15 seconds
  };

  const handleStartRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });
        const audioUrl = URL.createObjectURL(audioBlob);
        setAudioUrl(audioUrl);
        handleProcessSpeech(audioBlob);
      };

      mediaRecorder.start();
      setIsRecording(true);
      setRecordingTime(0);
      startTimer(); // Start countdown timer
      
      recordingIntervalRef.current = setInterval(() => {
        setRecordingTime((prev) => prev + 1);
      }, 1000);

    } catch (error) {
      console.error("Error accessing microphone:", error);
      alert("Microphone access is required for practice modes.");
    }
  };

  const handleStopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
      clearInterval(recordingIntervalRef.current);
      clearInterval(timerIntervalRef.current);
      mediaRecorderRef.current.stream.getTracks().forEach(track => track.stop());
    }
  };

  const handleProcessSpeech = async (audioBlob) => {
    setIsProcessing(true);
    setStep('grading');
    try {
      // 1. Transcribe
      const formData = new FormData();
      formData.append('file', audioBlob, 'debate_recording.webm');
      
      const transcribeRes = await fetch(`${apiBase}/transcribe`, {
        method: 'POST',
        body: formData
      });
      if (!transcribeRes.ok) throw new Error("Transcription failed");
      const { text: transcript } = await transcribeRes.json();

      // 2. Grade
      const gradeRes = await fetch(`${apiBase}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'debate',
          transcript,
          motion,
          role
        })
      });
      if (!gradeRes.ok) throw new Error("Grading failed");
      const evalData = await gradeRes.json();
      
      // Calculate overall score (Matter 40%, Manner 40%, Method 20%)
      const finalScore = (evalData.matter_score * 4) + (evalData.manner_score * 4) + (evalData.method_score * 2);
      
      setResultData({
        ...evalData,
        transcript,
        finalScore
      });
      setStep('results');
    } catch (err) {
      console.error(err);
      alert("Error processing your speech. Please try again.");
      setStep('recording'); // allow retry
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSaveToLeaderboard = () => {
    if (resultData) {
      onSaveScore('debate', {
        ...resultData,
        motion,
        role
      });
    }
  };

  const handleReset = () => {
    setStep('setup');
    setMotion('');
    setScratchpad('');
    setAudioUrl(null);
    setResultData(null);
  };

  const formatTime = (seconds) => {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  // ---------------- Render Helpers ----------------

  if (step === 'setup') {
    return (
      <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 md:p-8 animate-fadeIn shadow-2xl">
        <div className="flex items-center space-x-3 mb-6">
          <div className="p-3 bg-indigo-500/10 text-indigo-400 rounded-xl border border-indigo-500/20">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <h3 className="text-xl font-bold text-white">Debate Setup</h3>
            <p className="text-sm text-slate-400">Select your motion and role before building your case.</p>
          </div>
        </div>

        <div className="space-y-6">
          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Select Motion</label>
            <select
              value={motion}
              onChange={(e) => setMotion(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 text-slate-200 rounded-xl p-3 focus:outline-none focus:border-indigo-500/50 transition-colors"
            >
              <option value="" disabled>-- Choose a motion --</option>
              {availableMotions.map((m, i) => (
                <option key={i} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-slate-300 mb-2">Select Role</label>
            <div className="flex space-x-4">
              <button
                onClick={() => setRole('Affirmative')}
                className={`flex-1 py-3 px-4 rounded-xl font-bold text-sm transition-all border ${
                  role === 'Affirmative' 
                    ? 'bg-indigo-600/20 border-indigo-500 text-indigo-300' 
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                Affirmative (Gov)
              </button>
              <button
                onClick={() => setRole('Negative')}
                className={`flex-1 py-3 px-4 rounded-xl font-bold text-sm transition-all border ${
                  role === 'Negative' 
                    ? 'bg-rose-600/20 border-rose-500 text-rose-300' 
                    : 'bg-slate-900 border-slate-800 text-slate-400 hover:bg-slate-800'
                }`}
              >
                Negative (Opp)
              </button>
            </div>
          </div>

          <div className="pt-4">
            <button
              onClick={handleStartCaseBuilding}
              disabled={!motion}
              className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-3.5 px-4 rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2 shadow-lg shadow-indigo-900/20"
            >
              <span>Start Case Building</span>
              <ArrowRight className="w-5 h-5" />
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'case_building') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-6 shadow-xl">
            <div className="flex items-center space-x-3 mb-4">
              <Clock className="w-5 h-5 text-indigo-400" />
              <h3 className="font-bold text-white">Case Building Time</h3>
            </div>
            <div className="text-4xl font-mono font-bold text-center text-indigo-300 tracking-wider mb-6 bg-slate-950 py-4 rounded-xl border border-slate-800">
              {formatTime(timer)}
            </div>
            <div className="mb-4">
              <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Motion</span>
              <p className="text-sm font-medium text-slate-200 mt-1">{motion}</p>
            </div>
            <div className="mb-6">
              <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Role</span>
              <p className={`text-sm font-bold mt-1 ${role === 'Affirmative' ? 'text-indigo-400' : 'text-rose-400'}`}>
                {role}
              </p>
            </div>
            <button
              onClick={handleSkipToSpeech}
              className="w-full bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 font-bold py-3 px-4 rounded-xl transition-colors flex items-center justify-center space-x-2"
            >
              <span>Ready? Start Speech</span>
              <Mic className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl h-full flex flex-col">
            <div className="flex items-center space-x-3 mb-4">
              <FileText className="w-5 h-5 text-slate-400" />
              <h3 className="font-bold text-white">Scratchpad</h3>
            </div>
            <textarea
              value={scratchpad}
              onChange={(e) => setScratchpad(e.target.value)}
              placeholder="Outline your AEL structure here. (Assertion, Explanation, Link-back). This will remain visible during your speech..."
              className="flex-1 w-full bg-slate-950 border border-slate-800 text-slate-300 rounded-xl p-4 focus:outline-none focus:border-indigo-500/50 resize-none font-mono text-sm leading-relaxed"
            />
          </div>
        </div>
      </div>
    );
  }

  if (step === 'recording') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-fadeIn">
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-6 shadow-xl text-center">
            <h3 className="font-bold text-white mb-2">Speech Delivery</h3>
            <p className="text-xs text-slate-400 mb-6">Standard speech time is 7:15. Speak clearly.</p>
            
            <div className="text-4xl font-mono font-bold text-center text-slate-200 tracking-wider mb-6 bg-slate-950 py-4 rounded-xl border border-slate-800 relative overflow-hidden">
              <div className={`absolute top-0 left-0 h-1 bg-indigo-500 transition-all duration-1000 ${isRecording ? 'w-full' : 'w-0'}`} style={{ animationDuration: '435s' }}></div>
              {formatTime(timer)}
            </div>

            {!isRecording ? (
              <button
                onClick={handleStartRecording}
                className="w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 px-4 rounded-xl transition-all transform hover:scale-105 flex justify-center items-center space-x-3 shadow-lg shadow-indigo-900/20"
              >
                <Mic className="w-5 h-5" />
                <span>Record Speech</span>
              </button>
            ) : (
              <button
                onClick={handleStopRecording}
                className="w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-4 px-4 rounded-xl transition-all transform hover:scale-105 flex justify-center items-center space-x-3 animate-pulse shadow-lg shadow-rose-900/20"
              >
                <Square className="w-5 h-5 fill-current" />
                <span>Stop Recording</span>
              </button>
            )}
            
            {isRecording && (
               <div className="mt-4 text-xs text-rose-400 flex items-center justify-center space-x-2">
                 <div className="w-2 h-2 rounded-full bg-rose-500 animate-ping"></div>
                 <span>Recording in progress ({formatTime(recordingTime)})</span>
               </div>
            )}
          </div>

          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-5">
              <span className="text-[10px] text-slate-500 uppercase font-bold tracking-wider">Reminder</span>
              <p className="text-xs text-slate-400 mt-2 leading-relaxed">
                The AI strictly grades based on: <br/>
                1. <strong>Matter (40%)</strong>: Logic, structure, depth.<br/>
                2. <strong>Manner (40%)</strong>: Fluency, vocabulary, delivery.<br/>
                3. <strong>Method (20%)</strong>: Signposting, time management.
              </p>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl p-6 shadow-xl h-full flex flex-col">
            <div className="flex items-center space-x-3 mb-4">
              <FileText className="w-5 h-5 text-slate-400" />
              <h3 className="font-bold text-white">Your Notes</h3>
            </div>
            <div className="flex-1 w-full bg-slate-950 border border-slate-800 text-slate-400 rounded-xl p-4 font-mono text-sm leading-relaxed overflow-y-auto whitespace-pre-wrap">
              {scratchpad || "No notes taken during case building."}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (step === 'grading') {
    return (
      <div className="flex flex-col items-center justify-center py-20 animate-fadeIn">
        <div className="w-20 h-20 bg-indigo-500/10 rounded-full flex items-center justify-center mb-6 border border-indigo-500/20 relative">
           <div className="absolute inset-0 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin"></div>
           <BrainCircuit className="w-8 h-8 text-indigo-400" />
        </div>
        <h3 className="text-xl font-bold text-white mb-2">Analyzing your speech...</h3>
        <p className="text-slate-400 text-sm max-w-md text-center">
          Whisper is transcribing the audio and Gemini 2.5 is adjudicating your speech based on strict matter, manner, and method rubrics. This may take a minute.
        </p>
      </div>
    );
  }

  if (step === 'results' && resultData) {
    return (
      <div className="space-y-8 animate-fadeIn pb-10">
        
        {/* Score Banner */}
        <div className="bg-gradient-to-r from-indigo-900/40 to-slate-900/80 backdrop-blur-xl border border-indigo-500/20 rounded-3xl p-8 relative overflow-hidden flex flex-col md:flex-row items-center md:items-stretch justify-between shadow-2xl">
           <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-[80px] pointer-events-none"></div>
           
           <div className="flex-1 w-full text-center md:text-left z-10">
             <div className="inline-block px-3 py-1 bg-indigo-500/20 text-indigo-300 text-[10px] font-bold uppercase tracking-wider rounded-lg border border-indigo-500/20 mb-4">
               Debate Adjudication
             </div>
             <h3 className="text-3xl font-extrabold text-white mb-2 tracking-tight">Final Verdict</h3>
             <p className="text-sm text-indigo-200/80 mb-6 max-w-lg leading-relaxed">
               Your speech has been rigorously evaluated based on conventional debate standards.
             </p>
             
             {audioUrl && (
                <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/50 inline-block">
                  <audio controls src={audioUrl} className="h-8 grayscale contrast-125" />
                </div>
             )}
           </div>

           <div className="mt-8 md:mt-0 flex flex-col items-center justify-center px-10 bg-slate-950/40 rounded-2xl border border-slate-800/50 z-10 min-w-[200px]">
             <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider mb-2">Overall Score</span>
             <div className="text-6xl font-black text-transparent bg-clip-text bg-gradient-to-b from-white to-indigo-400 drop-shadow-sm">
               {resultData.finalScore}
             </div>
             <span className="text-sm text-slate-400 font-medium mt-1">out of 100</span>
           </div>
        </div>

        {/* Detailed Rubric Breakdown */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
           {/* Matter */}
           <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 flex flex-col hover:border-blue-500/30 transition-colors">
              <div className="flex justify-between items-start mb-4">
                 <div>
                   <h4 className="font-bold text-white">Matter</h4>
                   <span className="text-[10px] text-slate-500 font-mono tracking-wider">SUBSTANCE (40%)</span>
                 </div>
                 <div className="px-3 py-1 bg-blue-500/10 text-blue-400 font-bold rounded-lg border border-blue-500/20 text-lg">
                   {resultData.matter_score}/10
                 </div>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed flex-1">
                {resultData.matter_feedback}
              </p>
           </div>
           
           {/* Manner */}
           <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 flex flex-col hover:border-purple-500/30 transition-colors">
              <div className="flex justify-between items-start mb-4">
                 <div>
                   <h4 className="font-bold text-white">Manner</h4>
                   <span className="text-[10px] text-slate-500 font-mono tracking-wider">DELIVERY (40%)</span>
                 </div>
                 <div className="px-3 py-1 bg-purple-500/10 text-purple-400 font-bold rounded-lg border border-purple-500/20 text-lg">
                   {resultData.manner_score}/10
                 </div>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed flex-1">
                {resultData.manner_feedback}
              </p>
           </div>

           {/* Method */}
           <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-6 flex flex-col hover:border-emerald-500/30 transition-colors">
              <div className="flex justify-between items-start mb-4">
                 <div>
                   <h4 className="font-bold text-white">Method</h4>
                   <span className="text-[10px] text-slate-500 font-mono tracking-wider">STRUCTURE (20%)</span>
                 </div>
                 <div className="px-3 py-1 bg-emerald-500/10 text-emerald-400 font-bold rounded-lg border border-emerald-500/20 text-lg">
                   {resultData.method_score}/10
                 </div>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed flex-1">
                {resultData.method_feedback}
              </p>
           </div>
        </div>

        {/* Overall Summary & Transcript */}
        <div className="bg-slate-900/50 border border-slate-800 rounded-2xl overflow-hidden">
           <div className="p-6 border-b border-slate-800 bg-slate-900/80">
             <h4 className="font-bold text-white mb-3">Overall Adjudicator Feedback</h4>
             <p className="text-sm text-indigo-200/90 leading-relaxed">
               {resultData.overall_feedback}
             </p>
           </div>
           <div className="p-6">
             <h4 className="font-bold text-white mb-3 flex items-center space-x-2">
               <Target className="w-4 h-4 text-slate-400" />
               <span>Speech Transcript</span>
             </h4>
             <p className="text-sm text-slate-400 font-mono leading-loose bg-slate-950/50 p-4 rounded-xl border border-slate-800/50 whitespace-pre-wrap">
               {resultData.transcript}
             </p>
           </div>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row justify-end space-y-3 sm:space-y-0 sm:space-x-4 pt-4 border-t border-slate-800">
           <button
             onClick={handleReset}
             className="px-6 py-3 bg-slate-800 hover:bg-slate-700 text-white font-bold rounded-xl transition-colors text-sm"
           >
             Start New Debate
           </button>
           <button
             onClick={handleSaveToLeaderboard}
             disabled={isSaving || saveStatus === 'success'}
             className={`px-6 py-3 rounded-xl font-bold flex justify-center items-center space-x-2 transition-all text-sm ${
               saveStatus === 'success'
                 ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                 : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-900/20'
             }`}
           >
             {isSaving && <Loader2 className="w-4 h-4 animate-spin" />}
             {saveStatus === 'success' && <CheckCircle2 className="w-4 h-4" />}
             {!isSaving && saveStatus !== 'success' && <Save className="w-4 h-4" />}
             <span>
               {isSaving ? 'Saving...' : saveStatus === 'success' ? 'Saved to Leaderboard' : 'Log Score to Leaderboard'}
             </span>
           </button>
        </div>
      </div>
    );
  }

  return null;
}
