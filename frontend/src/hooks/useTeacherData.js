import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';

export function useTeacherData() {
  const navigate = useNavigate();
  
  // Auth state
  const [teacher, setTeacher] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  
  // Data state
  const [classesList, setClassesList] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [allStudents, setAllStudents] = useState([]);
  const [allAssessments, setAllAssessments] = useState([]);
  const [customMaterials, setCustomMaterials] = useState([]);
  const [loadingData, setLoadingData] = useState(false);

  // Forms state
  const [newClassName, setNewClassName] = useState('');
  const [bulkStudentsText, setBulkStudentsText] = useState('');
  
  // Custom materials form state
  const [selectedClassMaterial, setSelectedClassMaterial] = useState(null);
  const [materialMode, setMaterialMode] = useState('read_aloud');
  const [materialTitle, setMaterialTitle] = useState('');
  const [materialContent, setMaterialContent] = useState('');

  // Feedback states
  const [actionError, setActionError] = useState('');
  const [actionSuccess, setActionSuccess] = useState('');
  const [importing, setImporting] = useState(false);
  const [importResults, setImportResults] = useState(null);

  // Filter and search state
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedClassFilter, setSelectedClassFilter] = useState('all');
  const [selectedModeFilter, setSelectedModeFilter] = useState('all');
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Reset pagination on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedClassFilter, selectedModeFilter]);

  // Verify auth session
  useEffect(() => {
    const checkAuth = async () => {
      setLoadingAuth(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/teacher/login');
        return;
      }
      
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
  const loadDashboardData = useCallback(async () => {
    if (!teacher) return;
    setLoadingData(true);
    setActionError('');
    
    try {
      // 1. Fetch Classes
      const { data: classesData, error: classesErr } = await supabase
        .from('classes')
        .select('*')
        .eq('teacher_id', teacher.id)
        .order('created_at', { ascending: false });
        
      if (classesErr) throw classesErr;
      setClassesList(classesData);
      
      if (classesData.length > 0) {
        setSelectedClass(prev => prev || classesData[0]);
        setSelectedClassMaterial(prev => prev || classesData[0]);
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
  }, [teacher]);

  useEffect(() => {
    if (!loadingAuth && teacher) {
      loadDashboardData();
    }
  }, [loadingAuth, teacher, loadDashboardData]);

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
      setClassesList(prev => [data, ...prev]);
      setSelectedClass(prev => prev || data);
      setSelectedClassMaterial(prev => prev || data);
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

  // Custom materials creation
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
      setCustomMaterials(prev => [data, ...prev]);
    } catch (err) {
      console.error('Failed to create material:', err);
      setActionError(err.message || 'Failed to create material.');
    }
  };

  // Custom materials deletion
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
      setCustomMaterials(prev => prev.filter(m => m.id !== materialId));
    } catch (err) {
      console.error('Failed to delete material:', err);
      setActionError(err.message || 'Failed to delete material.');
    }
  };

  // Filter scores based on queries
  const getFilteredAssessments = useCallback(() => {
    return allAssessments.filter(item => {
      const matchSearch = item.student?.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          item.student?.school_id?.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchClass = selectedClassFilter === 'all' || item.student?.class?.class_name === selectedClassFilter;
      const matchMode = selectedModeFilter === 'all' || item.mode === selectedModeFilter;
      
      return matchSearch && matchClass && matchMode;
    });
  }, [allAssessments, searchQuery, selectedClassFilter, selectedModeFilter]);

  // Export Assessment Records to CSV
  const handleDownloadCSV = useCallback(() => {
    const records = getFilteredAssessments();
    if (records.length === 0) {
      alert('No records found matching filters to download.');
      return;
    }

    const headers = ["Student Name", "School ID", "Class Name", "Date/Time", "Mode", "Overall Score", "Feedback text"];
    
    const rows = records.map(record => {
      let scoreStr = "";
      if (record.mode === 'read_aloud') {
        scoreStr = `${record.score}% Accuracy`;
      } else {
        scoreStr = `Band ${record.score.toFixed(1)}`;
      }
      
      const escapeCSV = (val) => `"${String(val ?? '').replace(/"/g, '""')}"`;
      
      return [
        escapeCSV(record.student?.full_name),
        escapeCSV(record.student?.school_id),
        escapeCSV(record.student?.class?.class_name),
        escapeCSV(new Date(record.created_at).toLocaleString()),
        escapeCSV(record.mode),
        escapeCSV(scoreStr),
        escapeCSV(record.feedback?.feedback || record.feedback)
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
  }, [getFilteredAssessments]);

  return {
    // Auth
    teacher,
    loadingAuth,
    handleSignOut,
    
    // Data
    classesList,
    selectedClass,
    setSelectedClass,
    allStudents,
    allAssessments,
    customMaterials,
    loadingData,
    loadDashboardData,
    
    // Forms
    newClassName,
    setNewClassName,
    bulkStudentsText,
    setBulkStudentsText,
    selectedClassMaterial,
    setSelectedClassMaterial,
    materialMode,
    setMaterialMode,
    materialTitle,
    setMaterialTitle,
    materialContent,
    setMaterialContent,
    
    // Feedback
    actionError,
    setActionError,
    actionSuccess,
    setActionSuccess,
    importing,
    importResults,
    setImportResults,
    
    // Filters & Pagination
    searchQuery,
    setSearchQuery,
    selectedClassFilter,
    setSelectedClassFilter,
    selectedModeFilter,
    setSelectedModeFilter,
    currentPage,
    setCurrentPage,
    itemsPerPage,
    
    // Actions
    handleCreateClass,
    handleBulkEnroll,
    handleCreateMaterial,
    handleDeleteMaterial,
    getFilteredAssessments,
    handleDownloadCSV,
  };
}
