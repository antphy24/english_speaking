import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../utils/supabaseClient';
import { LogOut, CheckCircle, XCircle, Users, UserCheck, Shield } from 'lucide-react';
import Spinner from './UI/Spinner';

export function AdminDashboard() {
  const navigate = useNavigate();
  const [adminProfile, setAdminProfile] = useState(null);
  const [teachers, setTeachers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState('');

  const fetchTeachers = async () => {
    try {
      const { data, error } = await supabase
        .from('teachers')
        .select('*')
        .order('created_at', { ascending: false });
        
      if (error) throw error;
      setTeachers(data);
    } catch (err) {
      setErrorMsg('Failed to fetch teachers: ' + err.message);
    }
  };

  useEffect(() => {
    const checkAuth = async () => {
      setLoading(true);
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        navigate('/admin/login');
        return;
      }
      
      const { data: profile, error } = await supabase
        .from('teachers')
        .select('*')
        .eq('id', user.id)
        .single();
        
      if (error || !profile || !profile.is_admin) {
        await supabase.auth.signOut();
        navigate('/admin/login');
        return;
      }
      
      setAdminProfile(profile);
      await fetchTeachers();
      setLoading(false);
    };
    
    checkAuth();
  }, [navigate]);

  const handleUpdateStatus = async (teacherId, newStatus) => {
    try {
      const { error } = await supabase
        .from('teachers')
        .update({ status: newStatus })
        .eq('id', teacherId);
        
      if (error) throw error;
      
      // Update local state
      setTeachers(teachers.map(t => t.id === teacherId ? { ...t, status: newStatus } : t));
    } catch (err) {
      alert('Failed to update status: ' + err.message);
    }
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/admin/login');
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center">
        <Spinner size="lg" color="text-fuchsia-500" />
      </div>
    );
  }

  const pendingTeachers = teachers.filter(t => t.status === 'pending');
  const otherTeachers = teachers.filter(t => t.status !== 'pending');

  return (
    <div className="min-h-screen bg-[#0b0f19] text-white">
      {/* Navbar */}
      <nav className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-md sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 bg-fuchsia-500/10 border border-fuchsia-500/20 rounded-xl flex items-center justify-center text-fuchsia-400">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-lg leading-tight tracking-tight">Admin Portal</h1>
              <p className="text-[10px] text-fuchsia-400 font-mono tracking-wider uppercase">HreFSpeak System</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="hidden sm:flex items-center space-x-2 px-3 py-1.5 bg-slate-800 rounded-lg border border-slate-700">
              <UserCheck className="w-4 h-4 text-fuchsia-400" />
              <span className="text-xs font-medium text-slate-300">{adminProfile?.full_name}</span>
            </div>
            <button 
              onClick={handleSignOut}
              className="p-2 text-slate-400 hover:text-white hover:bg-rose-500/10 hover:border-rose-500/20 border border-transparent rounded-lg transition"
              title="Sign Out"
            >
              <LogOut className="w-5 h-5" />
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {errorMsg && (
          <div className="bg-rose-500/10 border border-rose-500/20 text-rose-400 px-4 py-3 rounded-xl text-sm">
            {errorMsg}
          </div>
        )}

        {/* Dashboard Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-slate-400 text-sm font-medium">Total Teachers</p>
                <h3 className="text-3xl font-bold mt-1">{teachers.length}</h3>
              </div>
              <div className="w-12 h-12 bg-indigo-500/10 rounded-xl flex items-center justify-center text-indigo-400">
                <Users className="w-6 h-6" />
              </div>
            </div>
          </div>
          <div className="bg-fuchsia-900/10 border border-fuchsia-500/20 rounded-2xl p-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-fuchsia-400 text-sm font-medium">Pending Approvals</p>
                <h3 className="text-3xl font-bold mt-1 text-white">{pendingTeachers.length}</h3>
              </div>
              <div className="w-12 h-12 bg-fuchsia-500/20 rounded-xl flex items-center justify-center text-fuchsia-400">
                <UserCheck className="w-6 h-6" />
              </div>
            </div>
          </div>
        </div>

        {/* Pending Approvals */}
        {pendingTeachers.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-white flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-fuchsia-500 animate-pulse"></span>
              <span>Pending Approvals</span>
            </h2>
            <div className="bg-slate-900/60 border border-fuchsia-500/30 rounded-2xl overflow-hidden">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-800/50 text-slate-400 border-b border-slate-800">
                  <tr>
                    <th className="py-3 px-6 font-medium">Name</th>
                    <th className="py-3 px-6 font-medium">Email</th>
                    <th className="py-3 px-6 font-medium">Registered Date</th>
                    <th className="py-3 px-6 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800">
                  {pendingTeachers.map(teacher => (
                    <tr key={teacher.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-4 px-6 font-medium text-white">{teacher.full_name}</td>
                      <td className="py-4 px-6 text-slate-300">{teacher.id}</td>
                      <td className="py-4 px-6 text-slate-400">{new Date(teacher.created_at).toLocaleDateString()}</td>
                      <td className="py-4 px-6 flex justify-end space-x-2">
                        <button 
                          onClick={() => handleUpdateStatus(teacher.id, 'approved')}
                          className="flex items-center space-x-1 px-3 py-1.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 rounded-lg transition"
                        >
                          <CheckCircle className="w-4 h-4" />
                          <span>Approve</span>
                        </button>
                        <button 
                          onClick={() => handleUpdateStatus(teacher.id, 'rejected')}
                          className="flex items-center space-x-1 px-3 py-1.5 bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20 rounded-lg transition"
                        >
                          <XCircle className="w-4 h-4" />
                          <span>Reject</span>
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* All Teachers */}
        <div className="space-y-4">
          <h2 className="text-lg font-bold text-white">Teacher Directory</h2>
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-800/50 text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-3 px-6 font-medium">Name</th>
                  <th className="py-3 px-6 font-medium">Status</th>
                  <th className="py-3 px-6 font-medium">Role</th>
                  <th className="py-3 px-6 font-medium">Registered Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800">
                {otherTeachers.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="py-8 text-center text-slate-500 italic">No approved or rejected teachers found.</td>
                  </tr>
                ) : (
                  otherTeachers.map(teacher => (
                    <tr key={teacher.id} className="hover:bg-slate-800/30 transition">
                      <td className="py-4 px-6 font-medium text-white">{teacher.full_name}</td>
                      <td className="py-4 px-6">
                        <span className={`px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                          teacher.status === 'approved' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                          teacher.status === 'rejected' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                          'bg-slate-500/10 text-slate-400 border border-slate-500/20'
                        }`}>
                          {teacher.status}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-slate-400">
                        {teacher.is_admin ? <span className="text-fuchsia-400 font-medium">Admin</span> : 'Teacher'}
                      </td>
                      <td className="py-4 px-6 text-slate-400">{new Date(teacher.created_at).toLocaleDateString()}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </main>
    </div>
  );
}

export default AdminDashboard;
