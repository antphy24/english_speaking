import React from 'react';
import { Users, BookOpen, Clock } from 'lucide-react';

function formatDuration(totalSeconds) {
  if (!totalSeconds) return '0m';
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export function OverviewTab({ classesList, allStudents, allAssessments, activityData, formatScoreDetails, assessmentsCapped = false }) {
  const totalPracticeTime = activityData ? activityData.reduce((acc, log) => acc + log.active_seconds, 0) : 0;
  return (
    <div className="space-y-8">
      {/* Stats cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-6">
        <div className="bg-surface border border-line p-3.5 md:p-6 rounded-2xl border border-line flex justify-between items-center gap-2">
          <div>
            <span className="block text-xs md:text-xs font-semibold text-ink-subtle ">Active Classes</span>
            <span className="text-2xl md:text-3xl font-extrabold text-ink mt-1 block">{classesList.length}</span>
          </div>
          <div className="hidden sm:block p-3 bg-brand-tint text-brand-ink border border-brand/30 rounded-2xl">
            <Users className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-surface border border-line p-3.5 md:p-6 rounded-2xl border border-line flex justify-between items-center gap-2">
          <div>
            <span className="block text-xs md:text-xs font-semibold text-ink-subtle ">Enrolled Students</span>
            <span className="text-2xl md:text-3xl font-extrabold text-ink mt-1 block">{allStudents.length}</span>
          </div>
          <div className="hidden sm:block p-3 bg-brand-tint text-brand-ink border border-brand/30 rounded-2xl">
            <Users className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-surface border border-line p-3.5 md:p-6 rounded-2xl border border-line flex justify-between items-center gap-2">
          <div>
            <span className="block text-xs md:text-xs font-semibold text-ink-subtle ">Total Assessments</span>
            <span className="text-2xl md:text-3xl font-extrabold text-ink mt-1 block">{allAssessments.length.toLocaleString()}{assessmentsCapped ? '+' : ''}</span>
          </div>
          <div className="hidden sm:block p-3 bg-brand-tint text-brand-ink border border-brand/30 rounded-2xl">
            <BookOpen className="w-6 h-6" />
          </div>
        </div>

        <div className="bg-surface border border-line p-3.5 md:p-6 rounded-2xl border border-line flex justify-between items-center gap-2">
          <div>
            <span className="block text-xs md:text-xs font-semibold text-ink-subtle ">Practice Time</span>
            <span className="text-2xl md:text-3xl font-extrabold text-ink mt-1 block">{formatDuration(totalPracticeTime)}</span>
          </div>
          <div className="hidden sm:block p-3 bg-warning-tint text-warning border border-warning/30 rounded-2xl">
            <Clock className="w-6 h-6" />
          </div>
        </div>
      </div>

      {/* Score Chart list / Activity */}
      <div className="bg-surface border border-line p-4 md:p-6 rounded-2xl border border-line space-y-4">
        <h3 className="font-bold text-base text-ink">Recent Student Activity</h3>
        {allAssessments.length === 0 ? (
          <p className="text-ink-subtle text-xs py-10 text-center">No assessments taken yet. Share the class codes to get started!</p>
        ) : (
          <div className="divide-y divide-line text-xs">
            {allAssessments.slice(0, 5).map(item => (
              <div key={item.id} className="py-3.5 flex justify-between items-center gap-3">
                <div className="flex items-center space-x-3 min-w-0">
                  <div className="w-2.5 h-2.5 rounded-full bg-success shrink-0"></div>
                  <div className="min-w-0">
                    <span className="font-bold text-ink block text-sm">{item.student?.full_name}</span>
                    <span className="text-xs text-ink-subtle tabular-nums">Class: {item.student?.class?.class_name} | ID: {item.student?.school_id}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {formatScoreDetails(item.mode, item.feedback)}
                  <span className="text-xs text-ink-subtle tabular-nums">{new Date(item.created_at).toLocaleString()}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
