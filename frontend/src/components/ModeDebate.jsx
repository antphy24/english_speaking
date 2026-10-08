import React, { useState, useRef, useEffect } from 'react';
import { Play, Square, Loader2, Save, Mic, ShieldAlert, CheckCircle2, ChevronRight, XCircle, BrainCircuit, Users, Target, FileText, ArrowRight, Clock, AlertTriangle } from 'lucide-react';
import Spinner from './UI/Spinner';
import useSubmission from '../hooks/useSubmission';
import { saveSubmissionOnServer } from '../utils/api';
import SubmissionProgress from './UI/SubmissionProgress';
import PinnedBar from './UI/PinnedBar';
import { useMediaRecorder } from '../hooks/useMediaRecorder';

const DEFAULT_MOTIONS = [
  "This House would ban the use of AI in educational assessments.",
  "This House believes that developing nations should prioritize economic growth over environmental protection.",
  "This House would implement a 4-day work week.",
  "This House regrets the rise of cancel culture."
];

export default function ModeDebate({ studentName, apiBase, onSaveScore, getSessionSeconds, isSaving, saveStatus, customMotions = [] }) {
  const [step, setStep] = useState('setup'); // setup -> case_building -> recording -> grading -> results
  
  const [motion, setMotion] = useState('');
  const [role, setRole] = useState('Affirmative');
  const [scratchpad, setScratchpad] = useState('');
  
  const [timer, setTimer] = useState(900); // 15 mins for case building, 435s for speech
  
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
    setTimer(435);
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
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 animate-fadeIn">
        <PinnedBar time={formatTime(timer)}>
          <button
            onClick={handleSkipToSpeech}
            className="w-full font-bold py-2.5 px-3 rounded-xl text-sm flex items-center justify-center space-x-2 cursor-pointer bg-emerald-600/20 text-emerald-400 border border-emerald-500/30"
          >
            <span>Start Speech</span>
            <Mic className="w-4 h-4" />
          </button>
        </PinnedBar>
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-4 md:p-6 shadow-xl">
            <div className="hidden lg:flex items-center space-x-3 mb-4">
              <Clock className="w-5 h-5 text-indigo-400" />
              <h3 className="font-bold text-white">Case Building Time</h3>
            </div>
            <div className="hidden lg:block text-4xl font-mono font-bold text-center text-indigo-300 tracking-wider mb-6 bg-slate-950 py-4 rounded-xl border border-slate-800">
              {formatTime(timer)}
            </div>
            <div className="mb-4">
              <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Motion</span>
              <p className="text-sm font-medium text-slate-200 mt-1">{motion}</p>
            </div>
            <div className="lg:mb-6">
              <span className="text-xs text-slate-500 uppercase font-bold tracking-wider">Role</span>
              <p className={`text-sm font-bold mt-1 ${role === 'Affirmative' ? 'text-indigo-400' : 'text-rose-400'}`}>
                {role}
              </p>
            </div>
            <button
              onClick={handleSkipToSpeech}
              className="hidden lg:flex w-full bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-400 border border-emerald-500/30 font-bold py-3 px-4 rounded-xl transition-colors items-center justify-center space-x-2"
            >
              <span>Ready? Start Speech</span>
              <Mic className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 md:p-6 shadow-xl h-full flex flex-col">
            <div className="flex items-center space-x-3 mb-4">
              <FileText className="w-5 h-5 text-slate-400" />
              <h3 className="font-bold text-white">Scratchpad</h3>
            </div>
            <textarea
              value={scratchpad}
              onChange={(e) => setScratchpad(e.target.value)}
              placeholder="Outline your AEL structure here. (Assertion, Explanation, Link-back). This will remain visible during your speech..."
              className="flex-1 w-full min-h-[240px] lg:min-h-0 bg-slate-950 border border-slate-800 text-slate-300 rounded-xl p-4 focus:outline-none focus:border-indigo-500/50 resize-none font-mono text-sm leading-relaxed"
            />
          </div>
        </div>
      </div>
    );
  }

  if (step === 'recording') {
    return (
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 lg:gap-6 animate-fadeIn">
        <PinnedBar time={formatTime(timer)} tone={isRecording ? 'text-rose-300' : 'text-slate-200'}>
          {!isRecording ? (
            <button
              onClick={handleBeginSpeech}
              className="w-full font-bold py-2.5 px-3 rounded-xl text-sm flex items-center justify-center space-x-2 cursor-pointer bg-indigo-600 text-white"
            >
              <Mic className="w-4 h-4" />
              <span>Record Speech</span>
            </button>
          ) : (
            <button
              onClick={handleFinishSpeech}
              className="w-full font-bold py-2.5 px-3 rounded-xl text-sm flex items-center justify-center space-x-2 cursor-pointer bg-rose-600 text-white"
            >
              <Square className="w-4 h-4 fill-current" />
              <span>Stop Recording</span>
            </button>
          )}
        </PinnedBar>
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-slate-900/80 backdrop-blur-md border border-slate-800 rounded-2xl p-4 md:p-6 shadow-xl text-center">
            <h3 className="font-bold text-white mb-2">Speech Delivery</h3>
            <p className="text-xs text-slate-400 lg:mb-6">Standard speech time is 7:15. Speak clearly.</p>
            
            <div className="hidden lg:block text-4xl font-mono font-bold text-center text-slate-200 tracking-wider mb-6 bg-slate-950 py-4 rounded-xl border border-slate-800 relative overflow-hidden">
              <div className={`absolute top-0 left-0 h-1 bg-indigo-500 transition-all duration-1000 ${isRecording ? 'w-full' : 'w-0'}`} style={{ animationDuration: '435s' }}></div>
              {formatTime(timer)}
            </div>

            {!isRecording ? (
              <button
                onClick={handleBeginSpeech}
                aria-label="Record Speech"
                className="hidden lg:flex w-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold py-4 px-4 rounded-xl transition-all transform hover:scale-105 justify-center items-center space-x-3 shadow-lg shadow-indigo-900/20"
              >
                <Mic className="w-5 h-5" />
                <span>Record Speech</span>
              </button>
            ) : (
              <button
                onClick={handleFinishSpeech}
                aria-label={`Stop Recording, ${recordingTime} seconds elapsed`}
                className="hidden lg:flex w-full bg-rose-600 hover:bg-rose-500 text-white font-bold py-4 px-4 rounded-xl transition-all transform hover:scale-105 justify-center items-center space-x-3 animate-pulse shadow-lg shadow-rose-900/20"
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
          <div className="bg-slate-900/50 backdrop-blur-xl border border-slate-800 rounded-2xl p-4 md:p-6 shadow-xl h-full flex flex-col">
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

  if (step === 'error') {
    return (
      <div className="glass-panel p-4 md:p-6 rounded-xl border border-red-500/20 text-center space-y-4 animate-fadeIn">
        <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto text-red-500">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h4 className="text-lg font-bold text-white">
            {submission.progress?.retryable ? 'Not finished yet' : 'Error'}
          </h4>
          <p className="text-sm text-rose-300">{errorMessage}</p>
          {submission.progress?.retryable && (
            <p className="text-xs text-slate-400">Your speech is saved. Tap Retry - you do not need to deliver it again.</p>
          )}
        </div>
        <div className="flex flex-wrap justify-center gap-3 mt-4">
          {submission.progress?.retryable && submission.hasRecording() && (
            <button 
              onClick={handleRetry}
              className="px-5 py-2.5 md:py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition cursor-pointer"
            >
              Retry
            </button>
          )}
          {motion && (
            <button 
              onClick={handleBackToSpeech}
              className="px-5 py-2.5 md:py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-sm font-semibold transition cursor-pointer"
            >
              Record Speech Again
            </button>
          )}
          <button 
            onClick={handleReset}
            className="px-5 py-2.5 md:py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-xl text-sm font-semibold transition cursor-pointer"
          >
            Start Over
          </button>
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
        <h3 className="text-xl font-bold text-white mb-2">Adjudicating your speech</h3>
        <p className="text-slate-400 text-sm max-w-md text-center mb-2">
          Your speech is transcribed and then judged on Matter, Manner and Method.
        </p>
        <div className="w-full max-w-xl">
          <SubmissionProgress progress={submission.progress} transcriptLabel="Speech Transcript" />
        </div>
      </div>
    );
  }

  if (step === 'results' && resultData) {
    return (
      <div className="space-y-8 animate-fadeIn pb-10">
        
        {/* Score Banner */}
        <div className="bg-gradient-to-r from-indigo-900/40 to-slate-900/80 backdrop-blur-xl border border-indigo-500/20 rounded-3xl p-5 md:p-8 relative overflow-hidden flex flex-col md:flex-row items-center md:items-stretch justify-between shadow-2xl">
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
                <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/50 block md:inline-block max-w-full">
                  <audio controls src={audioUrl} className="h-8 w-full md:w-auto max-w-full grayscale contrast-125" />
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
           <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 md:p-6 flex flex-col hover:border-blue-500/30 transition-colors">
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
           <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 md:p-6 flex flex-col hover:border-purple-500/30 transition-colors">
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
           <div className="bg-slate-900/50 border border-slate-800 rounded-2xl p-4 md:p-6 flex flex-col hover:border-emerald-500/30 transition-colors">
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
           <div className="p-4 md:p-6 border-b border-slate-800 bg-slate-900/80">
             <h4 className="font-bold text-white mb-3">Overall Adjudicator Feedback</h4>
             <p className="text-sm text-indigo-200/90 leading-relaxed">
               {resultData.overall_feedback}
             </p>
           </div>
           <div className="p-4 md:p-6">
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
