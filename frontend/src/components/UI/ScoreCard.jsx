import React from 'react';
import { Award, BookOpen, MessageSquare, AlertCircle, HelpCircle, CheckCircle, RefreshCw } from 'lucide-react';

export function ScoreCard({ mode, score, onRestart, isSaving, saveStatus, onSaveToLeaderboard }) {
  if (!score) return null;

  // Helper to color-code 0-100 scores
  const getScoreColor = (val) => {
    if (val >= 85) return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
    if (val >= 70) return 'text-indigo-400 bg-indigo-500/10 border-indigo-500/20';
    if (val >= 50) return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
    return 'text-rose-400 bg-rose-500/10 border-rose-500/20';
  };

  const getScoreBarColor = (val) => {
    if (val >= 85) return 'bg-emerald-500';
    if (val >= 70) return 'bg-indigo-500';
    if (val >= 50) return 'bg-amber-500';
    return 'bg-rose-500';
  };

  return (
    <div className="w-full glass-panel rounded-2xl p-6 glow-purple border border-purple-500/10 animate-fadeIn space-y-6">
      
      {/* Header */}
      <div className="flex justify-between items-center border-b border-slate-800 pb-4">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-purple-500/10 rounded-lg text-purple-400">
            {mode === 'read_aloud' && <BookOpen className="w-6 h-6" />}
            {mode === 'qa' && <HelpCircle className="w-6 h-6" />}
            {mode === 'conversation' && <MessageSquare className="w-6 h-6" />}
          </div>
          <div>
            <span className="text-xs font-semibold text-purple-400 tracking-wider uppercase">Assessment Complete</span>
            <h3 className="text-xl font-bold text-white">
              {mode === 'read_aloud' && 'Read Aloud Results'}
              {mode === 'qa' && 'Q&A Grading Report'}
              {mode === 'conversation' && 'Dialogue Evaluation Report'}
            </h3>
          </div>
        </div>
        
        {/* Restart Button */}
        <button 
          onClick={onRestart}
          className="flex items-center space-x-2 px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-sm transition-all duration-200"
        >
          <RefreshCw className="w-4 h-4" />
          <span>Try Again</span>
        </button>
      </div>

      {/* Main Score Layout */}
      {mode === 'read_aloud' && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center">
          {/* SVG Circular Gauge for Accuracy */}
          <div className="md:col-span-4 flex flex-col items-center justify-center p-4 bg-slate-900/50 rounded-xl border border-slate-800">
            <div className="relative w-32 h-32 flex items-center justify-center">
              <svg className="w-full h-full transform -rotate-90">
                <circle
                  cx="64"
                  cy="64"
                  r="52"
                  className="stroke-slate-800 fill-transparent"
                  strokeWidth="8"
                />
                <circle
                  cx="64"
                  cy="64"
                  r="52"
                  className="stroke-purple-500 transition-all duration-1000 ease-out fill-transparent"
                  strokeWidth="8"
                  strokeDasharray={2 * Math.PI * 52}
                  strokeDashoffset={2 * Math.PI * 52 * (1 - score.accuracy_score / 100)}
                  strokeLinecap="round"
                />
              </svg>
              <div className="absolute flex flex-col items-center justify-center">
                <span className="text-3xl font-extrabold text-white">{score.accuracy_score}</span>
                <span className="text-xs text-slate-400 uppercase tracking-widest font-semibold">Accuracy</span>
              </div>
            </div>
            
            <div className="mt-4 text-center">
              <div className="text-sm text-slate-400">Word Error Rate (WER)</div>
              <div className="text-lg font-bold text-indigo-400">{(score.word_error_rate * 100).toFixed(1)}%</div>
            </div>
          </div>

          {/* Details & Playback */}
          <div className="md:col-span-8 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800/80">
                <span className="block text-xs text-rose-400 font-semibold uppercase tracking-wider mb-1.5">Skipped Words ({score.skipped_words?.length || 0})</span>
                {score.skipped_words && score.skipped_words.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                    {score.skipped_words.map((w, idx) => (
                      <span key={idx} className="text-xs px-2 py-0.5 bg-rose-500/10 text-rose-300 border border-rose-500/20 rounded font-medium">{w}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">No words skipped!</p>
                )}
              </div>

              <div className="bg-slate-900/40 p-4 rounded-xl border border-slate-800/80">
                <span className="block text-xs text-amber-400 font-semibold uppercase tracking-wider mb-1.5">Mispronounced ({score.mispronounced_words?.length || 0})</span>
                {score.mispronounced_words && score.mispronounced_words.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto pr-1">
                    {score.mispronounced_words.map((w, idx) => (
                      <span key={idx} className="text-xs px-2 py-0.5 bg-amber-500/10 text-amber-300 border border-amber-500/20 rounded font-medium">{w}</span>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 italic">Perfect pronunciation!</p>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {(mode === 'qa' || mode === 'conversation') && (
        <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-start">
          
          {/* Average Score Badge */}
          <div className="md:col-span-4 flex flex-col items-center justify-center p-6 bg-slate-900/50 rounded-xl border border-slate-800">
            <Award className="w-10 h-10 text-purple-400 mb-2" />
            <span className="text-xs text-slate-400 uppercase tracking-widest font-semibold mb-1">Overall Score</span>
            
            {(() => {
              const scores = mode === 'qa' 
                ? [score.fluency, score.lexical_resource, score.grammatical_range, score.pronunciation]
                : [score.fluency_and_coherence, score.lexical_resource, score.grammatical_range, score.pronunciation, score.interactive_communication];
              const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
              // Round to nearest integer
              const roundedAvg = Math.round(avg);
              return (
                <div className={`mt-2 px-5 py-2.5 rounded-2xl border text-4xl font-extrabold ${getScoreColor(roundedAvg)}`}>
                  {roundedAvg}
                </div>
              );
            })()}
            <span className="text-[10px] text-slate-500 mt-2">Scale 0 - 100</span>
          </div>

          {/* Breakdown sliders */}
          <div className="md:col-span-8 space-y-4">
            <h4 className="text-sm font-semibold text-slate-300 uppercase tracking-wider mb-2">Sub-Score Breakdown</h4>
            
            {mode === 'qa' ? (
              <div className="space-y-3">
                {[
                  { label: 'Fluency & Coherence', val: score.fluency },
                  { label: 'Lexical Resource', val: score.lexical_resource },
                  { label: 'Grammatical Range', val: score.grammatical_range },
                  { label: 'Pronunciation', val: score.pronunciation },
                ].map((item, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-slate-400">{item.label}</span>
                      <span className="text-white font-bold">{item.val} / 100</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-1000 ${getScoreBarColor(item.val)}`} 
                        style={{ width: `${Math.max(0, Math.min(100, item.val))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-3">
                {[
                  { label: 'Fluency & Coherence', val: score.fluency_and_coherence },
                  { label: 'Lexical Resource', val: score.lexical_resource },
                  { label: 'Grammatical Range', val: score.grammatical_range },
                  { label: 'Pronunciation', val: score.pronunciation },
                  { label: 'Interactive Communication', val: score.interactive_communication },
                ].map((item, idx) => (
                  <div key={idx} className="space-y-1">
                    <div className="flex justify-between text-xs font-medium">
                      <span className="text-slate-400">{item.label}</span>
                      <span className="text-white font-bold">{item.val} / 100</span>
                    </div>
                    <div className="h-2 bg-slate-800 rounded-full overflow-hidden">
                      <div 
                        className={`h-full rounded-full transition-all duration-1000 ${getScoreBarColor(item.val)}`} 
                        style={{ width: `${Math.max(0, Math.min(100, item.val))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Detailed Feedback */}
      <div className="bg-slate-900/50 p-5 rounded-xl border border-slate-800 space-y-2">
        <h4 className="text-sm font-semibold text-purple-400 uppercase tracking-wider">Examiner Feedback</h4>
        <p className="text-slate-300 text-sm leading-relaxed whitespace-pre-wrap">{score.feedback}</p>
      </div>

      {/* Leaderboard Logging Button */}
      <div className="border-t border-slate-850 pt-5 flex items-center justify-between">
        <div className="flex items-center space-x-2 text-xs text-slate-400">
          <AlertCircle className="w-4 h-4 text-purple-400 flex-shrink-0" />
          <span>Scores are recorded anonymously by default under your name.</span>
        </div>
        
        <button
          onClick={onSaveToLeaderboard}
          disabled={isSaving || saveStatus === 'success'}
          className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl font-semibold text-sm transition-all duration-200 ${
            saveStatus === 'success'
              ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
              : 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/20 active:scale-95 disabled:opacity-50'
          }`}
        >
          {saveStatus === 'success' ? (
            <>
              <CheckCircle className="w-4 h-4" />
              <span>Score Saved!</span>
            </>
          ) : (
            <>
              {isSaving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div>
                  <span>Saving to Leaderboard...</span>
                </>
              ) : (
                <span>Log to Google Sheet</span>
              )}
            </>
          )}
        </button>
      </div>
      
    </div>
  );
}
export default ScoreCard;
