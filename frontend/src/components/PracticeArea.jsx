import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import ModeReadAloud from './ModeReadAloud';
import ModeQA from './ModeQA';
import ModeConversation from './ModeConversation';
import Leaderboard from './Leaderboard';
import { BookOpen, HelpCircle, MessageSquare, Award, UserCheck, LogOut, Sparkles } from 'lucide-react';
import Spinner from './UI/Spinner';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

export function PracticeArea() {
  const navigate = useNavigate();

  const [student, setStudent] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState('read_aloud'); // 'read_aloud' | 'qa' | 'conversation' | 'leaderboard'
  const [customMaterials, setCustomMaterials] = useState([]);

  // Verification state for scores saving
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // '' | 'saving' | 'success' | 'error'

  useEffect(() => {
    const checkAuth = async () => {
      setLoadingAuth(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/student/login');
        return;
      }

      // Fetch student info
      const { data: profile, error } = await supabase
        .from('students')
        .select('*, class:classes(class_name, class_code)')
        .eq('id', user.id)
        .single();

      if (error || !profile) {
        console.error('Not a student profile:', error);
        await supabase.auth.signOut();
        navigate('/student/login');
        return;
      }

      // Check if student still needs password change
      if (profile.requires_password_change) {
        navigate('/student/login'); // StudentLogin will intercept and show change password screen
        return;
      }

      setStudent(profile);

      // Fetch custom class practice materials
      try {
        const { data: materialsData, error: materialsErr } = await supabase
          .from('custom_materials')
          .select('*')
          .eq('class_id', profile.class_id);
        
        if (!materialsErr && materialsData) {
          setCustomMaterials(materialsData);
        }
      } catch (err) {
        console.error('Failed to load custom materials:', err);
      }

      setLoadingAuth(false);
    };

    checkAuth();
  }, [navigate]);

  const handleSignOut = async () => {
    if (window.confirm("Sign out of your practice session?")) {
      await supabase.auth.signOut();
      navigate('/student/login');
    }
  };

  // Direct write to Supabase Database
  const handleSaveScore = async (mode, scoreData) => {
    setIsSaving(true);
    setSaveStatus('saving');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('No user session.');

      // Map score value to integer
      let rawScore = 0;
      if (mode === 'read_aloud') {
        rawScore = scoreData.accuracy_score;
      } else {
        const subScores = mode === 'qa'
          ? [scoreData.fluency, scoreData.lexical_resource, scoreData.grammatical_range, scoreData.pronunciation]
          : [scoreData.fluency_and_coherence, scoreData.lexical_resource, scoreData.grammatical_range, scoreData.pronunciation, scoreData.interactive_communication];
        
        const rawAvg = subScores.reduce((a, b) => a + b, 0) / subScores.length;
        rawScore = rawAvg; // Store raw average directly (PostgreSQL will cast if float/numeric, or round if int. Our schema has score as INT, so PostgreSQL will round it automatically)
      }

      const roundedScore = Math.round(rawScore);

      const { error } = await supabase
        .from('assessments')
        .insert({
          student_id: user.id,
          mode: mode,
          score: roundedScore,
          feedback: scoreData // Full Gemini JSON structure
        });

      if (error) throw error;
      setSaveStatus('success');
    } catch (err) {
      console.error('Failed to log score to database:', err);
      setSaveStatus('error');
      alert('Error saving assessment score. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-[#070b13] flex justify-center items-center">
        <Spinner message="Signing in practice portal..." />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070b13] text-slate-100 flex flex-col md:flex-row relative">
      {/* Background neon glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/5 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/5 rounded-full blur-[100px] pointer-events-none text-indigo-500"></div>

      {/* Sidebar navigation */}
      <aside className="w-full md:w-64 bg-slate-950/80 border-b md:border-b-0 md:border-r border-slate-900 flex flex-col justify-between p-6 shrink-0 relative z-20">
        <div className="space-y-8">
          {/* Logo */}
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-purple-600/10 border border-purple-500/20 rounded-xl text-purple-400">
              <Sparkles className="w-5 h-5" />
            </div>
            <span className="text-lg font-extrabold text-white">
              href<span className="text-purple-500 font-medium">Speak</span>
            </span>
          </div>

          {/* Student Status Profile */}
          <div className="flex items-center justify-between p-3 bg-slate-900/50 rounded-xl border border-slate-850">
            <div className="flex items-center space-x-2 overflow-hidden">
              <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <div className="text-xs truncate max-w-[120px]">
                <div className="text-slate-400 font-medium">{student?.class?.class_name || 'Classroom'}</div>
                <div className="text-white font-bold font-mono truncate">{student?.full_name}</div>
              </div>
            </div>
          </div>

          {/* Navigation */}
          <nav className="flex flex-col space-y-1">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">Practice Modes</span>
            
            <button
              onClick={() => {
                setActiveTab('read_aloud');
                setSaveStatus('');
              }}
              className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-bold transition-all duration-200 ${
                activeTab === 'read_aloud'
                  ? 'bg-purple-600/15 border border-purple-500/20 text-white font-extrabold'
                  : 'border border-transparent text-slate-400 hover:bg-slate-900/40 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>1. Read Aloud</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('qa');
                setSaveStatus('');
              }}
              className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-bold transition-all duration-200 ${
                activeTab === 'qa'
                  ? 'bg-purple-600/15 border border-purple-500/20 text-white font-extrabold'
                  : 'border border-transparent text-slate-400 hover:bg-slate-900/40 hover:text-slate-200'
              }`}
            >
              <HelpCircle className="w-4 h-4" />
              <span>2. Q&A Mock</span>
            </button>

            <button
              onClick={() => {
                setActiveTab('conversation');
                setSaveStatus('');
              }}
              className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-bold transition-all duration-200 ${
                activeTab === 'conversation'
                  ? 'bg-purple-600/15 border border-purple-500/20 text-white font-extrabold'
                  : 'border border-transparent text-slate-400 hover:bg-slate-900/40 hover:text-slate-200'
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              <span>3. AI Conversation</span>
            </button>

            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mt-4 mb-2 px-1">Analytics</span>
            
            <button
              onClick={() => {
                setActiveTab('leaderboard');
                setSaveStatus('');
              }}
              className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-bold transition-all duration-200 ${
                activeTab === 'leaderboard'
                  ? 'bg-purple-600/15 border border-purple-500/20 text-white font-extrabold'
                  : 'border border-transparent text-slate-400 hover:bg-slate-900/40 hover:text-slate-200'
              }`}
            >
              <Award className="w-4 h-4" />
              <span>Leaderboard Log</span>
            </button>
          </nav>
        </div>

        {/* Footer / Sign out */}
        <div className="mt-6 border-t border-slate-900 pt-4 flex flex-col space-y-4">
          <div className="text-[10px] text-slate-600 font-mono">
            <p>© 2026 hrefSpeak AI</p>
            <p className="mt-1">LMS Dashboard Mode</p>
          </div>
          <button
            onClick={handleSignOut}
            className="w-full flex items-center justify-between px-4 py-2 bg-slate-900 hover:bg-rose-950/20 border border-slate-850 hover:border-rose-950/50 rounded-xl text-xs font-bold text-slate-400 hover:text-rose-400 transition"
          >
            <span>Log Out</span>
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Panel Content Area */}
      <main className="flex-1 p-6 md:p-10 max-w-5xl overflow-y-auto relative z-10">
        
        {/* Top Header */}
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              {activeTab === 'read_aloud' && 'Read Aloud Practice'}
              {activeTab === 'qa' && 'IELTS Q&A Assessment'}
              {activeTab === 'conversation' && 'AI Conversation Partner'}
              {activeTab === 'leaderboard' && 'Leaderboard Logs'}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {activeTab === 'read_aloud' && 'Read the paragraph aloud. Whisper evaluates your accuracy.'}
              {activeTab === 'qa' && 'Express your thoughts on the prompt. Gemini evaluates against IELTS standards.'}
              {activeTab === 'conversation' && 'Hold a conversation with Llama-3. Whisper and Gemini evaluate dialogue performance.'}
              {activeTab === 'leaderboard' && 'Logs and scores saved in the Supabase classroom database.'}
            </p>
          </div>
        </header>

        {/* Tab Components */}
        <div className="animate-fadeIn">
          {activeTab === 'read_aloud' && (
            <ModeReadAloud 
              studentName={student.full_name} 
              apiBase={API_BASE} 
              onSaveScore={handleSaveScore}
              isSaving={isSaving}
              saveStatus={saveStatus}
              customParagraphs={customMaterials.filter(m => m.mode === 'read_aloud')}
            />
          )}
          {activeTab === 'qa' && (
            <ModeQA 
              studentName={student.full_name} 
              apiBase={API_BASE} 
              onSaveScore={handleSaveScore}
              isSaving={isSaving}
              saveStatus={saveStatus}
              customQuestions={customMaterials.filter(m => m.mode === 'qa')}
            />
          )}
          {activeTab === 'conversation' && (
            <ModeConversation 
              studentName={student.full_name} 
              apiBase={API_BASE} 
              onSaveScore={handleSaveScore}
              isSaving={isSaving}
              saveStatus={saveStatus}
              customGreetings={customMaterials.filter(m => m.mode === 'conversation')}
            />
          )}
          {activeTab === 'leaderboard' && (
            <Leaderboard />
          )}
        </div>
      </main>
    </div>
  );
}
export default PracticeArea;
