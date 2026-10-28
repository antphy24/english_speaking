import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import ModeReadAloud from './ModeReadAloud';
import ModeQA from './ModeQA';
import ModeConversation from './ModeConversation';
import ModeDebate from './ModeDebate';
import ModeMattering from './ModeMattering';
import Leaderboard from './Leaderboard';
import { BookOpen, HelpCircle, MessageSquare, Award, Gavel, Lightbulb, History } from 'lucide-react';
import { AppShell } from './UI/AppShell';
import { PageHeader } from './UI/PageHeader';
import { Button } from './UI/Button';
import { useToast } from './UI/Toast';
import Spinner from './UI/Spinner';
import { useConfirm } from './UI/ConfirmModal';
import useActivityTracker from '../hooks/useActivityTracker';
import useBeforeUnload from '../hooks/useBeforeUnload';
import AIStatusBadge from './AIStatusBadge';
import SubmissionReview from './UI/SubmissionReview';
import StudentTestBanner from './research/StudentTestBanner';
import { resolveTimers, DEFAULT_TIMERS } from '../utils/timerSettings';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

const NAV_ITEMS = [
  { key: 'read_aloud', label: 'Read Aloud', icon: BookOpen },
  { key: 'qa', label: 'Q&A', icon: HelpCircle },
  { key: 'conversation', label: 'Conversation', icon: MessageSquare },
  { key: 'debate', label: 'Debate', icon: Gavel },
  { key: 'mattering', label: 'Mattering', icon: Lightbulb },
  { key: 'leaderboard', label: 'Leaderboard', icon: Award, section: 'Progress' },
];

const PAGE_INFO = {
  read_aloud: { title: 'Read Aloud', description: 'Choose a paragraph, read it aloud, and get your accuracy score with feedback.' },
  qa: { title: 'Q&A', description: 'Answer a question out loud. You are scored on fluency, vocabulary, grammar and pronunciation.' },
  conversation: { title: 'Conversation', description: 'Talk with an AI partner, then get a score for the whole conversation.' },
  debate: { title: 'Debate', description: 'Prepare a case, deliver your speech, and get feedback like a debate adjudicator would give.' },
  mattering: { title: 'Mattering', description: 'Break an issue down, deliver one argument, then rebut the other side. Scored on the debate speaker scale.' },
  leaderboard: { title: 'Leaderboard', description: 'Your saved scores and how your class is doing.' },
};

export function PracticeArea() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  const toast = useToast();

  const [student, setStudent] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [activeTab, setActiveTab] = useState('read_aloud'); // 'read_aloud' | 'qa' | 'conversation' | 'debate' | 'mattering' | 'leaderboard'
  const [customMaterials, setCustomMaterials] = useState([]);
  const [timers, setTimers] = useState(DEFAULT_TIMERS); // Debate / Mattering times set by the teacher for this class

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

  useEffect(() => {
    // Reset assessment duration timer when mode changes
    sessionStartTimeRef.current = Date.now();
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

  // The teacher can change the Debate / Mattering times for the class at any time, so read
  // them again whenever one of those tabs is opened. Any problem (for example the database
  // not updated yet) simply keeps the default times.
  useEffect(() => {
    if (!student?.class_id || (activeTab !== 'debate' && activeTab !== 'mattering')) return undefined;
    let cancelled = false;
    (async () => {
      try {
        const { data, error } = await supabase
          .from('classes')
          .select('timer_settings')
          .eq('id', student.class_id)
          .maybeSingle();
        if (!cancelled && !error) setTimers(resolveTimers(data?.timer_settings));
      } catch {
        /* keep the defaults */
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, student?.class_id]);

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
      toast.error(`Your result is shown, but saving it failed. Please sign out and sign in again, then press Save again. (${err.message || JSON.stringify(err)})`, { duration: 0 });
    } finally {
      setIsSaving(false);
    }
  };

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-canvas flex justify-center items-center">
        <Spinner message="Opening your practice space..." />
      </div>
    );
  }

  const page = PAGE_INFO[activeTab] || PAGE_INFO.read_aloud;

  return (
    <AppShell
      navItems={NAV_ITEMS}
      navTitle="Practice"
      activeKey={activeTab}
      onSelect={(key) => {
        setActiveTab(key);
        setSaveStatus('');
      }}
      user={{ name: student?.full_name, subtitle: student?.class?.class_name || 'Classroom' }}
      onSignOut={handleSignOut}
    >
      <div className="flex flex-col gap-5 md:gap-7">
        <PageHeader
          title={page.title}
          description={page.description}
          actions={
            <>
              <AIStatusBadge apiBase={API_BASE} />
              {activeTab !== 'leaderboard' && (
                <Button
                  variant="secondary"
                  icon={History}
                  loading={loadingLast}
                  onClick={openLastSubmission}
                  title="Listen to your latest recording for this mode and see its transcript, score and feedback"
                >
                  My last submission
                </Button>
              )}
            </>
          }
        />

        <StudentTestBanner studentId={student?.id} />

        {/* Tab Components */}
        <div key={activeTab} className="animate-fadeIn">
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
              timers={timers.debate}
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
              timers={timers.mattering}
            />
          )}
          {activeTab === 'leaderboard' && (
            <Leaderboard student={student} />
          )}
        </div>
      </div>

      {lastSubmission && (
        <SubmissionReview
          assessment={lastSubmission.assessment}
          apiBase={API_BASE}
          heading="My last submission"
          emptyMessage={lastSubmission.message || 'You have no saved attempt in this mode yet. Finish one and it will appear here.'}
          onClose={() => setLastSubmission(null)}
        />
      )}
    </AppShell>
  );
}
export default PracticeArea;
