import React, { useState } from 'react';
import { Users, Award, BookOpen, BarChart2, RefreshCw, FlaskConical, Activity } from 'lucide-react';
import { AppShell } from './UI/AppShell';
import { PageHeader } from './UI/PageHeader';
import { Button } from './UI/Button';
import { Select } from './UI/Field';
import { Alert } from './UI/Alert';
import Spinner from './UI/Spinner';
import { useTeacherData } from '../hooks/useTeacherData';
import { OverviewTab } from './teacher/OverviewTab';
import { ClassesTab } from './teacher/ClassesTab';
import { MaterialsTab } from './teacher/MaterialsTab';
import { ScoresTab } from './teacher/ScoresTab';
import { ActivityTab } from './teacher/ActivityTab';
import { ResearchTab } from './research/ResearchTab';
import SubmissionReview from './UI/SubmissionReview';
import { supabaseTeacher } from '../utils/supabaseClient';
import { modeLabel } from '../utils/modes';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

// Helper score structures (Renders accuracy and IELTS details from JSON payload)
const formatScoreDetails = (mode, scoreData) => {
  if (!scoreData) return <span className="text-ink-subtle tabular-nums text-xs">-</span>;
  
  if (mode === 'read_aloud') {
    return (
      <div className="flex flex-col">
        <span className="font-bold text-ink text-xs">{scoreData.accuracy_score ?? 0}% Accuracy</span>
        {scoreData.word_error_rate !== undefined && (
          <span className="text-xs text-ink-subtle">WER: {(scoreData.word_error_rate * 100).toFixed(0)}%</span>
        )}
      </div>
    );
  }

  if (mode === 'mattering') {
    return (
      <div className="flex flex-col">
        <span className="font-bold text-ink text-xs">{scoreData.speaker_score ?? '-'} Speaker Score</span>
        <span className="text-xs text-ink-subtle">{scoreData.band || 'Scale 69-81'}</span>
      </div>
    );
  }

  if (mode === 'debate') {
    const finalScore = scoreData.finalScore ?? scoreData.matter_score ?? 0;
    return (
      <div className="flex flex-col">
        <span className="font-bold text-ink text-xs">{Math.round(finalScore)}/100 Debate</span>
        {scoreData.matter_score !== undefined && (
          <span className="text-xs text-ink-subtle">
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
  if (validScores.length === 0) return <span className="text-ink-subtle tabular-nums text-xs">-</span>;
  
  const rawAvg = validScores.reduce((a, b) => a + b, 0) / validScores.length;
  const scoreOutOf100 = Math.round(rawAvg);
  
  return (
    <div className="flex flex-col">
      <span className="font-bold text-ink text-xs">{scoreOutOf100}/100 Score</span>
      <span className="text-xs text-ink-subtle">
        {modeLabel(mode)}
      </span>
    </div>
  );
};

export function TeacherDashboard() {
  const [activeTab, setActiveTab] = useState('overview');
  const [dateFilter, setDateFilter] = useState('30days');
  const [reviewRecord, setReviewRecord] = useState(null); // score row opened in the review panel
  const data = useTeacherData(dateFilter);

  if (data.loadingAuth) {
    return (
      <div className="min-h-screen bg-canvas flex justify-center items-center">
        <Spinner message="Signing you in..." />
      </div>
    );
  }

  const TAB_TITLES = {
    overview: 'Overview',
    classes: 'Classes and students',
    materials: 'Practice materials',
    scores: 'Results',
    activity: 'Activity',
    research: 'Research tests',
  };

  const TAB_DESCRIPTIONS = {
    overview: 'How your classes are doing at a glance.',
    classes: 'Create classes, share class codes, and add students in bulk.',
    materials: 'Add your own paragraphs, questions, conversation topics, debate motions and mattering issues.',
    scores: 'Every saved attempt, with recordings, transcripts and feedback.',
    activity: 'Active practice time and idle time per student.',
    research: 'Pretest / posttest speaking tests: consent, one recording per question, AI scoring and blind human scorers.',
  };

  const NAV = [
    { key: 'overview', icon: BarChart2, label: 'Overview' },
    { key: 'classes', icon: Users, label: 'Classes' },
    { key: 'materials', icon: BookOpen, label: 'Materials' },
    { key: 'scores', icon: Award, label: 'Results' },
    { key: 'activity', icon: Activity, label: 'Activity' },
    { key: 'research', icon: FlaskConical, label: 'Research tests', shortLabel: 'Research', section: 'Research' },
  ];

  return (
    <AppShell
      navItems={NAV}
      navTitle="Teaching"
      activeKey={activeTab}
      onSelect={setActiveTab}
      user={{ name: data.teacher?.full_name, subtitle: 'Teacher' }}
      onSignOut={data.handleSignOut}
      maxWidth="max-w-7xl"
    >
      <div className="flex flex-col gap-5 md:gap-7">
        <PageHeader
          title={TAB_TITLES[activeTab]}
          description={TAB_DESCRIPTIONS[activeTab]}
          actions={
            <>
              <Select
                value={dateFilter}
                onChange={(e) => setDateFilter(e.target.value)}
                aria-label="Time period"
                className="w-44"
              >
                <option value="7days">Last 7 days</option>
                <option value="30days">Last 30 days</option>
                <option value="all">All time</option>
              </Select>
              <Button
                variant="secondary"
                icon={RefreshCw}
                onClick={data.loadDashboardData}
                disabled={data.loadingData}
                aria-label="Refresh"
                title="Refresh"
                className={data.loadingData ? '[&>svg]:animate-spin' : ''}
              />
            </>
          }
        />

        {data.actionError && <Alert tone="error" onClose={() => data.setActionError('')}>{data.actionError}</Alert>}
        {data.actionSuccess && <Alert tone="success" onClose={() => data.setActionSuccess('')}>{data.actionSuccess}</Alert>}

        {data.loadingData && data.classesList.length === 0 ? (
          <div className="py-20 flex justify-center">
            <Spinner message="Loading your classes..." />
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

            {activeTab === 'research' && (
              <ResearchTab setActionError={data.setActionError} setActionSuccess={data.setActionSuccess} />
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
      </div>

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
    </AppShell>
  );
}
export default TeacherDashboard;
