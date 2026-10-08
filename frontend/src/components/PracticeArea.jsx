import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import ModeReadAloud from './ModeReadAloud';
import ModeQA from './ModeQA';
import ModeConversation from './ModeConversation';
import ModeDebate from './ModeDebate';
import ModeMattering from './ModeMattering';
import Leaderboard from './Leaderboard';
import { BookOpen, HelpCircle, MessageSquare, Award, UserCheck, LogOut, Sparkles, Gavel, Lightbulb, History, Loader2 } from 'lucide-react';
import Spinner from './UI/Spinner';
import { useConfirm } from './UI/ConfirmModal';
import useActivityTracker from '../hooks/useActivityTracker';
import useBeforeUnload from '../hooks/useBeforeUnload';
import useSwipeRow from '../hooks/useSwipeRow';
import AIStatusBadge from './AIStatusBadge';
import SubmissionReview from './UI/SubmissionReview';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

const NAV_ITEMS = [
  { key: 'read_aloud', label: '1. Read Aloud', shortLabel: 'Read Aloud', icon: BookOpen },
  { key: 'qa', label: '2. Q&A Mock', shortLabel: 'Q&A', icon: HelpCircle },
  { key: 'conversation', label: '3. AI Conversation', shortLabel: 'Conversation', icon: MessageSquare },
  { key: 'debate', label: '4. Debate Mode', shortLabel: 'Debate', icon: Gavel },
  { key: 'mattering', label: '5. Mattering Drill', shortLabel: 'Mattering', icon: Lightbulb },
  { key: 'leaderboard', label: 'Leaderboard Log', shortLabel: 'Leaderboard', icon: Award, section: 'Analytics' },
];

export function PracticeArea() {
  const navigate = useNavigate();
  const confirm = useConfirm();

  const [student, setStudent] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState('read_aloud'); // 'read_aloud' | 'qa' | 'conversation' | 'debate' | 'mattering' | 'leaderboard'
  const [customMaterials, setCustomMaterials] = useState([]);

  // Verification state for scores saving
  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(''); // '' | 'saving' | 'success' | 'error'

  // "My last submission" review panel: null (closed) or { assessment, message }
  const [lastSubmission, setLastSubmission] = useState(null);
  const [loadingLast, setLoadingLast] = useState(false);

  const sessionStartTimeRef = React.useRef(Date.now());

  // Activity Tracking
  const { activeSeconds, idleSeconds, isActive } = useActivityTracker({
    studentId: student?.id,
    classId: student?.class_id,
    activeMode: activeTab === 'leaderboard' ? null : activeTab
  });

  const navRef = React.useRef(null);
  const swipeRef = useSwipeRow();
  const setNavRef = React.useCallback((el) => { navRef.current = el; swipeRef(el); }, [swipeRef]);

  useEffect(() => {
    // Reset assessment duration timer when mode changes
    sessionStartTimeRef.current = Date.now();
    // Phones: keep the selected tab visible in the swipeable row
    const nav = navRef.current;
    const tab = nav?.querySelector(`[data-tab="${activeTab}"]`);
    if (nav && tab && nav.scrollWidth > nav.clientWidth) {
      nav.scrollTo({ left: tab.offsetLeft - (nav.clientWidth - tab.offsetWidth) / 2, behavior: 'smooth' });
    }
  }, [activeTab, loadingAuth]);

  const shouldWarnOnUnload = activeTab !== 'leaderboard';
  useBeforeUnload(shouldWarnOnUnload, "You have an active practice session. Are you sure you want to leave?");

  const readAloudMaterials = useMemo(() => customMaterials.filter(m => m.mode === 'read_aloud'), [customMaterials]);
  const qaMaterials = useMemo(() => customMaterials.filter(m => m.mode === 'qa'), [customMaterials]);
  const conversationMaterials = useMemo(() => customMaterials.filter(m => m.mode === 'conversation'), [customMaterials]);
  const debateMaterials = useMemo(() => customMaterials.filter(m => m.mode === 'debate'), [customMaterials]);
  const matteringMaterials = useMemo(() => customMaterials.filter(m => m.mode === 'mattering'), [customMaterials]);

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
          .or(`class_id.eq.${profile.class_id},and(class_id.is.null,grade_level.eq.${profile.class?.grade_level || 'General'})`);
        
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
    const confirmed = await confirm({
      title: 'Sign Out',
      message: 'Sign out of your practice session?',
      confirmLabel: 'Sign Out',
      variant: 'logout',
    });
    if (confirmed) {
      await supabase.auth.signOut();
      navigate('/student/login');
    }
  };

  // Latest saved attempt of the mode the student is looking at
  const openLastSubmission = async () => {
    if (!student?.id || loadingLast) return;
    setLoadingLast(true);
    try {
      const { data, error } = await supabase
        .from('assessments')
        .select('*')
        .eq('student_id', student.id)
        .eq('mode', activeTab)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      setLastSubmission({ assessment: data?.[0] || null });
    } catch (err) {
      console.error('Failed to load the last submission:', err);
      setLastSubmission({ assessment: null, message: 'Could not load your last submission. Check your connection and try again.' });
    } finally {
      setLoadingLast(false);
    }
  };

  const getSessionSeconds = () => Math.round((Date.now() - sessionStartTimeRef.current) / 1000);

  // Scores are normally saved by the server right after grading ({ alreadySaved: true }).
  // The direct browser write below is only a fallback.
  const handleSaveScore = async (mode, scoreData, { alreadySaved = false } = {}) => {
    if (alreadySaved) {
      setSaveStatus('success');
      sessionStartTimeRef.current = Date.now();
      return;
    }
    setIsSaving(true);
    setSaveStatus('saving');
    try {
      if (!student || !student.id) throw new Error('No active student session.');

      // Map score value to integer
      let rawScore = 0;
      if (mode === 'read_aloud') {
        rawScore = scoreData.accuracy_score;
      } else if (mode === 'mattering') {
        rawScore = scoreData.speaker_score; // debate speaker scale, 69-81 (75 = average)
      } else if (mode === 'debate') {
        rawScore = scoreData.finalScore; // pre-calculated 100-point scale in frontend component
      } else {
        const subScores = mode === 'qa'
          ? [scoreData.fluency, scoreData.lexical_resource, scoreData.grammatical_range, scoreData.pronunciation]
          : [scoreData.fluency_and_coherence, scoreData.lexical_resource, scoreData.grammatical_range, scoreData.pronunciation, scoreData.interactive_communication];
        rawScore = subScores.reduce((a, b) => a + b, 0) / subScores.length;
      }

      const row = {
        student_id: student.id,
        mode: mode,
        score: Math.round(rawScore),
        feedback: scoreData,
        duration_seconds: getSessionSeconds(),
      };

      let { error } = await supabase.from('assessments').insert(row);
      if (error) {
        // Usually an expired login in a background tab: refresh it and try once more.
        await supabase.auth.refreshSession();
        ({ error } = await supabase.from('assessments').insert(row));
      }
      if (error) throw error;
      setSaveStatus('success');
      sessionStartTimeRef.current = Date.now();
    } catch (err) {
      console.error('Failed to log score to database:', err);
      setSaveStatus('error');
      alert(`Your result is shown, but saving it to the leaderboard failed. Please sign out and sign in again, then press the save button. (${err.message || JSON.stringify(err)})`);
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
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/5 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/5 rounded-full blur-[100px]"></div>
      </div>

      {/* Navigation: compact top bar on phones, sidebar on desktop */}
      <aside className="w-full md:w-64 bg-slate-950/95 md:bg-slate-950/80 border-b md:border-b-0 md:border-r border-slate-900 flex flex-col justify-between px-4 pt-3 pb-2 md:p-6 shrink-0 relative z-20">
        <div className="space-y-2.5 md:space-y-8">
          <div className="flex items-center justify-between gap-3 md:block md:space-y-8">
            {/* Logo */}
            <div className="flex items-center space-x-2 md:space-x-2.5 shrink-0">
              <div className="p-1.5 md:p-2 bg-purple-600/10 border border-purple-500/20 rounded-xl text-purple-400">
                <Sparkles className="w-4 h-4 md:w-5 md:h-5" />
              </div>
              <span className="text-base md:text-lg font-extrabold text-white">
                href<span className="text-purple-500 font-medium">Speak</span>
              </span>
            </div>

            {/* Student Status Profile */}
            <div className="flex items-center justify-end md:justify-between min-w-0 flex-1 md:p-3 md:bg-slate-900/50 md:rounded-xl md:border md:border-slate-850">
              <div className="flex items-center space-x-2 overflow-hidden min-w-0">
                <UserCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                <div className="text-[11px] md:text-xs min-w-0 md:max-w-[120px] leading-tight md:leading-normal">
                  <div className="text-slate-400 font-medium truncate">{student?.class?.class_name || 'Classroom'}</div>
                  <div className="text-white font-bold font-mono truncate">{student?.full_name}</div>
                </div>
              </div>
            </div>

            {/* Sign out (phones) */}
            <button
              onClick={handleSignOut}
              aria-label="Log out"
              title="Log out"
              className="md:hidden shrink-0 w-10 h-10 flex items-center justify-center bg-slate-900 border border-slate-800 rounded-xl text-slate-400 active:text-rose-400 active:bg-rose-950/20"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

          {/* Navigation: swipeable row on phones, vertical list on desktop */}
          <nav ref={setNavRef} className="no-scrollbar flex md:flex-col gap-1.5 md:gap-0 md:space-y-1 overflow-x-auto md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0 pb-1 md:pb-0">
            <span className="hidden md:block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">Practice Modes</span>

            {NAV_ITEMS.map(({ key, label, shortLabel, icon: Icon, section }) => (
              <React.Fragment key={key}>
                {section && (
                  <span className="hidden md:block text-[10px] font-semibold text-slate-500 uppercase tracking-wider md:pt-4 mb-2 px-1">{section}</span>
                )}
                <button
                  data-tab={key}
                  aria-current={activeTab === key ? 'page' : undefined}
                  onClick={() => {
                    setActiveTab(key);
                    setSaveStatus('');
                  }}
                  className={`flex items-center shrink-0 whitespace-nowrap space-x-2 md:space-x-3 px-3.5 md:px-4 py-2.5 md:py-3 rounded-xl text-xs font-bold transition-all duration-200 ${
                    activeTab === key
                      ? 'bg-purple-600/15 border border-purple-500/20 text-white font-extrabold'
                      : 'border border-slate-800 md:border-transparent text-slate-400 hover:bg-slate-900/40 hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span className="md:hidden">{shortLabel}</span>
                  <span className="hidden md:inline">{label}</span>
                </button>
              </React.Fragment>
            ))}
          </nav>
        </div>

        {/* Footer / Sign out (desktop) */}
        <div className="hidden md:flex mt-6 border-t border-slate-900 pt-4 flex-col space-y-4">
          <div className="text-[10px] text-slate-600 font-mono">
            <p>© 2026 HreFSpeak AI</p>
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
      <main className="flex-1 w-full min-w-0 p-4 md:p-10 max-w-5xl lg:overflow-y-auto relative z-10">
        
        {/* Top Header */}
        <header className="mb-5 md:mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <div className="min-w-0">
            <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">
              {activeTab === 'read_aloud' && 'Read Aloud Practice'}
              {activeTab === 'qa' && 'IELTS Q&A Assessment'}
              {activeTab === 'conversation' && 'AI Conversation Partner'}
              {activeTab === 'debate' && 'Debate Adjudication'}
              {activeTab === 'mattering' && 'Mattering Drill'}
              {activeTab === 'leaderboard' && 'Leaderboard Logs'}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {activeTab === 'read_aloud' && 'Read the paragraph aloud. Whisper evaluates your accuracy.'}
              {activeTab === 'qa' && 'Express your thoughts on the prompt. Gemini evaluates against IELTS standards.'}
              {activeTab === 'conversation' && 'Hold a conversation with the AI tutor. Whisper and Gemini evaluate dialogue performance.'}
              {activeTab === 'debate' && 'Practice case building and speech delivery. Gemini acts as a strict debate adjudicator.'}
              {activeTab === 'mattering' && 'Break an issue down, deliver one argument, then rebut the other side. Scored on the debate speaker scale.'}
              {activeTab === 'leaderboard' && 'Logs and scores saved in the Supabase classroom database.'}
            </p>
          </div>
          <div className="flex items-center justify-between sm:justify-end gap-2 md:gap-3 shrink-0">
            {activeTab !== 'leaderboard' && (
              <button
                onClick={openLastSubmission}
                disabled={loadingLast}
                title="Listen to your latest recording for this mode and see its transcript, score and feedback"
                className="flex items-center space-x-1.5 px-3 py-2.5 md:py-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 rounded-xl text-xs font-bold text-slate-300 hover:text-white transition disabled:opacity-60 cursor-pointer"
              >
                {loadingLast ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <History className="w-3.5 h-3.5" />}
                <span>My last submission</span>
              </button>
            )}
            <AIStatusBadge apiBase={API_BASE} />
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
              customParagraphs={readAloudMaterials}
              getSessionSeconds={getSessionSeconds}
            />
          )}
          {activeTab === 'qa' && (
            <ModeQA 
              studentName={student.full_name} 
              apiBase={API_BASE} 
              onSaveScore={handleSaveScore}
              isSaving={isSaving}
              saveStatus={saveStatus}
              customQuestions={qaMaterials}
              getSessionSeconds={getSessionSeconds}
            />
          )}
          {activeTab === 'conversation' && (
            <ModeConversation 
              studentName={student.full_name} 
              apiBase={API_BASE} 
              onSaveScore={handleSaveScore}
              isSaving={isSaving}
              saveStatus={saveStatus}
              customGreetings={conversationMaterials}
              getSessionSeconds={getSessionSeconds}
            />
          )}
          {activeTab === 'debate' && (
            <ModeDebate 
              studentName={student.full_name} 
              apiBase={API_BASE} 
              onSaveScore={handleSaveScore}
              isSaving={isSaving}
              saveStatus={saveStatus}
              customMotions={debateMaterials}
              getSessionSeconds={getSessionSeconds}
            />
          )}
          {activeTab === 'mattering' && (
            <ModeMattering
              apiBase={API_BASE}
              onSaveScore={handleSaveScore}
              isSaving={isSaving}
              saveStatus={saveStatus}
              customIssues={matteringMaterials}
              getSessionSeconds={getSessionSeconds}
            />
          )}
          {activeTab === 'leaderboard' && (
            <Leaderboard student={student} />
          )}
        </div>
      </main>

      {lastSubmission && (
        <SubmissionReview
          assessment={lastSubmission.assessment}
          apiBase={API_BASE}
          heading="My last submission"
          emptyMessage={lastSubmission.message || 'You have no saved attempt in this mode yet. Finish one and it will appear here.'}
          onClose={() => setLastSubmission(null)}
        />
      )}
    </div>
  );
}
export default PracticeArea;
