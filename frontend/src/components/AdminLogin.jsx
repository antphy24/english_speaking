import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabaseAdmin as supabase } from '../utils/supabaseClient';
import { ShieldAlert, Shield } from 'lucide-react';

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
    <div className="min-h-screen bg-[#0b0f19] flex flex-col justify-center items-center px-4 relative overflow-hidden">
      <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-fuchsia-500/10 rounded-full blur-[100px] pointer-events-none animate-pulse-slow"></div>

      <div className="w-full max-w-md bg-slate-900/60 backdrop-blur-xl p-8 rounded-3xl border border-fuchsia-500/20 shadow-2xl relative z-10 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-fuchsia-500/10 rounded-2xl border border-fuchsia-500/30 flex items-center justify-center mx-auto text-fuchsia-400">
            <Shield className="w-8 h-8" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">
            System <span className="text-fuchsia-400 font-medium">Admin</span>
          </h1>
        </div>

        {error && (
          <div className="p-3 bg-rose-500/15 border border-rose-500/20 rounded-xl text-xs text-rose-400 flex items-center space-x-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400 pl-1">Admin Email</label>
            <input 
              type="email" 
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full bg-slate-950/50 border border-slate-800 focus:border-fuchsia-500/50 rounded-xl px-4 py-3 text-white focus:ring-1 focus:ring-fuchsia-500/50 outline-none transition"
              placeholder="admin@example.com"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-slate-400 pl-1">Password</label>
            <input 
              type="password" 
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full bg-slate-950/50 border border-slate-800 focus:border-fuchsia-500/50 rounded-xl px-4 py-3 text-white focus:ring-1 focus:ring-fuchsia-500/50 outline-none transition"
              placeholder="••••••••"
            />
          </div>

          <button 
            type="submit" 
            disabled={loading}
            className="w-full bg-gradient-to-r from-fuchsia-600 to-purple-600 hover:from-fuchsia-500 hover:to-purple-500 text-white rounded-xl py-3.5 font-bold transition flex justify-center items-center disabled:opacity-70 shadow-lg shadow-fuchsia-500/20"
          >
            {loading ? 'Authenticating...' : 'Secure Login'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default AdminLogin;
