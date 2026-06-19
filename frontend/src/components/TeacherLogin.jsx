import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import { ShieldCheck, ShieldAlert, Check, UserPlus, LogIn } from 'lucide-react';

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
    <div className="min-h-screen bg-[#090f19] flex flex-col justify-center items-center px-4 relative overflow-hidden">
      {/* Background teal/emerald corporate glows */}
      <div className="absolute top-1/4 left-1/3 w-96 h-96 bg-teal-500/5 rounded-full blur-[100px] pointer-events-none animate-pulse-slow"></div>
      <div className="absolute bottom-1/4 right-1/3 w-96 h-96 bg-emerald-500/5 rounded-full blur-[100px] pointer-events-none animate-pulse-slow [animation-delay:2s]"></div>

      <div className="w-full max-w-md bg-slate-900/60 backdrop-blur-xl p-8 rounded-3xl border border-teal-500/10 shadow-2xl relative z-10 space-y-6">
        <div className="text-center space-y-2">
          <div className="w-16 h-16 bg-teal-500/10 rounded-2xl border border-teal-500/20 flex items-center justify-center mx-auto text-teal-400">
            <ShieldCheck className="w-8 h-8 animate-pulse" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">
            href<span className="text-teal-400 font-medium">Speak</span>
          </h1>
          <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest text-teal-400/80">
            Teacher Administration Portal
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

        <form onSubmit={handleSubmit} className="space-y-4">
          {isSignUp && (
            <div className="space-y-1 text-left animate-fadeIn">
              <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Full Name</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Enter your name"
                className="w-full px-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all text-sm font-medium"
              />
            </div>
          )}

          <div className="space-y-1 text-left">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Email Address</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@school.edu"
              className="w-full px-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all text-sm font-medium"
            />
          </div>

          <div className="space-y-1 text-left">
            <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full px-4 py-2.5 bg-slate-950/80 border border-slate-800 rounded-xl text-white placeholder-slate-600 focus:outline-none focus:border-teal-500 focus:ring-1 focus:ring-teal-500 transition-all text-sm font-medium"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 bg-teal-600 hover:bg-teal-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-teal-600/20 active:scale-[0.98] transition-all duration-200 disabled:opacity-50 flex items-center justify-center space-x-2 cursor-pointer"
          >
            {isSignUp ? <UserPlus className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
            <span>{loading ? 'Processing...' : isSignUp ? 'Create Account' : 'Log In'}</span>
          </button>
        </form>

        <div className="flex flex-col space-y-3 pt-4 border-t border-slate-800 text-xs">
          <button
            type="button"
            onClick={() => setIsSignUp(!isSignUp)}
            className="text-teal-400 hover:text-teal-300 font-bold transition text-center cursor-pointer"
          >
            {isSignUp ? 'Already have an admin account? Log In' : 'Need an admin account? Create one'}
          </button>
          
          <Link to="/student/login" className="text-slate-500 hover:text-slate-400 font-semibold transition text-center">
            &larr; Back to Student Practice
          </Link>
        </div>
      </div>
    </div>
  );
}
export default TeacherLogin;
