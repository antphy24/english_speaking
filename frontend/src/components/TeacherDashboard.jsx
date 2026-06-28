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
  // IELTS evaluation
  const subScores = mode === 'qa' 
    ? [scoreData.fluency, scoreData.lexical_resource, scoreData.grammatical_range, scoreData.pronunciation]
    : [scoreData.fluency_and_coherence, scoreData.lexical_resource, scoreData.grammatical_range, scoreData.pronunciation, scoreData.interactive_communication];
    
  const validScores = subScores.filter(s => s !== undefined && s !== null);
  if (validScores.length === 0) return <span className="text-slate-500 font-mono text-xs">-</span>;
  
  const rawAvg = validScores.reduce((a, b) => a + b, 0) / validScores.length;
  const band = Math.round(rawAvg * 2) / 2;
  
  return (
    <div className="flex flex-col">
      <span className="font-bold text-white text-xs">IELTS Band {band.toFixed(1)}</span>
      <span className="text-[10px] text-slate-500">
        {mode === 'qa' ? 'Q&A Mock' : 'Dialogue Practice'}
      </span>
    </div>
  );
};

export function TeacherDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const data = useTeacherData();

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
  };

  const TAB_DESCRIPTIONS = {
    overview: 'Aggregated statistics and student assessment summaries.',
    classes: 'Create classrooms, generate class keys, and add students in bulk.',
    materials: 'Add class-specific custom texts for Read Aloud, prompts for Q&A, or AI conversations.',
    scores: 'Deep-dive review of individual student speech assessments.',
  };

  return (
    <div className="min-h-screen bg-[#070b13] text-slate-100 flex flex-col md:flex-row relative">
      {/* Background neon glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-[#0d9488]/5 rounded-full blur-[100px] pointer-events-none"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/5 rounded-full blur-[100px] pointer-events-none"></div>

      {/* Sidebar */}
      <aside className="w-full md:w-64 bg-slate-950/80 border-b md:border-b-0 md:border-r border-slate-900 flex flex-col justify-between p-6 shrink-0 relative z-20">
        <div className="space-y-8">
          <div className="flex items-center space-x-2.5">
            <div className="p-2 bg-indigo-600/10 border border-indigo-500/20 rounded-xl text-indigo-400">
              <Plus className="w-5 h-5" />
            </div>
            <span className="text-lg font-extrabold text-white">
              HreF<span className="text-indigo-500 font-medium">Speak</span>
            </span>
          </div>

          <div className="flex items-center space-x-2 p-3 bg-slate-900/40 rounded-xl border border-slate-850">
            <Users className="w-4 h-4 text-indigo-400 shrink-0" />
            <div className="text-xs truncate max-w-[150px]">
              <div className="text-slate-400 font-medium">Teacher Portal</div>
              <div className="text-white font-bold truncate">{data.teacher?.full_name}</div>
            </div>
          </div>

          <nav className="flex flex-col space-y-1">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">Management</span>
            
            {[
              { key: 'overview', icon: BarChart2, label: 'Performance Overview' },
              { key: 'classes', icon: Users, label: 'Classes & Enrollment' },
              { key: 'materials', icon: BookOpen, label: 'Class Materials' },
              { key: 'scores', icon: Award, label: 'Assessment Records' },
            ].map(({ key, icon: Icon, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-bold transition ${
                  activeTab === key
                    ? 'bg-indigo-600/15 border border-indigo-500/20 text-white font-extrabold'
                    : 'border border-transparent text-slate-400 hover:bg-slate-900/40 hover:text-slate-200'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
              </button>
            ))}
          </nav>
        </div>

        <div className="pt-6 border-t border-slate-900 mt-6">
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
      <main className="flex-1 p-6 md:p-10 overflow-y-auto max-w-6xl relative z-10">
        <header className="mb-8 flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-white tracking-tight">
              {TAB_TITLES[activeTab]}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {TAB_DESCRIPTIONS[activeTab]}
            </p>
          </div>
          
          <button 
            onClick={data.loadDashboardData}
            disabled={data.loadingData}
            className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl transition cursor-pointer"
            title="Refresh logs"
          >
            <RefreshCw className={`w-4 h-4 ${data.loadingData ? 'animate-spin' : ''}`} />
          </button>
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
                classesList={data.classesList}
                allStudents={data.allStudents}
                allAssessments={data.allAssessments}
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
                handleCreateClass={data.handleCreateClass}
                bulkStudentsText={data.bulkStudentsText}
                setBulkStudentsText={data.setBulkStudentsText}
                handleBulkEnroll={data.handleBulkEnroll}
                importing={data.importing}
                importResults={data.importResults}
                setActionSuccess={data.setActionSuccess}
                setActionError={data.setActionError}
                setImportResults={data.setImportResults}
              />
            )}

            {activeTab === 'materials' && (
              <MaterialsTab
                teacher={data.teacher}
                classesList={data.classesList}
                selectedClassMaterial={data.selectedClassMaterial}
                setSelectedClassMaterial={data.setSelectedClassMaterial}
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
                handleDeleteMaterial={data.handleDeleteMaterial}
                setActionError={data.setActionError}
                setActionSuccess={data.setActionSuccess}
              />
            )}

            {activeTab === 'scores' && (
              <ScoresTab
                classesList={data.classesList}
                searchQuery={data.searchQuery}
                setSearchQuery={data.setSearchQuery}
                selectedClassFilter={data.selectedClassFilter}
                setSelectedClassFilter={data.setSelectedClassFilter}
                selectedModeFilter={data.selectedModeFilter}
                setSelectedModeFilter={data.setSelectedModeFilter}
                getFilteredAssessments={data.getFilteredAssessments}
                handleDownloadCSV={data.handleDownloadCSV}
                formatScoreDetails={formatScoreDetails}
                currentPage={data.currentPage}
                setCurrentPage={data.setCurrentPage}
                itemsPerPage={data.itemsPerPage}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
export default TeacherDashboard;
