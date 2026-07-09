import React from 'react';
import { Users, BookOpen, Clock } from 'lucide-react';

function formatDuration(totalSeconds) {
  if (!totalSeconds) return '0m';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function OverviewTab({ classesList, allStudents, allAssessments, activityData, formatScoreDetails }) {
  const totalPracticeTime = activityData ? activityData.reduce((acc, log) => acc + log.active_seconds, 0) : 0;
  return (
    <div className="space-y-8">
      {/* Stats cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex justify-between items-center">
          <div>
            <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Active Classes</span>
            <span className="text-3xl font-extrabold text-white mt-1 block">{classesList.length}</span>
          </div>
          <div className="p-3 bg-purple-600/10 text-purple-400 border border-purple-500/20 rounded-2xl">
            <Users className="w-6 h-6" />
          </div>
        </div>

        <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex justify-between items-center">
          <div>
            <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Enrolled Students</span>
            <span className="text-3xl font-extrabold text-white mt-1 block">{allStudents.length}</span>
          </div>
          <div className="p-3 bg-indigo-600/10 text-indigo-400 border border-indigo-500/20 rounded-2xl">
            <Users className="w-6 h-6" />
          </div>
        </div>

        <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex justify-between items-center">
          <div>
            <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Total Assessments</span>
            <span className="text-3xl font-extrabold text-white mt-1 block">{allAssessments.length}</span>
          </div>
          <div className="p-3 bg-pink-600/10 text-pink-400 border border-pink-500/20 rounded-2xl">
            <BookOpen className="w-6 h-6" />
          </div>
        </div>

        <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex justify-between items-center">
          <div>
            <span className="block text-xs font-semibold text-slate-500 uppercase tracking-wider">Practice Time</span>
            <span className="text-3xl font-extrabold text-white mt-1 block">{formatDuration(totalPracticeTime)}</span>
          </div>
          <div className="p-3 bg-amber-600/10 text-amber-400 border border-amber-500/20 rounded-2xl">
            <Clock className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Score Chart list / Activity */}
      <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
        <h3 className="font-bold text-base text-white">Recent Student Activity</h3>
        {allAssessments.length === 0 ? (
          <p className="text-slate-500 text-xs py-10 text-center">No assessments taken yet. Share the class codes to get started!</p>
        ) : (
          <div className="divide-y divide-slate-850 text-xs">
            {allAssessments.slice(0, 5).map(item => (
              <div key={item.id} className="py-3.5 flex justify-between items-center">
                <div className="flex items-center space-x-3">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500"></div>
                  <div>
                    <span className="font-bold text-white block text-sm">{item.student?.full_name}</span>
                    <span className="text-[10px] text-slate-500 font-mono">Class: {item.student?.class?.class_name} | ID: {item.student?.school_id}</span>
                  </div>
                </div>
                <div className="text-right">
                  {formatScoreDetails(item.mode, item.feedback)}
                  <span className="text-[9px] text-slate-500 font-mono">{new Date(item.created_at).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
