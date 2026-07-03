import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import { Sparkles, BookOpen, Key, User, ShieldAlert, Check } from 'lucide-react';
import Spinner from './UI/Spinner';

export function StudentLogin() {
  const navigate = useNavigate();
  
  const [classCode, setClassCode] = useState('');
  const [studentsList, setStudentsList] = useState([]);
  const [selectedStudent, setSelectedStudent] = useState(null);
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [loadingStudents, setLoadingStudents] = useState(false);
  const [loggingIn, setLoggingIn] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Step 1: When class code is typed, fetch the list of students
  const handleClassCodeChange = async (e) => {
    const code = e.target.value.trim().toUpperCase().substring(0, 6);
    setClassCode(code);
    setError('');
    
    if (code.length === 6) {
      setLoadingStudents(true);
      try {
        const { data, error: rpcError } = await supabase.rpc('get_students_by_class_code', {
          p_class_code: code
        });
        
        if (rpcError) throw rpcError;
        
        if (data && data.length > 0) {
          setStudentsList(data);
          setSelectedStudent(data[0]); // Default to first student
        } else {
          setStudentsList([]);
          setSelectedStudent(null);
          setError('No students found for this class code.');
        }
      } catch (err) {
        console.error('Failed to fetch students:', err);
        setError('Failed to fetch class. Please check the code.');
        setStudentsList([]);
        setSelectedStudent(null);
      } finally {
        setLoadingStudents(false);
      }
    } else {
      setStudentsList([]);
      setSelectedStudent(null);
    }
  };

  const handleStudentSelect = (e) => {
    const studentId = e.target.value;
    const student = studentsList.find(s => s.id === studentId);
    setSelectedStudent(student);
  };

  // Step 2: Login the student
  const handleLogin = async (e) => {
    e.preventDefault();
    if (!selectedStudent || !classCode || !password) {
      setError('Please fill in all fields.');
      return;
    }
    
    setLoggingIn(true);
    setError('');
    
    // Construct dummy email: student_[school_id]@[class_code].HreFSpeak.com (with school_id sanitized)
    const rawSchoolId = (selectedStudent.school_id || selectedStudent.id || '').toString();
    const sanitizedSchoolId = rawSchoolId.replace(/[^a-zA-Z0-9]/g, '');
    const dummyEmail = `student_${sanitizedSchoolId}@${classCode}.HreFSpeak.com`.toLowerCase();
    
    try {
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email: dummyEmail,
        password: password
      });
      
      if (loginError) throw loginError;

      // Verify student details
      const { data: studentProfile, error: profileError } = await supabase
        .from('students')
        .select('*')
        .eq('id', data.user.id)
        .single();
        
      if (profileError || !studentProfile) {
        // If profile doesn't exist, sign out and error
        await supabase.auth.signOut();
        throw new Error('Student profile not found.');
      }
      
      // If student requires password change, keep them here to reset password
      if (studentProfile.requires_password_change) {
        setChangingPassword(true);
      } else {
        navigate('/practice');
      }
    } catch (err) {
      console.error('Login failed:', err);
      setError(err.message || 'Incorrect password.');
    } finally {
      setLoggingIn(false);
    }
  };

  // Step 3: Handle Mandatory Password Reset
  const handlePasswordChange = async (e) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      setError('Password must be at least 6 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    
    setLoggingIn(true);
    setError('');
    
    try {
      // 1. Update password in Supabase Auth
      const { error: authError } = await supabase.auth.updateUser({
        password: newPassword
      });
      
      if (authError) throw authError;
      
      // 2. Update requires_password_change flag in student table
      const { error: dbError } = await supabase
        .from('students')
        .update({ requires_password_change: false })
        .eq('id', (await supabase.auth.getUser()).data.user.id);
        
      if (dbError) throw dbError;
      
      setSuccess('Password updated successfully! Redirecting...');
      setTimeout(() => {
        navigate('/practice');
      }, 1500);
    } catch (err) {
      console.error('Password update failed:', err);
      setError(err.message || 'Failed to update password.');
    } finally {
      setLoggingIn(false);
    }
  };

  if (changingPassword) {
    return (
      <div className="min-h-screen bg-[#070b13] flex flex-col justify-center items-center px-4 relative overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-[100px] pointer-events-none animate-pulse-slow"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-[100px] pointer-events-none animate-pulse-slow [animation-delay:2s]"></div>
        
        <div className="w-full max-w-md glass-panel p-8 rounded-3xl border border-purple-500/10 shadow-2xl relative z-10 space-y-6">
          <div className="text-center space-y-2">
            <div className="w-12 h-12 bg-amber-500/10 rounded-2xl border border-amber-500/20 flex items-center justify-center mx-auto text-amber-400">
              <Key className="w-6 h-6 animate-bounce" />
            </div>
            <h2 className="text-2xl font-bold text-white tracking-tight">Set New Password</h2>
            <p className="text-slate-400 text-xs px-2 leading-relaxed">
              This is your first login. For security, you must update your password from your default School ID.
            </p>
          </div>
          
          {error && (
            <div className="p-3 bg-rose-500/15 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-center space-x-2">
              <ShieldAlert className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          
          {success && (
            <div className="p-3 bg-emerald-500/15 border border-emerald-500/20 rounded-xl text-xs text-emerald-400 flex items-center space-x-2">
              <Check className="w-4 h-4 shrink-0" />
              <span>{success}</span>
            </div>
          )}

          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div className="space-y-1 text-left">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">New Password</label>
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 6 characters"
                className="w-full px-4 py-2.5 bg-slate-900/60 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all text-sm font-medium"
              />
            </div>
            
            <div className="space-y-1 text-left">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Confirm New Password</label>
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                className="w-full px-4 py-2.5 bg-slate-900/60 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all text-sm font-medium"
              />
            </div>

            <button
              type="submit"
              disabled={loggingIn}
              className="w-full py-3 bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-purple-600/20 active:scale-[0.98] transition-all duration-200 disabled:opacity-50"
            >
              {loggingIn ? 'Updating...' : 'Update & Enter'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070b13] flex flex-col justify-center items-center px-4 relative overflow-hidden">
      {/* Background neon glows */}
      <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-600/10 rounded-full blur-[100px] pointer-events-none animate-pulse-slow"></div>
      <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-indigo-600/10 rounded-full blur-[100px] pointer-events-none animate-pulse-slow [animation-delay:2s]"></div>

      <div className="w-full max-w-md glass-panel p-8 rounded-3xl border border-purple-500/10 shadow-2xl relative z-10 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-purple-600/10 rounded-2xl border border-purple-500/20 flex items-center justify-center mx-auto text-purple-400">
            <Sparkles className="w-8 h-8 animate-pulse" />
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">
            href<span className="text-purple-500 font-medium">Speak</span>
          </h1>
          <p className="text-slate-400 text-xs">
            Student Assessment Platform
          </p>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/15 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleLogin} className="space-y-4">
          {/* Input 1: Class Code */}
          <div className="space-y-1 text-left">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Class Code</label>
            <div className="relative">
              <input
                type="text"
                required
                value={classCode}
                onChange={handleClassCodeChange}
                placeholder="Enter 6-character code"
                className="w-full px-4 py-2.5 bg-slate-900/60 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all text-sm font-semibold tracking-wider"
              />
              {loadingStudents && (
                <div className="absolute right-3 top-3">
                  <div className="w-4 h-4 border-2 border-purple-500/20 border-t-purple-500 rounded-full animate-spin"></div>
                </div>
              )}
            </div>
          </div>

          {/* Input 2: Dropdown of Student Names */}
          {studentsList.length > 0 && (
            <div className="space-y-1 text-left animate-fadeIn">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Your Name</label>
              <select
                value={selectedStudent?.id || ''}
                onChange={handleStudentSelect}
                className="w-full px-4 py-2.5 bg-slate-900 border border-slate-800 rounded-xl text-white focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all text-sm font-medium"
              >
                {studentsList.map((student) => (
                  <option key={student.id} value={student.id} className="bg-slate-950 text-white">
                    {student.full_name}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Input 3: Password */}
          {selectedStudent && (
            <div className="space-y-1 text-left animate-fadeIn">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Initially your School ID"
                className="w-full px-4 py-2.5 bg-slate-900/60 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500 transition-all text-sm font-medium"
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loggingIn || !selectedStudent}
            className="w-full py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-purple-600/20 active:scale-[0.98] transition-all duration-200 disabled:opacity-50"
          >
            {loggingIn ? 'Logging in...' : 'Start Practice'}
          </button>
        </form>

        <div className="pt-4 border-t border-slate-900 flex justify-between items-center text-xs">
          <span className="text-slate-500">Are you a Teacher?</span>
          <Link to="/teacher/login" className="text-purple-400 hover:text-purple-300 font-bold transition">
            Teacher Portal &rarr;
          </Link>
        </div>
      </div>
    </div>
  );
}
export default StudentLogin;
