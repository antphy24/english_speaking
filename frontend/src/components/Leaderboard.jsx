import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabaseClient';
import { Award, BookOpen, HelpCircle, MessageSquare, RefreshCw, Calendar, User } from 'lucide-react';
import Spinner from './UI/Spinner';

export function Leaderboard() {
  const [activeSource, setActiveSource] = useState('global'); // 'global' (class rankings) | 'local' (own history)
  const [activeModeTab, setActiveModeTab] = useState('read_aloud'); // 'read_aloud' | 'qa' | 'conversation'
  
  const [localHistory, setLocalHistory] = useState([]);
  const [classRankings, setClassRankings] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [studentProfile, setStudentProfile] = useState(null);

  // Load student profile & local history
  useEffect(() => {
    const fetchStudentData = async () => {
      setIsLoading(true);
      setErrorMsg('');
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Get student's class_id
        const { data: profile, error: profileErr } = await supabase
          .from('students')
          .select('*, class:classes(class_name)')
          .eq('id', user.id)
          .single();
          
        if (profileErr) throw profileErr;
        setStudentProfile(profile);

        // Fetch student's own assessments (session history)
        const { data: historyData, error: historyErr } = await supabase
          .from('assessments')
          .select('*')
          .eq('student_id', user.id)
          .order('created_at', { ascending: false });
          
        if (historyErr) throw historyErr;
        setLocalHistory(historyData);
        
        // Fetch class rankings
        if (profile.class_id) {
          // 1. Get all students in this class
          const { data: classStudents, error: studentsErr } = await supabase
            .from('students')
            .select('id, full_name')
            .eq('class_id', profile.class_id);
            
          if (studentsErr) throw studentsErr;
          const studentIds = classStudents.map(s => s.id);
          
          if (studentIds.length > 0) {
            // 2. Get assessments of these students
            const { data: classAssessments, error: assessErr } = await supabase
              .from('assessments')
              .select('*, student:students(full_name)')
              .in('student_id', studentIds);
              
            if (assessErr) throw assessErr;
            setClassRankings(classAssessments);
          }
        }
      } catch (err) {
        console.error('Failed to load leaderboard data:', err);
        setErrorMsg('Failed to sync leaderboard with database.');
      } finally {
        setIsLoading(false);
      }
    };
    
    fetchStudentData();
  }, []);

  const getModeIcon = (mode) => {
    switch (mode) {
      case 'read_aloud':
        return <BookOpen className="w-4 h-4 text-purple-400" />;
      case 'qa':
        return <HelpCircle className="w-4 h-4 text-indigo-400" />;
      case 'conversation':
        return <MessageSquare className="w-4 h-4 text-pink-400" />;
      default:
        return <Award className="w-4 h-4 text-slate-400" />;
    }
  };

  const getModeLabel = (mode) => {
    switch (mode) {
      case 'read_aloud': return 'Read Aloud';
      case 'qa': return 'Q&A IELTS Mock';
      case 'conversation': return 'Dialogue Practice';
      default: return mode;
    }
  };

  const getRankBadge = (index) => {
    if (index === 0) return <span className="text-xl" title="1st Place (Gold)">🥇</span>;
    if (index === 1) return <span className="text-xl" title="2nd Place (Silver)">🥈</span>;
    if (index === 2) return <span className="text-xl" title="3rd Place (Bronze)">🥉</span>;
    return <span className="text-xs font-bold text-slate-500 font-mono">#{index + 1}</span>;
  };

  // Process leaderboard sorting based on mode tab
  const getSortedRankings = (mode) => {
    return classRankings
      .filter(item => item.mode === mode)
      .sort((a, b) => b.score - a.score);
  };

  const formatScoreDisplay = (mode, score, feedback) => {
    if (mode === 'read_aloud') {
      return (
        <div className="flex flex-col">
          <span className="text-white font-bold text-sm">{score}% Accuracy</span>
          {feedback?.word_error_rate !== undefined && (
            <span className="text-[10px] text-slate-400">WER: {(feedback.word_error_rate * 100).toFixed(0)}%</span>
          )}
        </div>
      );
    }
    return (
      <div className="flex flex-col">
        <span className="text-white font-bold text-sm">IELTS Band {score.toFixed(1)}</span>
        <span className="text-[10px] text-slate-400">Speaking Level</span>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      
      {/* Classroom Status Bar */}
      <div className="glass-panel p-6 rounded-2xl border border-emerald-500/20 glow-green flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div className="space-y-1">
          <div className="flex items-center space-x-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
            <h4 className="font-bold text-white text-base">Classroom Synced Online</h4>
          </div>
          <p className="text-xs text-emerald-200/80 leading-relaxed max-w-xl">
            Logged scorecards are shared with your class, <strong>{studentProfile?.class?.class_name || 'Classroom'}</strong>. You can view your peer rankings or track your progress below.
          </p>
        </div>
      </div>

      <div className="glass-panel rounded-2xl border-slate-800 overflow-hidden shadow-xl">
        <div className="px-6 py-4 bg-slate-900/60 border-b border-slate-850 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div className="flex space-x-2 bg-slate-950 p-1 rounded-xl border border-slate-850 self-start">
            <button
              onClick={() => setActiveSource('global')}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-bold transition ${
                activeSource === 'global' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Award className="w-3.5 h-3.5" />
              <span>Class Leaderboard</span>
            </button>
            <button
              onClick={() => setActiveSource('local')}
              className={`flex items-center space-x-1.5 px-4 py-2 rounded-lg text-xs font-bold transition ${
                activeSource === 'local' ? 'bg-purple-600 text-white shadow-md' : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>My Assessment History</span>
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="py-20 flex justify-center">
            <Spinner message="Connecting to database..." />
          </div>
        ) : errorMsg ? (
          <div className="p-8 text-center text-rose-400 text-sm">
            {errorMsg}
          </div>
        ) : (
          <div>
            {/* Global Class Rankings Tab */}
            {activeSource === 'global' && (
              <div>
                <div className="flex border-b border-slate-850 bg-slate-900/20 px-6">
                  {['read_aloud', 'qa', 'conversation'].map(mode => (
                    <button
                      key={mode}
                      onClick={() => setActiveModeTab(mode)}
                      className={`flex items-center space-x-1.5 py-3.5 px-4 text-xs font-bold border-b-2 -mb-px transition ${
                        activeModeTab === mode 
                          ? 'border-purple-500 text-purple-400 font-extrabold' 
                          : 'border-transparent text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {getModeIcon(mode)}
                      <span>{getModeLabel(mode)}</span>
                    </button>
                  ))}
                </div>

                {getSortedRankings(activeModeTab).length === 0 ? (
                  <div className="p-16 text-center space-y-2 text-slate-500">
                    <Award className="w-10 h-10 mx-auto text-slate-700" />
                    <h5 className="text-sm font-bold">No records found</h5>
                    <p className="text-xs max-w-xs mx-auto">Be the first to complete a practice test in {getModeLabel(activeModeTab)} to rank on the leaderboard!</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-900/30 text-slate-400 text-[10px] font-semibold uppercase tracking-wider border-b border-slate-850">
                          <th className="py-3.5 px-6 w-16 text-center">Rank</th>
                          <th className="py-3.5 px-6">Student</th>
                          <th className="py-3.5 px-6">Date</th>
                          <th className="py-3.5 px-6">Score</th>
                          <th className="py-3.5 px-6">Feedback Summary</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-850 text-slate-300 text-xs">
                        {getSortedRankings(activeModeTab).map((record, index) => (
                          <tr key={record.id} className="hover:bg-slate-900/40 transition">
                            <td className="py-4 px-6 text-center">{getRankBadge(index)}</td>
                            <td className="py-4 px-6 font-bold text-white">{record.student?.full_name}</td>
                            <td className="py-4 px-6 text-slate-400 font-mono text-[10px]">
                              {new Date(record.created_at).toLocaleString()}
                            </td>
                            <td className="py-4 px-6">
                              {formatScoreDisplay(record.mode, record.score, record.feedback)}
                            </td>
                            <td className="py-4 px-6 max-w-xs truncate text-slate-400 italic" title={record.feedback?.feedback || record.feedback}>
                              {record.feedback?.feedback || record.feedback}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* Local Session History Tab */}
            {activeSource === 'local' && (
              <div>
                {localHistory.length === 0 ? (
                  <div className="p-16 text-center space-y-2 text-slate-500">
                    <Calendar className="w-12 h-12 text-slate-700 mx-auto" />
                    <h5 className="text-sm font-bold text-slate-400">No activities logged yet</h5>
                    <p className="text-xs text-slate-500">Your practice assessment scores will appear here after you finish your tests.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-900/30 text-slate-400 text-[10px] font-semibold uppercase tracking-wider border-b border-slate-850">
                          <th className="py-3 px-6">Date & Time</th>
                          <th className="py-3 px-6">Assessment Mode</th>
                          <th className="py-3 px-6">Score</th>
                          <th className="py-3 px-6">Feedback Summary</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-850 text-slate-300 text-xs">
                        {localHistory.map((record) => (
                          <tr key={record.id} className="hover:bg-slate-900/40 transition">
                            <td className="py-4 px-6 text-slate-400 font-mono text-[10px]">
                              {new Date(record.created_at).toLocaleString()}
                            </td>
                            <td className="py-4 px-6 font-semibold text-white">
                              <div className="flex items-center space-x-2">
                                {getModeIcon(record.mode)}
                                <span>{getModeLabel(record.mode)}</span>
                              </div>
                            </td>
                            <td className="py-4 px-6">
                              {formatScoreDisplay(record.mode, record.score, record.feedback)}
                            </td>
                            <td className="py-4 px-6 max-w-xs truncate text-slate-400 italic" title={record.feedback?.feedback || record.feedback}>
                              {record.feedback?.feedback || record.feedback}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
export default Leaderboard;
