import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabaseAdmin as supabase } from '../utils/supabaseClient';
import { Shield } from 'lucide-react';
import { Button } from './UI/Button';
import { Field, Input } from './UI/Field';
import { Alert } from './UI/Alert';
import { Logo } from './UI/Logo';

export function AdminLogin() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password
      });
      
      if (signInError) throw signInError;
      
      // Confirm user is an admin
      const { data: teacherProfile, error: profileError } = await supabase
        .from('teachers')
        .select('*')
        .eq('id', data.user.id)
        .single();
        
      if (profileError || !teacherProfile || !teacherProfile.is_admin) {
        await supabase.auth.signOut();
        throw new Error('This account does not have administrator privileges.');
      }

      navigate('/admin/dashboard');
    } catch (err) {
      console.error('Admin Auth Error:', err);
      setError(err.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas text-ink flex flex-col items-center px-4 py-10 sm:py-16">
      <div className="w-full max-w-[400px]">
        <div className="flex flex-col items-center text-center gap-4 mb-7">
          <Logo size="lg" markOnly />
          <div className="space-y-1.5">
            <h1 className="text-2xl font-bold tracking-tight">Admin sign-in</h1>
            <p className="text-[15px] text-ink-muted">For HreFSpeak system administrators only.</p>
          </div>
        </div>
        <form onSubmit={handleSubmit} className="bg-surface border border-line rounded-2xl shadow-card p-5 sm:p-6 flex flex-col gap-5">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Email">
            <Input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field label="Password">
            <Input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </Field>
          <Button type="submit" size="lg" fullWidth icon={Shield} loading={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}

export default AdminLogin;
