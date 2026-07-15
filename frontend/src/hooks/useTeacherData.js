import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabaseTeacher as supabase } from '../utils/supabaseClient';
import { useConfirm } from '../components/UI/ConfirmModal';

export function useTeacherData() {
  const navigate = useNavigate();
  const confirm = useConfirm();
  
  // Auth state
  const [teacher, setTeacher] = useState(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  
  // Data state
  const [classesList, setClassesList] = useState([]);
  const [selectedClass, setSelectedClass] = useState(null);
  const [allStudents, setAllStudents] = useState([]);
  const [allAssessments, setAllAssessments] = useState([]);
  const [customMaterials, setCustomMaterials] = useState([]);
  const [activityData, setActivityData] = useState([]);
  const [loadingData, setLoadingData] = useState(false);

  // Activity monitor state
  const [selectedActivityClass, setSelectedActivityClass] = useState('all');

  // Editing state
  const [editingMaterial, setEditingMaterial] = useState(null);

  // Forms state
  const [newClassName, setNewClassName] = useState('');
  const [newClassCode, setNewClassCode] = useState('');
  const [newGradeLevel, setNewGradeLevel] = useState('General');
  const [bulkStudentsText, setBulkStudentsText] = useState('');
  
  // Custom materials form state
  const [selectedClassesMaterial, setSelectedClassesMaterial] = useState([]);
  const [materialCreationMode, setMaterialCreationMode] = useState('class'); // 'class' or 'global'
  const [globalGradeLevel, setGlobalGradeLevel] = useState('General');
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
  const [selectedMaterialFilter, setSelectedMaterialFilter] = useState('all');
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Reset pagination on filter change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, selectedClassFilter, selectedModeFilter, selectedMaterialFilter]);

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
        setSelectedClassesMaterial(prev => prev.length > 0 ? prev : [classesData[0].id]);
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
        // Load materials for classes + if admin, all global materials (where class_id is null)
        let materialQuery = supabase
          .from('custom_materials')
          .select('*, class:classes(class_name)')
          .order('created_at', { ascending: false });
        
        if (teacher.is_admin) {
          // Admin sees everything assigned to their classes AND global materials
          const idString = classIds.join(',');
          materialQuery = materialQuery.or(`class_id.in.(${idString}),class_id.is.null`);
        } else {
          // Regular teachers only see their own classes materials
          materialQuery = materialQuery.in('class_id', classIds);
        }

        const { data: materialsData, error: materialsErr } = await materialQuery;
          
        if (materialsErr) throw materialsErr;
        setCustomMaterials(materialsData || []);

        // 5. Fetch Activity Logs
        if (studentIds.length > 0) {
          const { data: activityLogsData, error: activityErr } = await supabase
            .from('activity_logs')
            .select('*')
            .in('student_id', studentIds)
            .order('created_at', { ascending: false });

          if (activityErr) throw activityErr;
          setActivityData(activityLogsData || []);
        } else {
          setActivityData([]);
        }

      } else {
        setAllStudents([]);
        setAllAssessments([]);
        setCustomMaterials([]);
        setActivityData([]);
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
    const confirmed = await confirm({
      title: 'Log Out',
      message: 'Are you sure you want to log out from the teacher portal?',
      confirmLabel: 'Log Out',
      variant: 'logout',
    });
    if (confirmed) {
      await supabase.auth.signOut();
      navigate('/teacher/login');
    }
  };

  // Create a new class
  const handleCreateClass = async (e) => {
    e.preventDefault();
    if (!newClassName.trim() || !newClassCode.trim()) return;
    
    setActionError('');
    setActionSuccess('');
    
    try {
      const { data, error } = await supabase
        .from('classes')
        .insert({
          teacher_id: teacher.id,
          class_name: newClassName.trim(),
          class_code: newClassCode.trim(),
          grade_level: newGradeLevel
        })
        .select()
        .single();
        
      if (error) throw error;
      
      setActionSuccess(`Class "${newClassName.trim()}" created successfully! Code: ${newClassCode.trim()} (${newGradeLevel})`);
      setNewClassName('');
      setNewClassCode('');
      setNewGradeLevel('General');
      setClassesList(prev => [data, ...prev]);
      setSelectedClass(prev => prev || data);
      setSelectedClassMaterial(prev => prev || data);
    } catch (err) {
      console.error('Create class failed:', err);
      setActionError(err.message || 'Failed to create class. Code collision? Try again.');
    }
  };

  // Update a class
  const handleUpdateClass = async (classId, updates) => {
    setActionError('');
    setActionSuccess('');
    
    try {
      const { data, error } = await supabase
        .from('classes')
        .update(updates)
        .eq('id', classId)
        .select()
        .single();
        
      if (error) throw error;
      
      setActionSuccess('Class updated successfully!');
      setClassesList(prev => prev.map(c => c.id === classId ? { ...c, ...updates } : c));
      if (selectedClass?.id === classId) setSelectedClass(prev => ({ ...prev, ...updates }));
    } catch (err) {
      console.error('Update class failed:', err);
      setActionError(err.message || 'Failed to update class.');
    }
  };

  // Delete a class
  const handleDeleteClass = async (classId, className) => {
    const confirmed = await confirm({
      title: 'Delete Class',
      message: `Delete class "${className}"? This will permanently delete ALL students, their assessment data, and their activity logs. This action cannot be undone.`,
      confirmLabel: 'Delete Class & All Data',
      variant: 'danger',
    });
    if (!confirmed) return;

    setActionError('');
    setActionSuccess('');
    
    const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const sessionToken = session?.access_token;
      
      if (!sessionToken) throw new Error('Teacher session expired. Please log in again.');

      const response = await fetch(`${API_BASE}/teacher/delete-class`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`
        },
        body: JSON.stringify({ classId })
      });

      if (!response.ok) {
        const errText = await response.text();
        let errMsg = 'Failed to delete class.';
        try {
          const parsed = JSON.parse(errText);
          errMsg = parsed.detail || errMsg;
        } catch (_) {}
        throw new Error(errMsg);
      }

      setActionSuccess(`Class "${className}" deleted successfully.`);
      setClassesList(prev => prev.filter(c => c.id !== classId));
      if (selectedClass?.id === classId) setSelectedClass(null);
      setSelectedClassesMaterial(prev => prev.filter(id => id !== classId));
      // Remove associated students and assessments from state
      setAllStudents(prev => prev.filter(s => s.class_id !== classId));
      setAllAssessments(prev => prev.filter(a => a.student?.class?.class_name !== className)); // best effort based on current state shape
      setActivityData(prev => prev.filter(a => a.class_id !== classId));
    } catch (err) {
      console.error('Delete class failed:', err);
      setActionError(err.message || 'Failed to delete class.');
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

  // Unenroll a single student from a class
  const handleUnenrollStudent = async (studentId, studentName, classId) => {
    const confirmed = await confirm({
      title: 'Unenroll Student',
      message: `Remove "${studentName}" from this class? This will delete their account and all associated assessment data.`,
      confirmLabel: 'Remove Student',
      variant: 'danger',
    });
    if (!confirmed) return;

    setActionError('');
    setActionSuccess('');

    const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const sessionToken = session?.access_token;

      if (!sessionToken) {
        throw new Error('Teacher session expired. Please log in again.');
      }

      const response = await fetch(`${API_BASE}/teacher/unenroll-student`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`
        },
        body: JSON.stringify({ studentId, classId })
      });

      if (!response.ok) {
        const errText = await response.text();
        let errMsg = 'Failed to unenroll student.';
        try {
          const parsed = JSON.parse(errText);
          errMsg = parsed.detail || errMsg;
        } catch (_) {}
        throw new Error(errMsg);
      }

      // Remove student from local state immediately
      setAllStudents(prev => prev.filter(s => s.id !== studentId));
      setAllAssessments(prev => prev.filter(a => a.student_id !== studentId));
      setActivityData(prev => prev.filter(a => a.student_id !== studentId));
      setActionSuccess(`"${studentName}" has been unenrolled successfully.`);
    } catch (err) {
      console.error('Unenroll failed:', err);
      setActionError(err.message || 'Failed to unenroll student.');
    }
  };

  // Update a student
  const handleUpdateStudent = async (studentId, updates) => {
    setActionError('');
    setActionSuccess('');
    
    try {
      const { data, error } = await supabase
        .from('students')
        .update(updates)
        .eq('id', studentId)
        .select()
        .single();
        
      if (error) throw error;
      
      setActionSuccess('Student updated successfully!');
      setAllStudents(prev => prev.map(s => s.id === studentId ? { ...s, ...updates } : s));
      // Optionally update assessments display if needed, but it's tricky with nested fields. Better to just let loadDashboardData catch it on next refresh or just update the main list.
    } catch (err) {
      console.error('Update student failed:', err);
      setActionError(err.message || 'Failed to update student.');
    }
  };

  // Reset student password
  const handleResetStudentPassword = async (studentId, schoolId, studentName, classId) => {
    const confirmed = await confirm({
      title: 'Reset Password',
      message: `Reset password for "${studentName}"? Their password will be reset to their school ID (${schoolId}) and they will be forced to change it on their next login.`,
      confirmLabel: 'Reset Password',
      variant: 'warning',
    });
    if (!confirmed) return;

    setActionError('');
    setActionSuccess('');
    
    const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const sessionToken = session?.access_token;
      
      if (!sessionToken) throw new Error('Teacher session expired. Please log in again.');

      const response = await fetch(`${API_BASE}/teacher/reset-student-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`
        },
        body: JSON.stringify({ studentId, schoolId, classId })
      });

      if (!response.ok) {
        const errText = await response.text();
        let errMsg = 'Failed to reset password.';
        try {
          const parsed = JSON.parse(errText);
          errMsg = parsed.detail || errMsg;
        } catch (_) {}
        throw new Error(errMsg);
      }

      setActionSuccess(`Password reset successfully for "${studentName}".`);
      setAllStudents(prev => prev.map(s => s.id === studentId ? { ...s, requires_password_change: true } : s));
    } catch (err) {
      console.error('Reset password failed:', err);
      setActionError(err.message || 'Failed to reset password.');
    }
  };

  // Custom materials creation
  const handleCreateMaterial = async (e) => {
    e.preventDefault();
    if (materialCreationMode === 'class' && selectedClassesMaterial.length === 0) {
      setActionError('Please select at least one class.');
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

    const isGlobal = teacher?.is_admin && materialCreationMode === 'global';

    try {
      let insertData = [];
      if (isGlobal) {
        insertData.push({
          class_id: null,
          grade_level: globalGradeLevel,
          mode: materialMode,
          title: titleVal,
          content: materialContent.trim()
        });
      } else {
        insertData = selectedClassesMaterial.map(classId => ({
          class_id: classId,
          grade_level: classesList.find(c => c.id === classId)?.grade_level || 'General',
          mode: materialMode,
          title: titleVal,
          content: materialContent.trim()
        }));
      }

      const { data, error } = await supabase
        .from('custom_materials')
        .insert(insertData)
        .select('*, class:classes(class_name)');

      if (error) throw error;

      if (isGlobal) {
        setActionSuccess(`Global default material added successfully for grade "${globalGradeLevel}"!`);
      } else {
        setActionSuccess(`Custom material assigned to ${selectedClassesMaterial.length} class(es) successfully!`);
      }
      setMaterialTitle('');
      setMaterialContent('');
      setCustomMaterials(prev => [...data, ...prev]);
    } catch (err) {
      console.error('Failed to create material:', err);
      setActionError(err.message || 'Failed to create material.');
    }
  };

  // Update a custom material group
  const handleUpdateMaterialGroup = async (groupMaterials, updates, newClassIds) => {
    setActionError('');
    setActionSuccess('');
    
    try {
      // 1. Update existing materials (title & content)
      const existingIds = groupMaterials.map(m => m.id);
      
      let updatedData = [];
      if (existingIds.length > 0) {
        const { data, error } = await supabase
          .from('custom_materials')
          .update(updates)
          .in('id', existingIds)
          .select('*, class:classes(class_name)');
        
        if (error) throw error;
        updatedData = data || [];
      }
      
      // If global, we're done (global materials don't have newClassIds assigned).
      // If class, we handle adds/removes
      let newInsertedData = [];
      let deletedIds = [];
      
      if (!groupMaterials[0]?.isGlobal && newClassIds) {
        const currentClassIds = groupMaterials.map(m => m.class_id);
        const toAdd = newClassIds.filter(id => !currentClassIds.includes(id));
        const toRemove = currentClassIds.filter(id => !newClassIds.includes(id));
        
        // Remove unassigned classes
        if (toRemove.length > 0) {
          const materialIdsToRemove = groupMaterials.filter(m => toRemove.includes(m.class_id)).map(m => m.id);
          const { error: deleteErr } = await supabase
            .from('custom_materials')
            .delete()
            .in('id', materialIdsToRemove);
          if (deleteErr) throw deleteErr;
          deletedIds = materialIdsToRemove;
        }
        
        // Add newly assigned classes
        if (toAdd.length > 0) {
          const insertData = toAdd.map(classId => ({
            class_id: classId,
            grade_level: classesList.find(c => c.id === classId)?.grade_level || 'General',
            mode: groupMaterials[0].mode,
            title: updates.title,
            content: updates.content
          }));
          
          const { data: inserted, error: insertErr } = await supabase
            .from('custom_materials')
            .insert(insertData)
            .select('*, class:classes(class_name)');
            
          if (insertErr) throw insertErr;
          newInsertedData = inserted || [];
        }
      }
      
      setActionSuccess('Material group updated successfully!');
      
      // Update local state
      setCustomMaterials(prev => {
        let next = [...prev];
        // Remove deleted
        if (deletedIds.length > 0) {
          next = next.filter(m => !deletedIds.includes(m.id));
        }
        // Update existing
        if (updatedData.length > 0) {
          const updateMap = new Map(updatedData.map(m => [m.id, m]));
          next = next.map(m => updateMap.has(m.id) ? updateMap.get(m.id) : m);
        }
        // Add new
        if (newInsertedData.length > 0) {
          next = [...newInsertedData, ...next];
        }
        return next;
      });
      
      setEditingMaterial(null);
      setMaterialTitle('');
      setMaterialContent('');
    } catch (err) {
      console.error('Update material failed:', err);
      setActionError(err.message || 'Failed to update material.');
    }
  };

  // Custom materials deletion
  const handleDeleteMaterialGroup = async (materialIds) => {
    const confirmed = await confirm({
      title: 'Delete Material',
      message: 'Are you sure you want to delete this custom material from all assigned classes? This action cannot be undone.',
      confirmLabel: 'Delete',
      variant: 'danger',
    });
    if (!confirmed) return;

    setActionError('');
    setActionSuccess('');

    try {
      const { error } = await supabase
        .from('custom_materials')
        .delete()
        .in('id', materialIds);

      if (error) throw error;

      setActionSuccess('Material deleted successfully from all classes.');
      setCustomMaterials(prev => prev.filter(m => !materialIds.includes(m.id)));
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
      
      const materialTitle = item.feedback?.material_title || item.feedback?.motion || 'Default Material';
      const matchMaterial = selectedMaterialFilter === 'all' || materialTitle === selectedMaterialFilter;
      
      return matchSearch && matchClass && matchMode && matchMaterial;
    });
  }, [allAssessments, searchQuery, selectedClassFilter, selectedModeFilter, selectedMaterialFilter]);

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
      } else if (record.mode === 'debate') {
        scoreStr = `${Math.round(record.score)}/100 Debate`;
      } else {
        scoreStr = `${Math.round(record.score)}/100 Score`;
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
    activityData,
    loadingData,
    loadDashboardData,
    
    // Activity Monitor
    selectedActivityClass,
    setSelectedActivityClass,
    
    // Forms
    newClassName,
    setNewClassName,
    newClassCode,
    setNewClassCode,
    newGradeLevel,
    setNewGradeLevel,
    bulkStudentsText,
    setBulkStudentsText,
    selectedClassesMaterial,
    setSelectedClassesMaterial,
    materialCreationMode,
    setMaterialCreationMode,
    globalGradeLevel,
    setGlobalGradeLevel,
    materialMode,
    setMaterialMode,
    materialTitle,
    setMaterialTitle,
    materialContent,
    setMaterialContent,
    editingMaterial,
    setEditingMaterial,
    
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
    selectedMaterialFilter,
    setSelectedMaterialFilter,
    currentPage,
    setCurrentPage,
    itemsPerPage,
    
    // Actions
    handleCreateClass,
    handleUpdateClass,
    handleDeleteClass,
    handleBulkEnroll,
    handleUnenrollStudent,
    handleUpdateStudent,
    handleResetStudentPassword,
    handleCreateMaterial,
    handleUpdateMaterialGroup,
    handleDeleteMaterialGroup,
    getFilteredAssessments,
    handleDownloadCSV,
  };
}
