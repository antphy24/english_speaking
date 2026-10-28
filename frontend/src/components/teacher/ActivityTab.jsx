import React, { useMemo, useState, useEffect } from 'react';
import { Clock, Users, TrendingUp, ArrowUp, ArrowDown, ChevronsUpDown } from 'lucide-react';
import { MODE_LABELS } from '../../utils/modes';

// One colour per practice mode (readable on light and dark backgrounds)
const MODE_COLORS = [
  ['read_aloud', MODE_LABELS.read_aloud, '#3446D4'],
  ['qa', MODE_LABELS.qa, '#0E9384'],
  ['conversation', MODE_LABELS.conversation, '#7A5AF8'],
  ['debate', MODE_LABELS.debate, '#DC6803'],
  ['mattering', MODE_LABELS.mattering, '#DD2590'],
];

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
          mattering: 0,
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

  // Sorting: click a column heading; click again to flip the order.
  // Default: most active this week first.
  const [sort, setSort] = useState({ key: 'week', dir: 'desc' });
  const SORT_VALUE = {
    name: (r) => (r.student.full_name || '').toLowerCase(),
    today: (r) => r.todayActiveSeconds,
    week: (r) => r.weekActiveSeconds,
    total: (r) => r.totalActiveSeconds,
    last: (r) => (r.lastActive ? new Date(r.lastActive).getTime() : 0),
    idle: (r) => {
      const t = r.totalActiveSeconds + r.totalIdleSeconds;
      return t > 0 ? r.totalIdleSeconds / t : -1;
    },
  };
  const sortedData = useMemo(() => {
    const get = SORT_VALUE[sort.key] || SORT_VALUE.week;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...aggregatedData].sort((a, b) => {
      const va = get(a);
      const vb = get(b);
      if (va < vb) return -1 * dir;
      if (va > vb) return 1 * dir;
      return 0;
    });
  }, [aggregatedData, sort]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeSort = (key) => {
    setSort((prev) => (prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'name' ? 'asc' : 'desc' }));
    setCurrentPage(1);
  };

  // A plain function (not a component) so the button keeps keyboard focus after sorting
  const sortHeader = (id, children, className = '') => {
    const active = sort.key === id;
    const Icon = !active ? ChevronsUpDown : sort.dir === 'asc' ? ArrowUp : ArrowDown;
    return (
      <th key={id} className={`px-6 py-3 ${className}`} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button
          type="button"
          onClick={() => changeSort(id)}
          className={`inline-flex items-center gap-1.5 -mx-1.5 px-1.5 py-1 rounded-md hover:bg-surface hover:text-ink transition-colors ${active ? 'text-ink' : ''}`}
        >
          {children}
          <Icon className={`w-3.5 h-3.5 ${active ? 'text-brand-ink' : 'opacity-50'}`} aria-hidden="true" />
        </button>
      </th>
    );
  };

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
        <div className="bg-surface border border-line p-5 rounded-2xl border border-line flex items-center space-x-4">
          <div className="p-3 bg-brand-tint text-brand-ink rounded-xl">
            <Clock size={24} />
          </div>
          <div>
            <div className="text-2xl font-bold text-ink">{formatDuration(stats.totalActive)}</div>
            <div className="text-sm font-medium text-ink-muted">Total Active Time</div>
          </div>
        </div>
        
        <div className="bg-surface border border-line p-5 rounded-2xl border border-line flex items-center space-x-4">
          <div className="p-3 bg-brand-tint text-brand-ink rounded-xl">
            <TrendingUp size={24} />
          </div>
          <div>
            <div className="text-2xl font-bold text-ink">{formatDuration(stats.avgActive)}</div>
            <div className="text-sm font-medium text-ink-muted">Avg Per Student</div>
          </div>
        </div>

        <div className="bg-surface border border-line p-5 rounded-2xl border border-line flex items-center space-x-4">
          <div className="p-3 bg-success-tint text-success rounded-xl">
            <Users size={24} />
          </div>
          <div>
            <div className="text-2xl font-bold text-ink">{stats.activeThisWeekCount}</div>
            <div className="text-sm font-medium text-ink-muted">Students Active This Week</div>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row justify-between gap-4">
        <div className="flex space-x-4 items-center">
          <label className="text-xs font-bold text-ink-muted ">Filter by Class</label>
          <select
            value={selectedActivityClass}
            onChange={(e) => setSelectedActivityClass(e.target.value)}
            className="px-4 py-2 bg-surface border border-line-strong rounded-[10px] text-ink text-sm focus:outline-none focus:border-brand focus:ring-4 focus:ring-brand-ring min-w-[200px]"
          >
            <option value="all">All Classes</option>
            {classesList.map(c => (
              <option key={c.id} value={c.id}>{c.class_name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Activity Table */}
      <div className="bg-surface border border-line rounded-2xl border border-line overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-surface-muted text-[13px] font-semibold text-ink-muted border-b border-line">
                {sortHeader('name', 'Student')}
                {sortHeader('today', 'Today')}
                {sortHeader('week', 'This week')}
                {sortHeader('total', 'All time')}
                {sortHeader('last', 'Last active')}
                {sortHeader('idle', 'Idle ratio')}
                <th className="px-6 py-3 min-w-[170px]">
                  Mode breakdown
                  <span className="flex flex-wrap gap-x-2.5 gap-y-1 mt-1.5 font-normal">
                    {MODE_COLORS.map(([key, label, color]) => (
                      <span key={key} className="inline-flex items-center gap-1 whitespace-nowrap">
                        <span className="w-2 h-2 rounded-sm" style={{ backgroundColor: color }} aria-hidden="true" />{label}
                      </span>
                    ))}
                  </span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sortedData.length === 0 ? (
                <tr>
                  <td colSpan="7" className="px-6 py-12 text-center text-ink-subtle">
                    No student activity recorded yet. Activity data will appear once students begin practicing.
                  </td>
                </tr>
              ) : (
                sortedData.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage).map((row) => {
                  const totalSeconds = row.totalActiveSeconds + row.totalIdleSeconds;
                  const idleRatio = totalSeconds > 0 ? (row.totalIdleSeconds / totalSeconds) * 100 : 0;
                  
                  let ratioColor = 'text-success';
                  if (idleRatio > 60) ratioColor = 'text-danger';
                  else if (idleRatio >= 30) ratioColor = 'text-warning';

                  const getWidth = (val) => row.totalActiveSeconds > 0 ? `${(val / row.totalActiveSeconds) * 100}%` : '0%';

                  return (
                    <tr key={row.student.id} className="hover:bg-surface-muted transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-bold text-ink text-sm">{row.student.full_name}</div>
                        <div className="text-xs text-ink-subtle">{row.student.class?.class_name}</div>
                      </td>
                      <td className="px-6 py-4 text-ink text-sm">
                        {formatDuration(row.todayActiveSeconds)}
                      </td>
                      <td className="px-6 py-4 text-ink text-sm font-medium">
                        {formatDuration(row.weekActiveSeconds)}
                      </td>
                      <td className="px-6 py-4 text-ink text-sm">
                        {formatDuration(row.totalActiveSeconds)}
                      </td>
                      <td className="px-6 py-4 text-ink-muted text-sm">
                        {getRelativeTime(row.lastActive)}
                      </td>
                      <td className={`px-6 py-4 text-sm font-medium ${ratioColor}`}>
                        {totalSeconds > 0 ? `${Math.round(idleRatio)}%` : '-'}
                      </td>
                      <td className="px-6 py-4">
                        {row.totalActiveSeconds > 0 ? (
                          <div className="flex h-2.5 w-full bg-surface-muted rounded-full overflow-hidden">
                            {MODE_COLORS.map(([key, label, color]) => (
                              <div key={key} style={{ width: getWidth(row.modeBreakdown[key]), backgroundColor: color }} title={label} />
                            ))}
                          </div>
                        ) : (
                          <div className="text-xs text-ink-subtle">No activity</div>
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
          <div className="flex items-center justify-between px-6 py-4 bg-surface-muted border-t border-line">
            <span className="text-xs text-ink-muted">
              Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, sortedData.length)} of {sortedData.length} entries
            </span>
            <div className="flex space-x-2">
              <button
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="px-3 py-1 text-xs font-medium rounded-md bg-surface-muted text-ink-muted disabled:opacity-50 disabled:cursor-not-allowed hover:bg-line"
              >
                Previous
              </button>
              <button
                onClick={() => setCurrentPage(p => p + 1)}
                disabled={currentPage * itemsPerPage >= sortedData.length}
                className="px-3 py-1 text-xs font-medium rounded-md bg-surface-muted text-ink-muted disabled:opacity-50 disabled:cursor-not-allowed hover:bg-line"
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
