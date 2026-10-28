import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import { Key, Loader2 } from 'lucide-react';
import { Button } from './UI/Button';
import { Field, Input, Select } from './UI/Field';
import { Alert } from './UI/Alert';
import { Logo, Wordmark } from './UI/Logo';

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
          const sortedData = [...data].sort((a, b) => a.full_name.localeCompare(b.full_name));
          setStudentsList(sortedData);
          setSelectedStudent(sortedData[0]); // Default to first student
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
    
    let loginPassword = password.trim();
    if (loginPassword.length < 6) {
      loginPassword = loginPassword.padEnd(6, '0');
    }
    
    try {
      const { data, error: loginError } = await supabase.auth.signInWithPassword({
        email: dummyEmail,
        password: loginPassword
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

  const shell = (children) => (
    <div className="min-h-screen bg-canvas text-ink flex flex-col items-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-[420px] flex-1 flex flex-col">{children}</div>
    </div>
  );

  if (changingPassword) {
    return shell(
      <>
        <div className="flex flex-col items-center text-center gap-3 mb-7">
          <div className="w-12 h-12 rounded-full bg-brand-tint text-brand-ink flex items-center justify-center">
            <Key className="w-6 h-6" aria-hidden="true" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Set a new password</h1>
          <p className="text-[15px] text-ink-muted leading-relaxed">
            This is your first sign-in. Please replace the starting password (your School ID) with your own.
          </p>
        </div>

        <form onSubmit={handlePasswordChange} className="bg-surface border border-line rounded-2xl shadow-card p-5 sm:p-6 flex flex-col gap-5">
          {error && <Alert tone="error">{error}</Alert>}
          {success && <Alert tone="success">{success}</Alert>}

          <Field label="New password" hint="At least 6 characters.">
            <Input
              type="password"
              required
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </Field>
          <Field label="Type it again">
            <Input
              type="password"
              required
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </Field>

          <Button type="submit" size="lg" fullWidth loading={loggingIn}>
            {loggingIn ? 'Updating...' : 'Save and start practising'}
          </Button>
        </form>
      </>
    );
  }

  return shell(
    <>
      <div className="flex flex-col items-center text-center gap-4 mb-7">
        <Logo size="lg" markOnly />
        <div className="space-y-1.5">
          <h1 className="text-[26px] font-bold tracking-tight">Welcome to <Wordmark /></h1>
          <p className="text-[15px] text-ink-muted">Practise speaking English and get feedback on every attempt.</p>
        </div>
      </div>

      <form onSubmit={handleLogin} className="bg-surface border border-line rounded-2xl shadow-card p-5 sm:p-6 flex flex-col gap-5">
        {error && <Alert tone="error">{error}</Alert>}

        <Field label="Class code" htmlFor="class-code" hint={studentsList.length === 0 ? "6 letters or numbers. Ask your teacher if you don't know it." : undefined}>
          <div className="relative">
            <Input
              id="class-code"
              type="text"
              required
              value={classCode}
              onChange={handleClassCodeChange}
              placeholder="e.g. AB12CD"
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              className="font-semibold tracking-[0.15em] uppercase pr-11"
            />
            {loadingStudents && (
              <Loader2 className="absolute right-3.5 top-1/2 -translate-y-1/2 w-5 h-5 text-brand animate-spin" aria-label="Finding your class" />
            )}
          </div>
        </Field>

        {studentsList.length > 0 && (
          <Field label="Your name">
            <Select value={selectedStudent?.id || ''} onChange={handleStudentSelect}>
              {studentsList.map((student) => (
                <option key={student.id} value={student.id}>
                  {student.full_name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        {selectedStudent && (
          <Field label="Password" hint="The first time, this is your School ID.">
            <Input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Field>
        )}

        <Button type="submit" size="lg" fullWidth loading={loggingIn} disabled={!selectedStudent}>
          {loggingIn ? 'Signing in...' : 'Start practising'}
        </Button>
      </form>

      <p className="mt-auto pt-10 text-center text-sm text-ink-muted">
        Are you a teacher?{' '}
        <Link to="/teacher/login" className="font-semibold text-brand-ink hover:underline underline-offset-4">
          Sign in here
        </Link>
      </p>
    </>
  );
}
export default StudentLogin;
