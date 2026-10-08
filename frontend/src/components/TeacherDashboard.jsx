import useSwipeRow from '../hooks/useSwipeRow';
import React, { useState } from 'react';
import { 
  Plus, Users, Award, BookOpen, LogOut, 
  BarChart2, ShieldAlert, CheckCircle, RefreshCw 
} from 'lucide-react';
import Spinner from './UI/Spinner';
import { useTeacherData } from '../hooks/useTeacherData';
import { OverviewTab } from './teacher/OverviewTab';
import { ClassesTab } from './teacher/ClassesTab';
import { MaterialsTab } from './teacher/MaterialsTab';
import { ScoresTab } from './teacher/ScoresTab';
import { ActivityTab } from './teacher/ActivityTab';
import SubmissionReview from './UI/SubmissionReview';
import { supabaseTeacher } from '../utils/supabaseClient';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

// Helper score structures (Renders accuracy and IELTS details from JSON payload)
const formatScoreDetails = (mode, scoreData) => {
  if (!scoreData) return <span className="text-slate-500 font-mono text-xs">-</span>;
  
  if (mode === 'read_aloud') {
    return (
      <div className="flex flex-col">
        <span className="font-bold text-white text-xs">{scoreData.accuracy_score ?? 0}% Accuracy</span>
        {scoreData.word_error_rate !== undefined && (
          <span className="text-[10px] text-slate-500">WER: {(scoreData.word_error_rate * 100).toFixed(0)}%</span>
        )}
      </div>
    );
  }

  if (mode === 'mattering') {
    return (
      <div className="flex flex-col">
        <span className="font-bold text-white text-xs">{scoreData.speaker_score ?? '-'} Speaker Score</span>
        <span className="text-[10px] text-slate-500">{scoreData.band || 'Scale 69-81'}</span>
      </div>
    );
  }

  if (mode === 'debate') {
    const finalScore = scoreData.finalScore ?? scoreData.matter_score ?? 0;
    return (
      <div className="flex flex-col">
        <span className="font-bold text-white text-xs">{Math.round(finalScore)}/100 Debate</span>
        {scoreData.matter_score !== undefined && (
          <span className="text-[10px] text-slate-500">
            Matter {scoreData.matter_score} · Manner {scoreData.manner_score} · Method {scoreData.method_score}
          </span>
        )}
      </div>
    );
  }

  // QA and Conversation evaluation (0-100 scale)
  const subScores = mode === 'qa' 
    ? [scoreData.fluency, scoreData.lexical_resource, scoreData.grammatical_range, scoreData.pronunciation]
    : [scoreData.fluency_and_coherence, scoreData.lexical_resource, scoreData.grammatical_range, scoreData.pronunciation, scoreData.interactive_communication];
    
  const validScores = subScores.filter(s => s !== undefined && s !== null);
  if (validScores.length === 0) return <span className="text-slate-500 font-mono text-xs">-</span>;
  
  const rawAvg = validScores.reduce((a, b) => a + b, 0) / validScores.length;
  const scoreOutOf100 = Math.round(rawAvg);
  
  return (
    <div className="flex flex-col">
      <span className="font-bold text-white text-xs">{scoreOutOf100}/100 Score</span>
      <span className="text-[10px] text-slate-500">
        {mode === 'qa' ? 'Q&A Mock' : 'Dialogue Practice'}
      </span>
    </div>
  );
};

export function TeacherDashboard() {
  const swipeRef = useSwipeRow();
  const [activeTab, setActiveTab] = useState('overview');
  const [dateFilter, setDateFilter] = useState('30days');
  const [reviewRecord, setReviewRecord] = useState(null); // score row opened in the review panel
  const data = useTeacherData(dateFilter);

  if (data.loadingAuth) {
    return (
      <div className="min-h-screen bg-[#070b13] flex justify-center items-center">
        <Spinner message="Authenticating..." />
      </div>
    );
  }

  const TAB_TITLES = {
    overview: 'LMS Analytics Overview',
    classes: 'Classrooms & Enrollments',
    materials: 'Manage Practice Materials',
    scores: 'Assessments Score Ledger',
    activity: 'Student Activity Monitor',
  };

  const TAB_DESCRIPTIONS = {
    overview: 'Aggregated statistics and student assessment summaries.',
    classes: 'Create classrooms, generate class keys, and add students in bulk.',
    materials: 'Add class-specific custom texts for Read Aloud, prompts for Q&A, AI conversations, or debate and mattering motions.',
    scores: 'Deep-dive review of individual student speech assessments.',
    activity: 'Track active practice time and monitor idle behavior.',
  };

  return (
    <div className="min-h-screen bg-[#070b13] text-slate-100 flex flex-col md:flex-row relative">
      {/* Background neon glows */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#0d9488]/5 rounded-full blur-[100px]"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/5 rounded-full blur-[100px]"></div>
      </div>

      {/* Navigation: compact top bar on phones, sidebar on desktop */}
      <aside className="w-full md:w-64 bg-slate-950/95 md:bg-slate-950/80 border-b md:border-b-0 md:border-r border-slate-900 flex flex-col justify-between px-4 pt-3 pb-2 md:p-6 shrink-0 relative z-20">
        <div className="space-y-2.5 md:space-y-8">
          <div className="flex items-center justify-between gap-3 md:block md:space-y-8">
            <div className="flex items-center space-x-2 md:space-x-2.5 shrink-0">
              <div className="p-1.5 md:p-2 bg-indigo-600/10 border border-indigo-500/20 rounded-xl text-indigo-400">
                <Plus className="w-4 h-4 md:w-5 md:h-5" />
              </div>
              <span className="text-base md:text-lg font-extrabold text-white">
                HreF<span className="text-indigo-500 font-medium">Speak</span>
              </span>
            </div>

            <div className="flex items-center justify-end md:justify-start space-x-2 min-w-0 flex-1 md:p-3 md:bg-slate-900/40 md:rounded-xl md:border md:border-slate-850">
              <Users className="w-4 h-4 text-indigo-400 shrink-0" />
              <div className="text-[11px] md:text-xs truncate min-w-0 md:max-w-[150px] leading-tight md:leading-normal">
                <div className="text-slate-400 font-medium">Teacher Portal</div>
                <div className="text-white font-bold truncate">{data.teacher?.full_name}</div>
              </div>
            </div>

            {/* Sign out (phones) */}
            <button
              onClick={data.handleSignOut}
              aria-label="Log out"
              title="Log out"
              className="md:hidden shrink-0 w-10 h-10 flex items-center justify-center bg-slate-900 border border-slate-800 rounded-xl text-slate-400 active:text-rose-400 active:bg-rose-950/20"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>

          {/* Swipeable row on phones, vertical list on desktop */}
          <nav ref={swipeRef} className="no-scrollbar flex md:flex-col gap-1.5 md:gap-0 md:space-y-1 overflow-x-auto md:overflow-visible -mx-4 px-4 md:mx-0 md:px-0 pb-1 md:pb-0">
            <span className="hidden md:block text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">Management</span>
            
            {[
              { key: 'overview', icon: BarChart2, label: 'Performance Overview', shortLabel: 'Overview' },
              { key: 'classes', icon: Users, label: 'Classes & Enrollment', shortLabel: 'Classes' },
              { key: 'materials', icon: BookOpen, label: 'Class Materials', shortLabel: 'Materials' },
              { key: 'scores', icon: Award, label: 'Assessment Records', shortLabel: 'Records' },
              { key: 'activity', icon: BarChart2, label: 'Activity Monitor', shortLabel: 'Activity' },
            ].map(({ key, icon: Icon, label, shortLabel }) => (
              <button
                key={key}
                onClick={(e) => {
                  setActiveTab(key);
                  e.currentTarget.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                }}
                className={`flex items-center shrink-0 whitespace-nowrap space-x-2 md:space-x-3 px-3.5 md:px-4 py-2.5 md:py-3 rounded-xl text-xs font-bold transition ${
                  activeTab === key
                    ? 'bg-indigo-600/15 border border-indigo-500/20 text-white font-extrabold'
                    : 'border border-slate-800 md:border-transparent text-slate-400 hover:bg-slate-900/40 hover:text-slate-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span className="md:hidden">{shortLabel}</span>
                <span className="hidden md:inline">{label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="hidden md:block pt-6 border-t border-slate-900 mt-6">
          <button
            onClick={data.handleSignOut}
            className="w-full flex items-center justify-between px-4 py-2 bg-slate-900 hover:bg-rose-950/20 border border-slate-850 hover:border-rose-950/50 rounded-xl text-xs font-bold text-slate-400 hover:text-rose-400 transition cursor-pointer"
          >
            <span>Log Out</span>
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 w-full min-w-0 p-4 md:p-10 md:overflow-y-auto max-w-6xl relative z-10">
        <header className="mb-5 md:mb-8 flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <div className="min-w-0">
            <h2 className="text-xl md:text-2xl font-bold text-white tracking-tight">
              {TAB_TITLES[activeTab]}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {TAB_DESCRIPTIONS[activeTab]}
            </p>
          </div>
          
          <div className="flex items-center space-x-2 md:space-x-3 shrink-0">
            <select 
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="flex-1 sm:flex-none min-w-0 bg-slate-900 border border-slate-800 text-white text-xs rounded-xl px-3 py-2 outline-none focus:border-indigo-500"
            >
              <option value="7days">Last 7 Days</option>
              <option value="30days">Last 30 Days</option>
              <option value="all">All Time</option>
            </select>

            <button 
              onClick={data.loadDashboardData}
              disabled={data.loadingData}
              className="p-3 md:p-2 shrink-0 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl transition cursor-pointer"
              title="Refresh logs"
            >
              <RefreshCw className={`w-4 h-4 ${data.loadingData ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </header>

        {data.actionError && (
          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-sm text-rose-400 flex items-center space-x-2 animate-fadeIn">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <span>{data.actionError}</span>
          </div>
        )}

        {data.actionSuccess && (
          <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-sm text-emerald-400 flex items-center space-x-2 animate-fadeIn">
            <CheckCircle className="w-5 h-5 shrink-0" />
            <span>{data.actionSuccess}</span>
          </div>
        )}

        {data.loadingData && data.classesList.length === 0 ? (
          <div className="py-20 flex justify-center">
            <Spinner message="Retrieving dashboard databases..." />
          </div>
        ) : (
          <div className="animate-fadeIn">
            {activeTab === 'overview' && (
              <OverviewTab
                assessmentsCapped={data.assessmentsCapped}
                classesList={data.classesList}
                allStudents={data.allStudents}
                allAssessments={data.allAssessments}
                activityData={data.activityData}
                formatScoreDetails={formatScoreDetails}
              />
            )}

            {activeTab === 'classes' && (
              <ClassesTab
                classesList={data.classesList}
                selectedClass={data.selectedClass}
                setSelectedClass={data.setSelectedClass}
                allStudents={data.allStudents}
                newClassName={data.newClassName}
                setNewClassName={data.setNewClassName}
                newClassCode={data.newClassCode}
                setNewClassCode={data.setNewClassCode}
                newGradeLevel={data.newGradeLevel}
                setNewGradeLevel={data.setNewGradeLevel}
                handleCreateClass={data.handleCreateClass}
                bulkStudentsText={data.bulkStudentsText}
                setBulkStudentsText={data.setBulkStudentsText}
                handleBulkEnroll={data.handleBulkEnroll}
                handleUnenrollStudent={data.handleUnenrollStudent}
                importing={data.importing}
                importResults={data.importResults}
                setActionSuccess={data.setActionSuccess}
                setActionError={data.setActionError}
                setImportResults={data.setImportResults}
                handleUpdateClass={data.handleUpdateClass}
                handleDeleteClass={data.handleDeleteClass}
                handleUpdateStudent={data.handleUpdateStudent}
                handleResetStudentPassword={data.handleResetStudentPassword}
              />
            )}

            {activeTab === 'materials' && (
              <MaterialsTab
                teacher={data.teacher}
                classesList={data.classesList}
                selectedClassesMaterial={data.selectedClassesMaterial}
                setSelectedClassesMaterial={data.setSelectedClassesMaterial}
                materialCreationMode={data.materialCreationMode}
                setMaterialCreationMode={data.setMaterialCreationMode}
                globalGradeLevel={data.globalGradeLevel}
                setGlobalGradeLevel={data.setGlobalGradeLevel}
                materialMode={data.materialMode}
                setMaterialMode={data.setMaterialMode}
                materialTitle={data.materialTitle}
                setMaterialTitle={data.setMaterialTitle}
                materialContent={data.materialContent}
                setMaterialContent={data.setMaterialContent}
                handleCreateMaterial={data.handleCreateMaterial}
                customMaterials={data.customMaterials}
                handleUpdateMaterialGroup={data.handleUpdateMaterialGroup}
                handleDeleteMaterialGroup={data.handleDeleteMaterialGroup}
                setActionError={data.setActionError}
                setActionSuccess={data.setActionSuccess}
              />
            )}

            {activeTab === 'scores' && (
              <ScoresTab
                allAssessments={data.allAssessments}
                classesList={data.classesList}
                searchQuery={data.searchQuery}
                setSearchQuery={data.setSearchQuery}
                selectedClassFilter={data.selectedClassFilter}
                setSelectedClassFilter={data.setSelectedClassFilter}
                selectedModeFilter={data.selectedModeFilter}
                setSelectedModeFilter={data.setSelectedModeFilter}
                selectedMaterialFilter={data.selectedMaterialFilter}
                setSelectedMaterialFilter={data.setSelectedMaterialFilter}
                getFilteredAssessments={data.getFilteredAssessments}
                handleDownloadCSV={data.handleDownloadCSV}
                handleDownloadExcel={data.handleDownloadExcel}
                exporting={data.exporting}
                passMark={data.passMark}
                setPassMark={data.setPassMark}
                assessmentsCapped={data.assessmentsCapped}
                formatScoreDetails={formatScoreDetails}
                onReview={setReviewRecord}
                currentPage={data.currentPage}
                setCurrentPage={data.setCurrentPage}
                itemsPerPage={data.itemsPerPage}
              />
            )}

            {activeTab === 'activity' && (
              <ActivityTab
                classesList={data.classesList}
                allStudents={data.allStudents}
                activityData={data.activityData}
                selectedActivityClass={data.selectedActivityClass}
                setSelectedActivityClass={data.setSelectedActivityClass}
              />
            )}
          </div>
        )}
      </main>

      {reviewRecord && (
        <SubmissionReview
          assessment={reviewRecord}
          apiBase={API_BASE}
          authClient={supabaseTeacher}
          heading="Attempt review"
          studentName={reviewRecord.student?.full_name}
          onClose={() => setReviewRecord(null)}
        />
      )}
    </div>
  );
}
export default TeacherDashboard;
