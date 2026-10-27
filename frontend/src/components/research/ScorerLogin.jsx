import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Headphones, LogIn, ShieldAlert } from 'lucide-react';
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
    <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center px-4">
      <form onSubmit={submit} className="w-full max-w-sm bg-slate-900/60 border border-slate-800 rounded-2xl p-6 space-y-4">
        <div className="text-center space-y-1">
          <Headphones className="w-8 h-8 text-indigo-400 mx-auto" />
          <h1 className="text-lg font-bold text-white">HreFSpeak · Scorer</h1>
          <p className="text-xs text-slate-400">Log in with the username and password from the teacher.</p>
        </div>
        <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" autoCapitalize="none" autoComplete="username" required
               className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" type="password" autoComplete="current-password" required
               className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500" />
        {error && <p className="text-xs text-rose-400 flex items-center gap-1.5"><ShieldAlert className="w-4 h-4" />{error}</p>}
        <button disabled={loading} className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white text-sm font-bold">
          <LogIn className="w-4 h-4" />{loading ? 'Logging in...' : 'Log in'}
        </button>
      </form>
    </div>
  );
}
