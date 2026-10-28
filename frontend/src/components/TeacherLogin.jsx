import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabaseTeacher as supabase } from '../utils/supabaseClient';
import { UserPlus, LogIn } from 'lucide-react';
import { Button } from './UI/Button';
import { Field, Input } from './UI/Field';
import { Alert } from './UI/Alert';
import { Logo } from './UI/Logo';

export function TeacherLogin() {
  const navigate = useNavigate();
  
  const [isSignUp, setIsSignUp] = useState(false);
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');

    try {
      if (isSignUp) {
        if (!fullName.trim()) throw new Error('Please enter your full name.');
        
        // Sign up
        const { data, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: {
              role: 'teacher',
              full_name: fullName.trim()
            }
          }
        });
        
        if (signUpError) throw signUpError;

        // Insert into teachers table explicitly so their profile exists for the admin to approve
        if (data?.user) {
          const { error: insertError } = await supabase
            .from('teachers')
            .insert({
              id: data.user.id,
              full_name: fullName.trim(),
              status: 'pending',
              is_admin: false
            });
            
          if (insertError) {
            console.error('Failed to create teacher profile:', insertError);
            throw new Error('Account created, but failed to create teacher profile.');
          }
        }
        
        setSuccess('Registration successful! Please log in.');
        setIsSignUp(false);
      } else {
        // Sign in
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        
        if (signInError) throw signInError;
        
        // Confirm user is indeed a teacher
        const { data: teacherProfile, error: profileError } = await supabase
          .from('teachers')
          .select('*')
          .eq('id', data.user.id)
          .single();
          
        if (profileError || !teacherProfile) {
          await supabase.auth.signOut();
          throw new Error('This account is not registered as a teacher.');
        }

        if (teacherProfile.status === 'pending') {
          await supabase.auth.signOut();
          throw new Error('Your account is pending admin approval. Please wait for an administrator to review your registration.');
        }
        
        if (teacherProfile.status === 'rejected') {
          await supabase.auth.signOut();
          throw new Error('Your registration request was rejected by an administrator.');
        }

        navigate('/teacher/dashboard');
      }
    } catch (err) {
      console.error('Teacher Auth Error:', err);
      setError(err.message || 'Authentication failed. Please verify credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col items-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-[420px] flex-1 flex flex-col">
        <div className="flex flex-col items-center text-center gap-4 mb-7">
          <Logo size="lg" markOnly />
          <div className="space-y-1.5">
            <h1 className="text-[26px] font-bold tracking-tight">{isSignUp ? 'Create a teacher account' : 'Teacher sign-in'}</h1>
            <p className="text-[15px] text-ink-muted">Manage classes, materials and your students' results.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="bg-surface border border-line rounded-2xl shadow-card p-5 sm:p-6 flex flex-col gap-5">
          {error && <Alert tone="error">{error}</Alert>}
          {success && <Alert tone="success">{success}</Alert>}

          {isSignUp && (
            <Field label="Full name">
              <Input type="text" required autoComplete="name" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            </Field>
          )}
          <Field label="Email">
            <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@school.edu" />
          </Field>
          <Field label="Password">
            <Input type="password" required autoComplete={isSignUp ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>

          <Button type="submit" size="lg" fullWidth loading={loading} icon={isSignUp ? UserPlus : LogIn}>
            {loading ? 'Please wait...' : isSignUp ? 'Create account' : 'Sign in'}
          </Button>

          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-sm font-semibold text-brand-ink hover:underline underline-offset-4"
          >
            {isSignUp ? 'Already have an account? Sign in' : 'New teacher? Create an account'}
          </button>
        </form>

        <p className="mt-auto pt-10 text-center text-sm text-ink-muted">
          Are you a student?{' '}
          <Link to="/student/login" className="font-semibold text-brand-ink hover:underline underline-offset-4">Go to student sign-in</Link>
        </p>
      </div>
    </div>
  );
}
export default TeacherLogin;
