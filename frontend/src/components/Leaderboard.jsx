import React, { useState, useEffect } from 'react';
import { supabase } from '../utils/supabaseClient';
import { Award, BookOpen, HelpCircle, MessageSquare, Gavel, Lightbulb, RefreshCw, Calendar, User } from 'lucide-react';
import Spinner from './UI/Spinner';
import { modeLabel, MODE_ORDER } from '../utils/modes';

export function Leaderboard({ student }) {
  const [activeSource, setActiveSource] = useState('global'); // 'global' (class rankings) | 'local' (own history)
  const [activeModeTab, setActiveModeTab] = useState('read_aloud'); // 'read_aloud' | 'qa' | 'conversation'
  const [activeMaterialFilter, setActiveMaterialFilter] = useState('all');
  
  const [localHistory, setLocalHistory] = useState([]);
  const [classRankings, setClassRankings] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Reset page when tabs change
  useEffect(() => {
    setCurrentPage(1);
  }, [activeSource, activeModeTab, activeMaterialFilter]);

  // Reset material filter when mode changes
  useEffect(() => {
    setActiveMaterialFilter('all');
  }, [activeModeTab]);

  // Load student profile & local history
  useEffect(() => {
    const fetchStudentData = async () => {
      if (!student) return;
      setIsLoading(true);
      setErrorMsg('');
      try {
        // Fetch student's own assessments (session history)
        const { data: historyData, error: historyErr } = await supabase
          .from('assessments')
          .select('*')
          .eq('student_id', student.id)
          .order('created_at', { ascending: false });
          
        if (historyErr) throw historyErr;
        setLocalHistory(historyData);
        
        // Fetch class rankings
        if (student.class_id) {
          // 1. Get all students in this class
          const { data: classStudents, error: studentsErr } = await supabase
            .from('students')
            .select('id, full_name')
            .eq('class_id', student.class_id);
            
          if (studentsErr) throw studentsErr;
          const studentIds = classStudents.map(s => s.id);
          
          if (studentIds.length > 0) {
            // 2. Get assessments of these students filtered by mode
            const { data: classAssessments, error: assessErr } = await supabase
              .from('assessments')
              .select('*, student:students(full_name)')
              .in('student_id', studentIds)
              .eq('mode', activeModeTab);
              
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
  }, [student, activeModeTab]);

  const getModeIcon = (mode) => {
    switch (mode) {
      case 'read_aloud':
        return <BookOpen className="w-4 h-4 text-ink-subtle" aria-hidden="true" />;
      case 'qa':
        return <HelpCircle className="w-4 h-4 text-ink-subtle" aria-hidden="true" />;
      case 'conversation':
        return <MessageSquare className="w-4 h-4 text-ink-subtle" aria-hidden="true" />;
      case 'debate':
        return <Gavel className="w-4 h-4 text-ink-subtle" aria-hidden="true" />;
      case 'mattering':
        return <Lightbulb className="w-4 h-4 text-ink-subtle" aria-hidden="true" />;
      default:
        return <Award className="w-4 h-4 text-ink-subtle" aria-hidden="true" />;
    }
  };

  const getModeLabel = (mode) => {
    switch (mode) {
      case 'read_aloud':
      case 'qa':
      case 'conversation':
      case 'debate':
      case 'mattering':
        return modeLabel(mode);
      default: return mode;
    }
  };

  const getRankBadge = (index) => {
    const top = ['bg-warning-tint text-warning', 'bg-surface-muted text-ink', 'bg-[rgb(180_83_9/0.12)] text-warning'];
    return (
      <span
        title={index < 3 ? `${['1st', '2nd', '3rd'][index]} place` : undefined}
        className={`inline-flex w-8 h-8 items-center justify-center rounded-full text-sm font-bold tabular-nums ${index < 3 ? top[index] : 'text-ink-subtle'}`}
      >
        {index + 1}
      </span>
    );
  };

  // Extract unique materials for the current mode
  const uniqueMaterials = Array.from(new Set(
    classRankings
      .filter(item => item.mode === activeModeTab)
      .map(item => item.feedback?.material_title || item.feedback?.motion || 'Default Material')
      .filter(Boolean)
  )).sort();

  // Process leaderboard sorting based on mode tab
  const getSortedRankings = (mode) => {
    return classRankings
      .filter(item => item.mode === mode)
      .filter(item => {
        if (activeSource === 'local') return true; // Keep local history unfiltered by material unless desired
        const materialTitle = item.feedback?.material_title || item.feedback?.motion || 'Default Material';
        return activeMaterialFilter === 'all' || materialTitle === activeMaterialFilter;
      })
      .sort((a, b) => b.score - a.score);
  };

  const formatScoreDisplay = (mode, score, feedback) => {
    if (mode === 'read_aloud') {
      return (
        <div className="flex flex-col">
          <span className="text-ink font-semibold text-sm tabular-nums">{score}% Accuracy</span>
          {feedback?.word_error_rate !== undefined && (
            <span className="text-xs text-ink-muted">WER: {(feedback.word_error_rate * 100).toFixed(0)}%</span>
          )}
        </div>
      );
    }
    if (mode === 'mattering') {
      return (
        <div className="flex flex-col">
          <span className="text-ink font-semibold text-sm tabular-nums">{Math.round(score)} Speaker Score</span>
          <span className="text-xs text-ink-muted">{feedback?.band || 'Scale 69-81'}</span>
        </div>
      );
    }
    if (mode === 'debate') {
      return (
        <div className="flex flex-col">
          <span className="text-ink font-semibold text-sm tabular-nums">{Math.round(score)}/100 Debate</span>
          {feedback?.matter_score !== undefined && (
            <span className="text-xs text-ink-muted">
              Matter: {feedback.matter_score} | Manner: {feedback.manner_score} | Method: {feedback.method_score}
            </span>
          )}
        </div>
      );
    }
    return (
      <div className="flex flex-col">
        <span className="text-ink font-semibold text-sm tabular-nums">{Math.round(score)}/100 Score</span>
        <span className="text-xs text-ink-muted">Speaking Level</span>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      
      <p className="text-sm text-ink-muted">
        Scores are shared with your class, <strong className="text-ink">{student?.class?.class_name || 'Classroom'}</strong>.
      </p>

      <div className="bg-surface border border-line rounded-2xl overflow-hidden shadow-card">
        <div className="px-3 md:px-6 py-3 md:py-4 bg-surface-muted border-b border-line flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
          <div className="flex space-x-2 bg-surface p-1 rounded-xl border border-line self-stretch sm:self-start">
            <button
              onClick={() => setActiveSource('global')}
              className={`flex flex-1 sm:flex-none items-center justify-center space-x-1.5 px-3 md:px-4 min-h-[40px] rounded-lg text-sm font-semibold transition whitespace-nowrap ${
                activeSource === 'global' ? 'bg-brand text-white' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <Award className="w-3.5 h-3.5" />
              <span>Class ranking</span>
            </button>
            <button
              onClick={() => setActiveSource('local')}
              className={`flex flex-1 sm:flex-none items-center justify-center space-x-1.5 px-3 md:px-4 min-h-[40px] rounded-lg text-sm font-semibold transition whitespace-nowrap ${
                activeSource === 'local' ? 'bg-brand text-white' : 'text-ink-muted hover:text-ink'
              }`}
            >
              <User className="w-3.5 h-3.5" />
              <span>My history</span>
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="py-20 flex justify-center">
            <Spinner message="Loading scores..." />
          </div>
        ) : errorMsg ? (
          <div className="p-5 md:p-8 text-center text-danger text-sm">
            {errorMsg}
          </div>
        ) : (
          <div>
            {/* Global Class Rankings Tab */}
            {activeSource === 'global' && (
              <div>
                <div className="border-b border-line bg-surface-muted px-3 md:px-6">
                  <div role="tablist" aria-label="Practice mode" className="flex flex-wrap gap-x-1">
                    {MODE_ORDER.map(mode => (
                      <button
                        key={mode}
                        type="button"
                        role="tab"
                        aria-selected={activeModeTab === mode}
                        onClick={() => setActiveModeTab(mode)}
                        className={`flex items-center gap-1.5 py-3 px-3 text-sm font-semibold border-b-2 -mb-px transition-colors whitespace-nowrap ${
                          activeModeTab === mode
                            ? 'border-brand text-brand-ink'
                            : 'border-transparent text-ink-muted hover:text-ink'
                        }`}
                      >
                        {getModeIcon(mode)}
                        <span>{getModeLabel(mode)}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {uniqueMaterials.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 px-4 md:px-6 py-3 border-b border-line">
                    <label htmlFor="leaderboard-material" className="text-sm font-semibold text-ink-muted">Material</label>
                    <select
                      id="leaderboard-material"
                      value={activeMaterialFilter}
                      onChange={(e) => setActiveMaterialFilter(e.target.value)}
                      className="bg-surface border border-line-strong text-ink text-sm rounded-lg px-2.5 min-h-[40px] focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand-ring flex-1 min-w-0 sm:flex-none sm:w-72"
                    >
                      <option value="all">All materials</option>
                      {uniqueMaterials.map(mat => (
                        <option key={mat} value={mat}>{mat}</option>
                      ))}
                    </select>
                  </div>
                )}

                {getSortedRankings(activeModeTab).length === 0 ? (
                  <div className="px-6 py-12 md:p-16 text-center space-y-2 text-ink-subtle">
                    <Award className="w-10 h-10 mx-auto text-ink-subtle" />
                    <h5 className="text-base font-semibold text-ink">No scores yet</h5>
                    <p className="text-sm max-w-xs mx-auto">Be the first to complete a practice test in {getModeLabel(activeModeTab)} to rank on the leaderboard!</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-surface-muted text-ink-muted text-[13px] font-semibold border-b border-line">
                          <th className="py-3.5 px-2 md:px-6 w-12 md:w-16 text-center">Rank</th>
                          <th className="py-3.5 px-2 md:px-6">Student</th>
                          <th className="hidden md:table-cell py-3.5 px-6">Material</th>
                          <th className="hidden md:table-cell py-3.5 px-6">Date</th>
                          <th className="py-3.5 px-3 md:px-6">Score</th>
                          <th className="hidden md:table-cell py-3.5 px-6">Feedback Summary</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line text-ink-muted text-sm">
                        {getSortedRankings(activeModeTab).slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((record, index) => (
                          <tr key={record.id} className="hover:bg-surface-muted transition">
                            <td className="py-3 md:py-4 px-2 md:px-6 text-center">{getRankBadge((currentPage - 1) * itemsPerPage + index)}</td>
                            <td className="py-3 md:py-4 px-2 md:px-6 font-bold text-ink">
                              {record.student?.full_name}
                              {/* Phones: material and date sit under the name instead of in their own columns */}
                              <div className="md:hidden mt-0.5 text-xs font-normal text-ink-muted line-clamp-1">
                                {record.feedback?.material_title || record.feedback?.motion || 'Default Material'}
                              </div>
                              <div className="md:hidden text-xs font-normal tabular-nums text-ink-subtle">
                                {new Date(record.created_at).toLocaleDateString()}
                              </div>
                            </td>
                            <td className="hidden md:table-cell py-4 px-6 text-ink-muted font-medium truncate max-w-[150px]" title={record.feedback?.material_title || record.feedback?.motion || 'Default Material'}>
                              {record.feedback?.material_title || record.feedback?.motion || 'Default Material'}
                            </td>
                            <td className="hidden md:table-cell py-4 px-6 text-ink-muted tabular-nums text-xs">
                              {new Date(record.created_at).toLocaleString()}
                            </td>
                            <td className="py-3 md:py-4 px-3 md:px-6">
                              {formatScoreDisplay(record.mode, record.score, record.feedback)}
                            </td>
                            <td className="hidden md:table-cell py-4 px-6 max-w-xs truncate text-ink-muted italic" title={record.feedback?.feedback || record.feedback?.overall_feedback || (typeof record.feedback === 'string' ? record.feedback : 'See detailed scores')}>
                              {record.feedback?.feedback || record.feedback?.overall_feedback || (typeof record.feedback === 'string' ? record.feedback : 'See detailed scores')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {getSortedRankings(activeModeTab).length > itemsPerPage && (
                  <div className="flex items-center justify-between gap-3 px-3 md:px-6 py-3 md:py-4 bg-surface-muted border-t border-line">
                    <span className="text-[13px] text-ink-muted">
                      Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, getSortedRankings(activeModeTab).length)} of {getSortedRankings(activeModeTab).length} entries
                    </span>
                    <div className="flex space-x-2 shrink-0">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="min-h-[40px] px-3.5 text-sm font-semibold rounded-lg bg-surface border border-line-strong text-ink disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-muted"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => setCurrentPage(p => p + 1)}
                        disabled={currentPage * itemsPerPage >= getSortedRankings(activeModeTab).length}
                        className="min-h-[40px] px-3.5 text-sm font-semibold rounded-lg bg-surface border border-line-strong text-ink disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-muted"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Local Session History Tab */}
            {activeSource === 'local' && (
              <div>
                {localHistory.length === 0 ? (
                  <div className="px-6 py-12 md:p-16 text-center space-y-2 text-ink-subtle">
                    <Calendar className="w-12 h-12 text-ink-subtle mx-auto" />
                    <h5 className="text-base font-semibold text-ink">No attempts yet</h5>
                    <p className="text-sm text-ink-muted">Your practice assessment scores will appear here after you finish your tests.</p>
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-surface-muted text-ink-muted text-[13px] font-semibold border-b border-line">
                          <th className="hidden md:table-cell py-3 px-6">Date & Time</th>
                          <th className="py-3 px-3 md:px-6"><span className="md:hidden">Attempt</span><span className="hidden md:inline">Assessment Mode</span></th>
                          <th className="hidden md:table-cell py-3 px-6">Material</th>
                          <th className="py-3 px-3 md:px-6">Score</th>
                          <th className="hidden md:table-cell py-3 px-6">Feedback Summary</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line text-ink-muted text-sm">
                        {localHistory.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((record) => (
                          <tr key={record.id} className="hover:bg-surface-muted transition">
                            <td className="hidden md:table-cell py-4 px-6 text-ink-muted tabular-nums text-xs">
                              {new Date(record.created_at).toLocaleString()}
                            </td>
                            <td className="py-3 md:py-4 px-3 md:px-6 font-semibold text-ink">
                              <div className="flex items-center space-x-2">
                                {getModeIcon(record.mode)}
                                <span>{getModeLabel(record.mode)}</span>
                              </div>
                              {/* Phones: material and date sit under the mode instead of in their own columns */}
                              <div className="md:hidden mt-0.5 text-xs font-normal text-ink-muted line-clamp-1">
                                {record.feedback?.material_title || record.feedback?.motion || 'Default Material'}
                              </div>
                              <div className="md:hidden text-xs font-normal tabular-nums text-ink-subtle">
                                {new Date(record.created_at).toLocaleString()}
                              </div>
                            </td>
                            <td className="hidden md:table-cell py-4 px-6 text-ink-muted font-medium truncate max-w-[150px]" title={record.feedback?.material_title || record.feedback?.motion || 'Default Material'}>
                              {record.feedback?.material_title || record.feedback?.motion || 'Default Material'}
                            </td>
                            <td className="py-3 md:py-4 px-3 md:px-6">
                              {formatScoreDisplay(record.mode, record.score, record.feedback)}
                            </td>
                            <td className="hidden md:table-cell py-4 px-6 max-w-xs truncate text-ink-muted italic" title={record.feedback?.feedback || record.feedback?.overall_feedback || (typeof record.feedback === 'string' ? record.feedback : 'See detailed scores')}>
                              {record.feedback?.feedback || record.feedback?.overall_feedback || (typeof record.feedback === 'string' ? record.feedback : 'See detailed scores')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
                {localHistory.length > itemsPerPage && (
                  <div className="flex items-center justify-between gap-3 px-3 md:px-6 py-3 md:py-4 bg-surface-muted border-t border-line">
                    <span className="text-[13px] text-ink-muted">
                      Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, localHistory.length)} of {localHistory.length} entries
                    </span>
                    <div className="flex space-x-2 shrink-0">
                      <button
                        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                        className="min-h-[40px] px-3.5 text-sm font-semibold rounded-lg bg-surface border border-line-strong text-ink disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-muted"
                      >
                        Previous
                      </button>
                      <button
                        onClick={() => setCurrentPage(p => p + 1)}
                        disabled={currentPage * itemsPerPage >= localHistory.length}
                        className="min-h-[40px] px-3.5 text-sm font-semibold rounded-lg bg-surface border border-line-strong text-ink disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface-muted"
                      >
                        Next
                      </button>
                    </div>
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
