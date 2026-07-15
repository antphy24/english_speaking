import React, { useMemo, useState, useEffect } from 'react';
import { Clock, Users, TrendingUp } from 'lucide-react';

function formatDuration(totalSeconds) {
  if (!totalSeconds) return '0m';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function getRelativeTime(dateString) {
  if (!dateString) return 'Never';
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  const diffInSeconds = (new Date(dateString).getTime() - new Date().getTime()) / 1000;
  
  if (Math.abs(diffInSeconds) < 60) return rtf.format(Math.round(diffInSeconds), 'second');
  if (Math.abs(diffInSeconds) < 3600) return rtf.format(Math.round(diffInSeconds / 60), 'minute');
  if (Math.abs(diffInSeconds) < 86400) return rtf.format(Math.round(diffInSeconds / 3600), 'hour');
  return rtf.format(Math.round(diffInSeconds / 86400), 'day');
}

export function ActivityTab({
  classesList,
  allStudents,
  activityData,
  selectedActivityClass,
  setSelectedActivityClass,
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  useEffect(() => {
    setCurrentPage(1);
  }, [selectedActivityClass]);

  // Aggregate data per student
  const aggregatedData = useMemo(() => {
    const studentMap = new Map();
    
    // Initialize map with all students
    allStudents.forEach(student => {
      // Filter out students not in the selected class if a class is selected
      if (selectedActivityClass !== 'all' && student.class_id !== selectedActivityClass) {
        return;
      }
      studentMap.set(student.id, {
        student,
        totalActiveSeconds: 0,
        totalIdleSeconds: 0,
        lastActive: null,
        modeBreakdown: {
          read_aloud: 0,
          qa: 0,
          conversation: 0,
          debate: 0,
          other: 0
        },
        todayActiveSeconds: 0,
        weekActiveSeconds: 0,
      });
    });

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);

    // Aggregate activity logs
    activityData.forEach(log => {
      const entry = studentMap.get(log.student_id);
      if (!entry) return;

      entry.totalActiveSeconds += log.active_seconds;
      entry.totalIdleSeconds += log.idle_seconds;

      const logDate = new Date(log.created_at);
      if (!entry.lastActive || logDate > entry.lastActive) {
        entry.lastActive = logDate;
      }

      if (logDate >= todayStart) {
        entry.todayActiveSeconds += log.active_seconds;
      }
      if (logDate >= weekStart) {
        entry.weekActiveSeconds += log.active_seconds;
      }

      const mode = log.mode || 'other';
      if (entry.modeBreakdown[mode] !== undefined) {
        entry.modeBreakdown[mode] += log.active_seconds;
      } else {
        entry.modeBreakdown.other += log.active_seconds;
      }
    });

    return Array.from(studentMap.values());
  }, [allStudents, activityData, selectedActivityClass]);

  // Sort by This Week active seconds descending by default
  const sortedData = useMemo(() => {
    return [...aggregatedData].sort((a, b) => b.weekActiveSeconds - a.weekActiveSeconds);
  }, [aggregatedData]);

  // Overall Stats
  const stats = useMemo(() => {
    let totalActive = 0;
    let studentsWithActivity = 0;
    let activeThisWeek = new Set();
    
    const weekStart = new Date();
    weekStart.setDate(weekStart.getDate() - 7);

    activityData.forEach(log => {
      totalActive += log.active_seconds;
      if (log.active_seconds > 0) studentsWithActivity++;
      if (new Date(log.created_at) >= weekStart) {
        activeThisWeek.add(log.student_id);
      }
    });

    const avgActive = studentsWithActivity > 0 ? totalActive / allStudents.length : 0; // average across ALL students

    return {
      totalActive,
      avgActive,
      activeThisWeekCount: activeThisWeek.size
    };
  }, [activityData, allStudents.length]);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="glass-panel p-5 rounded-2xl border border-slate-800 flex items-center space-x-4">
          <div className="p-3 bg-indigo-500/20 text-indigo-400 rounded-xl">
            <Clock size={24} />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{formatDuration(stats.totalActive)}</div>
            <div className="text-sm font-medium text-slate-400">Total Active Time</div>
          </div>
        </div>
        
        <div className="glass-panel p-5 rounded-2xl border border-slate-800 flex items-center space-x-4">
          <div className="p-3 bg-purple-500/20 text-purple-400 rounded-xl">
            <TrendingUp size={24} />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{formatDuration(stats.avgActive)}</div>
            <div className="text-sm font-medium text-slate-400">Avg Per Student</div>
          </div>
        </div>

        <div className="glass-panel p-5 rounded-2xl border border-slate-800 flex items-center space-x-4">
          <div className="p-3 bg-emerald-500/20 text-emerald-400 rounded-xl">
            <Users size={24} />
          </div>
          <div>
            <div className="text-2xl font-bold text-white">{stats.activeThisWeekCount}</div>
            <div className="text-sm font-medium text-slate-400">Students Active This Week</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div className="flex space-x-4 items-center">
          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Filter by Class</label>
          <select
            value={selectedActivityClass}
            onChange={(e) => setSelectedActivityClass(e.target.value)}
            className="px-4 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 min-w-[200px]"
          >
            <option value="all">All Classes</option>
            {classesList.map(c => (
              <option key={c.id} value={c.id}>{c.class_name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Activity Table */}
      <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-900/40 text-[10px] font-bold text-slate-400 uppercase tracking-wider border-b border-slate-800">
                <th className="px-6 py-4">Student</th>
                <th className="px-6 py-4">Today</th>
                <th className="px-6 py-4">This Week</th>
                <th className="px-6 py-4">All Time</th>
                <th className="px-6 py-4">Last Active</th>
                <th className="px-6 py-4">Idle Ratio</th>
                <th className="px-6 py-4 min-w-[150px]">Mode Breakdown</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-850/60">
              {sortedData.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-slate-500">
                    No student activity recorded yet. Activity data will appear once students begin practicing.
                  </td>
                </tr>
              ) : (
                sortedData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((row) => {
                  const totalSeconds = row.totalActiveSeconds + row.totalIdleSeconds;
                  const idleRatio = totalSeconds > 0 ? (row.totalIdleSeconds / totalSeconds) * 100 : 0;
                  
                  let ratioColor = 'text-emerald-400';
                  if (idleRatio > 60) ratioColor = 'text-rose-400';
                  else if (idleRatio >= 30) ratioColor = 'text-amber-400';

                  const getWidth = (val) => row.totalActiveSeconds > 0 ? `${(val / row.totalActiveSeconds) * 100}%` : '0%';

                  return (
                    <tr key={row.student.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-bold text-white text-sm">{row.student.full_name}</div>
                        <div className="text-xs text-slate-500">{row.student.class?.class_name}</div>
                      </td>
                      <td className="px-6 py-4 text-white text-sm">
                        {formatDuration(row.todayActiveSeconds)}
                      </td>
                      <td className="px-6 py-4 text-white text-sm font-medium">
                        {formatDuration(row.weekActiveSeconds)}
                      </td>
                      <td className="px-6 py-4 text-white text-sm">
                        {formatDuration(row.totalActiveSeconds)}
                      </td>
                      <td className="px-6 py-4 text-slate-400 text-sm">
                        {getRelativeTime(row.lastActive)}
                      </td>
                      <td className={`px-6 py-4 text-sm font-medium ${ratioColor}`}>
                        {totalSeconds > 0 ? `${Math.round(idleRatio)}%` : '-'}
                      </td>
                      <td className="px-6 py-4">
                        {row.totalActiveSeconds > 0 ? (
                          <div className="flex h-2.5 w-full bg-slate-800 rounded-full overflow-hidden">
                            <div className="bg-purple-500" style={{ width: getWidth(row.modeBreakdown.read_aloud) }} title="Read Aloud" />
                            <div className="bg-indigo-500" style={{ width: getWidth(row.modeBreakdown.qa) }} title="Q&A" />
                            <div className="bg-pink-500" style={{ width: getWidth(row.modeBreakdown.conversation) }} title="Conversation" />
                            <div className="bg-amber-500" style={{ width: getWidth(row.modeBreakdown.debate) }} title="Debate" />
                          </div>
                        ) : (
                          <div className="text-xs text-slate-600">No activity</div>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
        {sortedData.length > itemsPerPage && (
          <div className="flex items-center justify-between px-6 py-4 bg-slate-900/40 border-t border-slate-850">
            <span className="text-xs text-slate-400">
              Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, sortedData.length)} of {sortedData.length} entries
            </span>
            <div className="flex space-x-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 text-xs font-medium rounded-md bg-slate-800 text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage(p => p + 1)}
                disabled={currentPage * itemsPerPage >= sortedData.length}
                className="px-3 py-1 text-xs font-medium rounded-md bg-slate-800 text-slate-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-slate-700"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
