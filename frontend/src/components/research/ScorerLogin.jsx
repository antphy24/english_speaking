import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn } from 'lucide-react';
import { Button } from '../UI/Button';
import { Field, Input } from '../UI/Field';
import { Alert } from '../UI/Alert';
import { Logo } from '../UI/Logo';
import { supabaseScorer } from '../../utils/supabaseClient';
import { scorerEmail } from '../../utils/researchApi';

export default function ScorerLogin() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    supabaseScorer.auth.getSession().then(({ data: { session } }) => {
      if (session?.user?.user_metadata?.role === 'scorer') navigate('/scorer');
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const { data, error: err } = await supabaseScorer.auth.signInWithPassword({ email: scorerEmail(username), password });
      if (err) throw new Error('Wrong username or password.');
      if (data.user?.user_metadata?.role !== 'scorer') {
        await supabaseScorer.auth.signOut();
        throw new Error('This is not a scorer account.');
      }
      navigate('/scorer');
    } catch (e2) {
      setError(e2.message);
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
            <h1 className="text-2xl font-bold tracking-tight">Scorer sign-in</h1>
            <p className="text-[15px] text-ink-muted">Use the username and password your teacher gave you.</p>
          </div>
        </div>
        <form onSubmit={submit} className="bg-surface border border-line rounded-2xl shadow-card p-5 sm:p-6 flex flex-col gap-5">
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Username">
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoCapitalize="none" autoComplete="username" required />
          </Field>
          <Field label="Password">
            <Input value={password} onChange={(e) => setPassword(e.target.value)} type="password" autoComplete="current-password" required />
          </Field>
          <Button type="submit" size="lg" fullWidth icon={LogIn} loading={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </Button>
        </form>
      </div>
    </div>
  );
}
