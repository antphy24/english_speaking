import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import { createClient } from '@supabase/supabase-js';
import { 
  Plus, Users, Award, BookOpen, LogOut, ChevronRight, 
  Trash2, RefreshCw, BarChart2, ShieldAlert, CheckCircle, Search, Filter, Download 
} from 'lucide-react';
import Spinner from './UI/Spinner';

export function TeacherDashboard() {
  const navigate = useNavigate();
  
  // Auth state
  const [teacher, setTeacher] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  
  // Dashboard navigation tab: 'overview' | 'classes' | 'scores' | 'materials'
  const [activeTab, setActiveTab] = useState('overview');
  
  // Data state
  const [classesList, setClassesList] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [allStudents, setAllStudents] = useState([]);
  const [allAssessments, setAllAssessments] = useState([]);
  const [customMaterials, setCustomMaterials] = useState([]);
  const [loadingData, setLoadingData] = useState(false);

  // Forms and Modals state
  const [newClassName, setNewClassName] = useState('');
  const [bulkStudentsText, setBulkStudentsText] = useState('');
  
  // Custom materials form state
  const [selectedClassMaterial, setSelectedClassMaterial] = useState(null);
  const [materialMode, setMaterialMode] = useState('read_aloud'); // 'read_aloud' | 'qa' | 'conversation'
  const [materialTitle, setMaterialTitle] = useState('');
  const [materialContent, setMaterialContent] = useState('');

  // Feedback states
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState(null); // { successCount, failures: [] }

  // Filter and search state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClassFilter, setSelectedClassFilter] = useState('all');
  const [selectedModeFilter, setSelectedModeFilter] = useState('all');

  // Verify auth session
  useEffect(() => {
    const checkAuth = async () => {
      setLoadingAuth(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/teacher/login');
        return;
      }
      
      // Confirm they are registered in the teachers table
      const { data: profile, error } = await supabase
        .from('teachers')
        .select('*')
        .eq('id', user.id)
        .single();
        
      if (error || !profile) {
        console.error('Not a teacher:', error);
        await supabase.auth.signOut();
        navigate('/teacher/login');
        return;
      }
      
      setTeacher(profile);
      setLoadingAuth(false);
    };
    checkAuth();
  }, [navigate]);

  // Load classes, students, assessment scores, and materials
  const loadDashboardData = async () => {
    if (!teacher) return;
    setLoadingData(true);
    setActionError('');
    
    try {
      // 1. Fetch Classes
      const { data: classesData, error: classesErr } = await supabase
        .from('classes')
        .select('*')
        .order('created_at', { ascending: false });
        
      if (classesErr) throw classesErr;
      setClassesList(classesData);
      
      if (classesData.length > 0) {
        if (!selectedClass) setSelectedClass(classesData[0]);
        if (!selectedClassMaterial) setSelectedClassMaterial(classesData[0]);
      }

      // 2. Fetch Students in all classes
      if (classesData.length > 0) {
        const classIds = classesData.map(c => c.id);
        const { data: studentsData, error: studentsErr } = await supabase
          .from('students')
          .select('*, class:classes(class_name, class_code)')
          .in('class_id', classIds);
          
        if (studentsErr) throw studentsErr;
        setAllStudents(studentsData);

        // 3. Fetch Assessments for these students
        const studentIds = studentsData.map(s => s.id);
        if (studentIds.length > 0) {
          const { data: assessmentsData, error: assessErr } = await supabase
            .from('assessments')
            .select('*, student:students(full_name, school_id, class:classes(class_name))')
            .in('student_id', studentIds)
            .order('created_at', { ascending: false });
            
          if (assessErr) throw assessErr;
          setAllAssessments(assessmentsData);
        } else {
          setAllAssessments([]);
        }

        // 4. Fetch Custom Materials
        const { data: materialsData, error: materialsErr } = await supabase
          .from('custom_materials')
          .select('*, class:classes(class_name)')
          .in('class_id', classIds)
          .order('created_at', { ascending: false });
          
        if (materialsErr) throw materialsErr;
        setCustomMaterials(materialsData || []);

      } else {
        setAllStudents([]);
        setAllAssessments([]);
        setCustomMaterials([]);
      }
    } catch (err) {
      console.error('Failed to load dashboard data:', err);
      setActionError('Could not sync with database.');
    } finally {
      setLoadingData(false);
    }
  };

  useEffect(() => {
    if (!loadingAuth && teacher) {
      loadDashboardData();
    }
  }, [loadingAuth, teacher]);

  const handleSignOut = async () => {
    if (window.confirm('Log out from teacher portal?')) {
      await supabase.auth.signOut();
      navigate('/teacher/login');
    }
  };

  // Generate unique 6-character class code
  const generateClassCode = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  // Create a new class
  const handleCreateClass = async (e) => {
    e.preventDefault();
    if (!newClassName.trim()) return;
    
    setActionError('');
    setActionSuccess('');
    
    const classCode = generateClassCode();
    try {
      const { data, error } = await supabase
        .from('classes')
        .insert({
          teacher_id: teacher.id,
          class_name: newClassName.trim(),
          class_code: classCode
        })
        .select()
        .single();
        
      if (error) throw error;
      
      setActionSuccess(`Class "${newClassName.trim()}" created successfully! Code: ${classCode}`);
      setNewClassName('');
      setClassesList([data, ...classesList]);
      if (!selectedClass) setSelectedClass(data);
      if (!selectedClassMaterial) setSelectedClassMaterial(data);
      loadDashboardData();
    } catch (err) {
      console.error('Create class failed:', err);
      setActionError(err.message || 'Failed to create class. Code collision? Try again.');
    }
  };

  // Bulk enrollment of students
  const handleBulkEnroll = async (e) => {
    e.preventDefault();
    if (!selectedClass) {
      setActionError('Please select a class first.');
      return;
    }
    if (!bulkStudentsText.trim()) {
      setActionError('Pasted list cannot be empty.');
      return;
    }
    
    setImporting(true);
    setActionError('');
    setActionSuccess('');
    setImportResults(null);

    const lines = bulkStudentsText.split('\n');
    const studentsToImport = [];
    
    // Parse list
    for (let line of lines) {
      line = line.trim();
      if (!line) continue;
      
      const parts = line.split(',');
      if (parts.length < 2) {
        setActionError(`Format error: Line "${line}" must be "Name,SchoolID"`);
        setImporting(false);
        return;
      }
      
      const fullName = parts[0].trim();
      const schoolId = parts[1].trim();
      
      if (!fullName || !schoolId) {
        setActionError(`Format error: Name or School ID is missing on line "${line}"`);
        setImporting(false);
        return;
      }
      
      studentsToImport.push({ fullName, schoolId });
    }

    if (studentsToImport.length === 0) {
      setActionError('No valid students to import.');
      setImporting(false);
      return;
    }

    // Call the FastAPI secure backend endpoint to perform admin signups
    const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const sessionToken = session?.access_token;
      
      if (!sessionToken) {
        throw new Error('Teacher session expired. Please log in again.');
      }
      
      const response = await fetch(`${API_BASE}/teacher/bulk-enroll`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`
        },
        body: JSON.stringify({
          classId: selectedClass.id,
          classCode: selectedClass.class_code,
          students: studentsToImport
        })
      });
      
      if (!response.ok) {
        const errText = await response.text();
        let errMsg = 'Failed to enroll students via backend.';
        try {
          const parsed = JSON.parse(errText);
          errMsg = parsed.detail || errMsg;
        } catch (_) {}
        throw new Error(errMsg);
      }
      
      const result = await response.json();
      setImportResults({
        successCount: result.successCount,
        failures: result.failures
      });
      setBulkStudentsText('');
      loadDashboardData();
    } catch (err) {
      console.error('Bulk enrollment failed:', err);
      setActionError(err.message || 'Failed to complete student enrollment.');
    } finally {
      setImporting(false);
    }
  };

  // Custom materials creations
  const handleCreateMaterial = async (e) => {
    e.preventDefault();
    if (!selectedClassMaterial) {
      setActionError('Please select a class first.');
      return;
    }
    if (!materialContent.trim()) {
      setActionError('Content cannot be empty.');
      return;
    }

    const titleVal = materialMode === 'conversation' ? 'AI Tutor Conversation Greeting' : materialTitle.trim();
    if (!titleVal) {
      setActionError('Please enter a title.');
      return;
    }

    setActionError('');
    setActionSuccess('');

    try {
      const { data, error } = await supabase
        .from('custom_materials')
        .insert({
          class_id: selectedClassMaterial.id,
          mode: materialMode,
          title: titleVal,
          content: materialContent.trim()
        })
        .select('*, class:classes(class_name)')
        .single();

      if (error) throw error;

      setActionSuccess(`Custom material added successfully for class "${selectedClassMaterial.class_name}"!`);
      setMaterialTitle('');
      setMaterialContent('');
      setCustomMaterials([data, ...customMaterials]);
    } catch (err) {
      console.error('Failed to create material:', err);
      setActionError(err.message || 'Failed to create material.');
    }
  };

  // Custom materials deletions
  const handleDeleteMaterial = async (materialId) => {
    if (!window.confirm('Are you sure you want to delete this custom material?')) return;

    setActionError('');
    setActionSuccess('');

    try {
      const { error } = await supabase
        .from('custom_materials')
        .delete()
        .eq('id', materialId);

      if (error) throw error;

      setActionSuccess('Material deleted successfully.');
      setCustomMaterials(customMaterials.filter(m => m.id !== materialId));
    } catch (err) {
      console.error('Failed to delete material:', err);
      setActionError(err.message || 'Failed to delete material.');
    }
  };

  // Filter scores based on queries
  const getFilteredAssessments = () => {
    return allAssessments.filter(item => {
      const matchSearch = item.student?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.student?.school_id?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchClass = selectedClassFilter === 'all' || item.student?.class?.class_name === selectedClassFilter;
      const matchMode = selectedModeFilter === 'all' || item.mode === selectedModeFilter;
      
      return matchSearch && matchClass && matchMode;
    });
  };

  // Export Assessment Records to CSV
  const handleDownloadCSV = () => {
    const records = getFilteredAssessments();
    if (records.length === 0) {
      alert('No records found matching filters to download.');
      return;
    }

    // Headers
    const headers = ["Student Name", "School ID", "Class Name", "Date/Time", "Mode", "Overall Score", "Feedback text"];
    
    // Rows
    const rows = records.map(record => {
      let scoreStr = "";
      if (record.mode === 'read_aloud') {
        scoreStr = `${record.score}% Accuracy`;
      } else {
        scoreStr = `Band ${record.score.toFixed(1)}`;
      }
      
      const feedbackText = record.feedback?.feedback || record.feedback || "";
      const escapedFeedback = `"${feedbackText.replace(/"/g, '""')}"`;
      
      return [
        record.student?.full_name || "",
        record.student?.school_id || "",
        record.student?.class?.class_name || "",
        new Date(record.created_at).toLocaleString(),
        record.mode,
        scoreStr,
        escapedFeedback
      ];
    });

    const csvContent = [
      headers.join(","),
      ...rows.map(e => e.join(","))
    ].join("\n");

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `assessment_records_${new Date().toISOString().slice(0,10)}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

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

  if (loadingAuth) {
    return (
      <div className="min-h-screen bg-[#070b13] flex justify-center items-center">
        <Spinner message="Authenticating..." />
      </div>
    );
  }

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
              href<span className="text-indigo-500 font-medium">Speak</span>
            </span>
          </div>

          <div className="flex items-center space-x-2 p-3 bg-slate-900/40 rounded-xl border border-slate-850">
            <Users className="w-4 h-4 text-indigo-400 shrink-0" />
            <div className="text-xs truncate max-w-[150px]">
              <div className="text-slate-400 font-medium">Teacher Portal</div>
              <div className="text-white font-bold truncate">{teacher?.full_name}</div>
            </div>
          </div>

          <nav className="flex flex-col space-y-1">
            <span className="text-[10px] font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">Management</span>
            
            <button
              onClick={() => setActiveTab('overview')}
              className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-bold transition ${
                activeTab === 'overview'
                  ? 'bg-indigo-600/15 border border-indigo-500/20 text-white font-extrabold'
                  : 'border border-transparent text-slate-400 hover:bg-slate-900/40 hover:text-slate-200'
              }`}
            >
              <BarChart2 className="w-4 h-4" />
              <span>Performance Overview</span>
            </button>

            <button
              onClick={() => setActiveTab('classes')}
              className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-bold transition ${
                activeTab === 'classes'
                  ? 'bg-indigo-600/15 border border-indigo-500/20 text-white font-extrabold'
                  : 'border border-transparent text-slate-400 hover:bg-slate-900/40 hover:text-slate-200'
              }`}
            >
              <Users className="w-4 h-4" />
              <span>Classes & Enrollment</span>
            </button>

            <button
              onClick={() => setActiveTab('materials')}
              className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-bold transition ${
                activeTab === 'materials'
                  ? 'bg-indigo-600/15 border border-indigo-500/20 text-white font-extrabold'
                  : 'border border-transparent text-slate-400 hover:bg-slate-900/40 hover:text-slate-200'
              }`}
            >
              <BookOpen className="w-4 h-4" />
              <span>Class Materials</span>
            </button>

            <button
              onClick={() => setActiveTab('scores')}
              className={`flex items-center space-x-3 px-4 py-3 rounded-xl text-xs font-bold transition ${
                activeTab === 'scores'
                  ? 'bg-indigo-600/15 border border-indigo-500/20 text-white font-extrabold'
                  : 'border border-transparent text-slate-400 hover:bg-slate-900/40 hover:text-slate-200'
              }`}
            >
              <Award className="w-4 h-4" />
              <span>Assessment Records</span>
            </button>
          </nav>
        </div>

        <div className="pt-6 border-t border-slate-900 mt-6">
          <button
            onClick={handleSignOut}
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
              {activeTab === 'overview' && 'LMS Analytics Overview'}
              {activeTab === 'classes' && 'Classrooms & Enrollments'}
              {activeTab === 'materials' && 'Manage Practice Materials'}
              {activeTab === 'scores' && 'Assessments Score Ledger'}
            </h2>
            <p className="text-xs text-slate-400 mt-1">
              {activeTab === 'overview' && 'Aggregated statistics and student assessment summaries.'}
              {activeTab === 'classes' && 'Create classrooms, generate class keys, and add students in bulk.'}
              {activeTab === 'materials' && 'Add class-specific custom texts for Read Aloud, prompts for Q&A, or AI conversations.'}
              {activeTab === 'scores' && 'Deep-dive review of individual student speech assessments.'}
            </p>
          </div>
          
          <button 
            onClick={loadDashboardData}
            disabled={loadingData}
            className="p-2 bg-slate-900 hover:bg-slate-800 border border-slate-800 text-slate-300 rounded-xl transition cursor-pointer"
            title="Refresh logs"
          >
            <RefreshCw className={`w-4 h-4 ${loadingData ? 'animate-spin' : ''}`} />
          </button>
        </header>

        {actionError && (
          <div className="mb-6 p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-sm text-rose-400 flex items-center space-x-2 animate-fadeIn">
            <ShieldAlert className="w-5 h-5 shrink-0" />
            <span>{actionError}</span>
          </div>
        )}

        {actionSuccess && (
          <div className="mb-6 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-2xl text-sm text-emerald-400 flex items-center space-x-2 animate-fadeIn">
            <CheckCircle className="w-5 h-5 shrink-0" />
            <span>{actionSuccess}</span>
          </div>
        )}

        {loadingData && classesList.length === 0 ? (
          <div className="py-20 flex justify-center">
            <Spinner message="Retrieving dashboard databases..." />
          </div>
        ) : (
          <div className="animate-fadeIn">
            {/* OVERVIEW PANEL */}
            {activeTab === 'overview' && (
              <div className="space-y-8">
                {/* Stats cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
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
            )}

            {/* CLASSES & ENROLLMENT PANEL */}
            {activeTab === 'classes' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
                {/* Left col: Classes list & Create */}
                <div className="lg:col-span-5 space-y-6">
                  {/* Create Class */}
                  <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
                    <h3 className="font-bold text-base text-white">Create New Classroom</h3>
                    <form onSubmit={handleCreateClass} className="space-y-3">
                      <input
                        type="text"
                        required
                        value={newClassName}
                        onChange={e => setNewClassName(e.target.value)}
                        placeholder="e.g. Grade 10 English A"
                        className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm font-medium"
                      />
                      <button
                        type="submit"
                        className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md transition-all flex items-center justify-center space-x-1 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Create Class Code</span>
                      </button>
                    </form>
                  </div>

                  {/* Classes list */}
                  <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
                    <h3 className="font-bold text-base text-white">My Classes</h3>
                    {classesList.length === 0 ? (
                      <p className="text-slate-500 text-xs italic py-6">No classes created yet.</p>
                    ) : (
                      <div className="space-y-2 max-h-[350px] overflow-y-auto pr-1">
                        {classesList.map(item => (
                          <button
                            key={item.id}
                            onClick={() => {
                              setSelectedClass(item);
                              setActionSuccess('');
                              setActionError('');
                              setImportResults(null);
                            }}
                            className={`w-full p-4 rounded-xl border text-left flex justify-between items-center transition ${
                              selectedClass?.id === item.id
                                ? 'bg-indigo-600/10 border-indigo-500 text-white shadow-sm'
                                : 'bg-slate-900/40 border-slate-850 hover:bg-slate-900/60 text-slate-400 hover:text-slate-200'
                            }`}
                          >
                            <div>
                              <span className="font-bold text-sm block">{item.class_name}</span>
                              <span className="text-[10px] opacity-80 block font-mono mt-0.5">
                                Code: <strong className="text-indigo-400 font-bold tracking-widest">{item.class_code}</strong>
                              </span>
                            </div>
                            <div className="flex items-center space-x-1">
                              <span className="text-[10px] px-2 py-0.5 bg-slate-950 border border-slate-850 rounded text-slate-400 font-semibold font-mono">
                                {allStudents.filter(s => s.class_id === item.id).length} students
                              </span>
                              <ChevronRight className="w-4 h-4" />
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                {/* Right col: Enrollment */}
                <div className="lg:col-span-7">
                  {selectedClass ? (
                    <div className="glass-panel p-6 rounded-2xl border border-slate-800 space-y-6">
                      <div className="border-b border-slate-850 pb-4">
                        <span className="text-[10px] text-indigo-400 uppercase tracking-widest font-bold">Enroll Students In</span>
                        <h3 className="text-xl font-bold text-white mt-0.5">{selectedClass.class_name}</h3>
                        <p className="text-[11px] text-slate-500 mt-1 font-mono">
                          Class Code: <span className="text-indigo-400 font-bold bg-slate-950 border border-slate-900 px-2 py-0.5 rounded tracking-widest text-xs">{selectedClass.class_code}</span>
                        </p>
                      </div>

                      {/* Import Forms */}
                      <form onSubmit={handleBulkEnroll} className="space-y-4">
                        <div className="space-y-1.5 text-left">
                          <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                            Bulk paste student list (Format: Name,SchoolID)
                          </label>
                          <textarea
                            required
                            rows={6}
                            value={bulkStudentsText}
                            onChange={e => setBulkStudentsText(e.target.value)}
                            placeholder="John Doe,SD-10492&#10;Jane Smith,SD-10519&#10;Michael Johnson,SD-10928"
                            className="w-full px-4 py-3 bg-slate-900/60 border border-slate-800 rounded-xl text-white placeholder-slate-700 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-xs font-mono leading-relaxed"
                          />
                          <p className="text-[10px] text-slate-500 italic">
                            Enter one student per line. Password will default to their School ID. Emails will generate as student_[SchoolID]@[ClassCode].hrefspeak.com.
                          </p>
                        </div>

                        <button
                          type="submit"
                          disabled={importing}
                          className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md transition-all disabled:opacity-50 cursor-pointer"
                        >
                          {importing ? 'Importing Accounts...' : 'Bulk Enroll Students'}
                        </button>
                      </form>

                      {/* Import results summary */}
                      {importResults && (
                        <div className="p-4 bg-slate-950 border border-slate-850 rounded-xl space-y-2 animate-fadeIn text-xs">
                          <h4 className="font-bold text-slate-200">Import Log:</h4>
                          <p className="text-emerald-400 font-semibold">&bull; Successfully created {importResults.successCount} accounts.</p>
                          {importResults.failures.length > 0 && (
                            <div className="space-y-1 mt-2">
                              <p className="text-rose-400 font-semibold">&bull; Failed to enroll {importResults.failures.length} student(s):</p>
                              <div className="pl-3 space-y-1 max-h-32 overflow-y-auto pr-1">
                                {importResults.failures.map((f, i) => (
                                  <p key={i} className="text-rose-400 font-mono text-[10px]">{f}</p>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Enrolled Students Table */}
                      <div className="border-t border-slate-850 pt-5 space-y-3">
                        <h4 className="font-bold text-sm text-slate-300">Enrolled Students ({allStudents.filter(s => s.class_id === selectedClass.id).length})</h4>
                        {allStudents.filter(s => s.class_id === selectedClass.id).length === 0 ? (
                          <p className="text-slate-500 text-xs italic">No students registered in this class.</p>
                        ) : (
                          <div className="overflow-x-auto border border-slate-850 rounded-xl max-h-[300px] overflow-y-auto">
                            <table className="w-full text-left border-collapse text-xs">
                              <thead>
                                <tr className="bg-slate-900/40 text-slate-400 border-b border-slate-850">
                                  <th className="py-2 px-4">Student Name</th>
                                  <th className="py-2 px-4">School ID</th>
                                  <th className="py-2 px-4">Initial Login Email</th>
                                  <th className="py-2 px-4 text-center">Status</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-850/60 text-slate-300">
                                {allStudents.filter(s => s.class_id === selectedClass.id).map(student => (
                                  <tr key={student.id} className="hover:bg-slate-900/20">
                                    <td className="py-2 px-4 font-bold text-white">{student.full_name}</td>
                                    <td className="py-2 px-4 font-mono">{student.school_id}</td>
                                    <td className="py-2 px-4 font-mono text-slate-500">{`student_${student.school_id.replace(/[^a-zA-Z0-9]/g, '')}@${selectedClass.class_code}.hrefspeak.com`.toLowerCase()}</td>
                                    <td className="py-2 px-4 text-center">
                                      {student.requires_password_change ? (
                                        <span className="px-2 py-0.5 bg-amber-500/10 text-amber-400 border border-amber-500/20 rounded-[4px] text-[9px] font-semibold">New</span>
                                      ) : (
                                        <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 rounded-[4px] text-[9px] font-semibold">Ready</span>
                                      )}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <div className="glass-panel p-10 rounded-2xl border border-slate-800 text-center text-slate-500">
                      Create or select a classroom on the left to start enrolling students.
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* CLASS MATERIALS PANEL */}
            {activeTab === 'materials' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start animate-fadeIn">
                {/* Left col: Add Material */}
                <div className="lg:col-span-5 glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
                  <h3 className="font-bold text-base text-white">Add Class Material</h3>
                  
                  <form onSubmit={handleCreateMaterial} className="space-y-4">
                    {/* Class Dropdown */}
                    <div className="space-y-1 text-left">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Target Classroom</label>
                      <select
                        value={selectedClassMaterial?.id || ''}
                        onChange={e => setSelectedClassMaterial(classesList.find(c => c.id === e.target.value))}
                        className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500 transition text-xs"
                      >
                        {classesList.map(c => (
                          <option key={c.id} value={c.id}>{c.class_name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Mode selection dropdown */}
                    <div className="space-y-1 text-left">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Practice Mode</label>
                      <select
                        value={materialMode}
                        onChange={e => {
                          setMaterialMode(e.target.value);
                          setActionError('');
                          setActionSuccess('');
                        }}
                        className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-indigo-500 transition text-xs"
                      >
                        <option value="read_aloud">1. Read Aloud</option>
                        <option value="qa">2. Q&A Mock Prompt</option>
                        <option value="conversation">3. AI Conversation greeting</option>
                      </select>
                    </div>

                    {/* Title input (Hidden for Conversation mode) */}
                    {materialMode !== 'conversation' && (
                      <div className="space-y-1 text-left animate-fadeIn">
                        <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Material Title</label>
                        <input
                          type="text"
                          required
                          value={materialTitle}
                          onChange={e => setMaterialTitle(e.target.value)}
                          placeholder={materialMode === 'read_aloud' ? "e.g. Tech Essay (Hard)" : "e.g. Hobbies Topic"}
                          className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-650 focus:outline-none focus:border-indigo-500 transition text-xs"
                        />
                      </div>
                    )}

                    {/* Content text-area */}
                    <div className="space-y-1 text-left">
                      <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                        {materialMode === 'read_aloud' && 'Paragraph Text (to read aloud)'}
                        {materialMode === 'qa' && 'IELTS Cue Card Prompt'}
                        {materialMode === 'conversation' && 'AI Tutor Greeting & Context'}
                      </label>
                      <textarea
                        required
                        rows={6}
                        value={materialContent}
                        onChange={e => setMaterialContent(e.target.value)}
                        placeholder={
                          materialMode === 'read_aloud' 
                            ? "Paste the text you want the student to read aloud..." 
                            : materialMode === 'qa'
                            ? "Describe a memorable journey you went on. You should say where, when, and explain why it made a strong impression..."
                            : "Hello! Today let's discuss your hobbies. What is something you enjoy doing in your free time?"
                        }
                        className="w-full px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-white placeholder-slate-755 focus:outline-none focus:border-indigo-500 transition text-xs font-medium leading-relaxed"
                      />
                    </div>

                    <button
                      type="submit"
                      className="w-full py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold shadow-md transition cursor-pointer"
                    >
                      Add Material
                    </button>
                  </form>
                </div>

                {/* Right col: Materials List */}
                <div className="lg:col-span-7 glass-panel p-6 rounded-2xl border border-slate-800 space-y-4">
                  <h3 className="font-bold text-base text-white">Current Custom Materials</h3>
                  
                  {customMaterials.length === 0 ? (
                    <p className="text-slate-500 text-xs italic py-16 text-center">No custom materials created yet.</p>
                  ) : (
                    <div className="space-y-4 max-h-[500px] overflow-y-auto pr-1">
                      {customMaterials.map((material) => (
                        <div key={material.id} className="p-4 rounded-xl bg-slate-900/50 border border-slate-850 flex justify-between items-start gap-4">
                          <div className="space-y-1.5 flex-1 min-w-0">
                            <div className="flex items-center space-x-2">
                              {material.mode === 'read_aloud' && <span className="px-2 py-0.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 rounded text-[9px] font-bold uppercase tracking-wider">Read Aloud</span>}
                              {material.mode === 'qa' && <span className="px-2 py-0.5 bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded text-[9px] font-bold uppercase tracking-wider">Q&A Mock</span>}
                              {material.mode === 'conversation' && <span className="px-2 py-0.5 bg-pink-500/10 text-pink-400 border border-pink-500/20 rounded text-[9px] font-bold uppercase tracking-wider">AI Dialogue</span>}
                              <span className="text-[10px] text-slate-500 font-mono">({material.class?.class_name})</span>
                            </div>
                            <h4 className="font-bold text-white text-sm truncate">{material.title}</h4>
                            <p className="text-xs text-slate-400 line-clamp-3 leading-relaxed whitespace-pre-wrap">{material.content}</p>
                          </div>

                          <button
                            onClick={() => handleDeleteMaterial(material.id)}
                            className="p-2 bg-slate-950 border border-slate-850 hover:border-rose-900/50 hover:bg-rose-950/20 text-slate-500 hover:text-rose-400 rounded-lg transition shrink-0 cursor-pointer"
                            title="Delete material"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* SCORES LEDGER PANEL */}
            {activeTab === 'scores' && (
              <div className="space-y-6">
                {/* Search & Filters */}
                <div className="glass-panel p-6 rounded-2xl border border-slate-800 flex flex-col md:flex-row justify-between gap-4">
                  {/* Search */}
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-3 top-3.5 text-slate-600" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={e => setSearchQuery(e.target.value)}
                      placeholder="Search student name or School ID..."
                      className="w-full pl-9 pr-4 py-2.5 bg-slate-900/60 border border-slate-800 rounded-xl text-white placeholder-slate-605 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all text-sm font-medium"
                    />
                  </div>

                  {/* Filters */}
                  <div className="flex flex-wrap items-center gap-3">
                    {/* Class Filter */}
                    <div className="flex items-center space-x-1.5">
                      <Filter className="w-3.5 h-3.5 text-slate-500" />
                      <select
                        value={selectedClassFilter}
                        onChange={e => setSelectedClassFilter(e.target.value)}
                        className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500 transition-all"
                      >
                        <option value="all">All Classes</option>
                        {classesList.map(c => (
                          <option key={c.id} value={c.class_name}>{c.class_name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Mode Filter */}
                    <div className="flex items-center space-x-1.5">
                      <Filter className="w-3.5 h-3.5 text-slate-500" />
                      <select
                        value={selectedModeFilter}
                        onChange={e => setSelectedModeFilter(e.target.value)}
                        className="px-3 py-2 bg-slate-900 border border-slate-800 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500 transition-all"
                      >
                        <option value="all">All Modes</option>
                        <option value="read_aloud">Read Aloud</option>
                        <option value="qa">Q&A Mock</option>
                        <option value="conversation">AI Dialogue</option>
                      </select>
                    </div>

                    {/* CSV Export Button */}
                    <button
                      onClick={handleDownloadCSV}
                      className="flex items-center space-x-1 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-lg shadow-emerald-700/10 active:scale-95 transition cursor-pointer"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>Export CSV</span>
                    </button>
                  </div>
                </div>

                {/* Score table */}
                <div className="glass-panel rounded-2xl border border-slate-800 overflow-hidden">
                  {getFilteredAssessments().length === 0 ? (
                    <div className="py-20 text-center text-slate-500 text-xs italic">
                      No assessment records match filters.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-left border-collapse text-xs">
                        <thead>
                          <tr className="bg-slate-900/60 border-b border-slate-850 text-slate-400 font-semibold uppercase tracking-wider">
                            <th className="py-3.5 px-6">Student</th>
                            <th className="py-3.5 px-6">School ID</th>
                            <th className="py-3.5 px-6">Class</th>
                            <th className="py-3.5 px-6">Date</th>
                            <th className="py-3.5 px-6">Score details</th>
                            <th className="py-3.5 px-6">Examiner Feedback</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-850 text-slate-300">
                          {getFilteredAssessments().map(record => (
                            <tr key={record.id} className="hover:bg-slate-900/10 transition">
                              <td className="py-4 px-6 font-bold text-white">{record.student?.full_name}</td>
                              <td className="py-4 px-6 font-mono text-[10px]">{record.student?.school_id}</td>
                              <td className="py-4 px-6">{record.student?.class?.class_name}</td>
                              <td className="py-4 px-6 text-slate-400 font-mono text-[10px]">
                                {new Date(record.created_at).toLocaleString()}
                              </td>
                              <td className="py-4 px-6">
                                {formatScoreDetails(record.mode, record.feedback)}
                              </td>
                              <td className="py-4 px-6 max-w-xs truncate italic text-slate-400" title={record.feedback?.feedback || record.feedback}>
                                {record.feedback?.feedback || record.feedback}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
export default TeacherDashboard;
