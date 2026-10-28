import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabaseAdmin as supabase } from '../utils/supabaseClient';
import { LogOut, CheckCircle, XCircle, Users, UserCheck, Shield } from 'lucide-react';
import { Button } from './UI/Button';
import { Alert } from './UI/Alert';
import { Logo } from './UI/Logo';
import { StatTile } from './UI/StatTile';
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
      <div className="min-h-screen bg-canvas flex items-center justify-center">
        <Spinner size="lg" message="Loading..." />
      </div>
    );
  }

  const pendingTeachers = teachers.filter(t => t.status === 'pending');
  const otherTeachers = teachers.filter(t => t.status !== 'pending');

  return (
    <div className="min-h-screen bg-canvas text-ink">
      {/* Navbar */}
      <nav className="border-b border-line bg-surface sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Logo size="sm" markOnly />
            <div className="leading-tight">
              <h1 className="font-bold text-base">HreFSpeak admin</h1>
              <p className="text-xs text-ink-subtle">Teacher accounts</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <div className="hidden sm:flex items-center gap-2 text-sm">
              <UserCheck className="w-4 h-4 text-ink-subtle" aria-hidden="true" />
              <span className="font-medium text-ink-muted">{adminProfile?.full_name}</span>
            </div>
            <Button variant="subtle" size="sm" icon={LogOut} onClick={handleSignOut}>Sign out</Button>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        {errorMsg && (
          <Alert tone="error">{errorMsg}</Alert>
        )}

        {/* Dashboard Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <StatTile label="Teachers" value={teachers.length} icon={Users} />
          <StatTile label="Waiting for approval" value={pendingTeachers.length} icon={UserCheck} tone={pendingTeachers.length ? 'warning' : 'neutral'} />
        </div>

        {/* Pending Approvals */}
        {pendingTeachers.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-bold text-ink flex items-center space-x-2">
              <span className="w-2 h-2 rounded-full bg-warning"></span>
              <span>Waiting for approval</span>
            </h2>
            <div className="bg-surface border border-line rounded-2xl overflow-x-auto shadow-card">
              <table className="w-full text-left text-sm">
                <thead className="bg-surface-muted text-ink-muted text-[13px] border-b border-line">
                  <tr>
                    <th className="py-3 px-6 font-medium">Name</th>
                    <th className="py-3 px-6 font-medium">Email</th>
                    <th className="py-3 px-6 font-medium">Registered Date</th>
                    <th className="py-3 px-6 font-medium text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pendingTeachers.map(teacher => (
                    <tr key={teacher.id} className="hover:bg-surface-muted transition">
                      <td className="py-4 px-6 font-medium text-ink">{teacher.full_name}</td>
                      <td className="py-4 px-6 text-ink-muted">{teacher.id}</td>
                      <td className="py-4 px-6 text-ink-muted">{new Date(teacher.created_at).toLocaleDateString()}</td>
                      <td className="py-4 px-6 flex justify-end space-x-2">
                        <button 
                          onClick={() => handleUpdateStatus(teacher.id, 'approved')}
                          className="inline-flex items-center gap-1.5 min-h-[36px] px-3 bg-success text-white font-semibold hover:brightness-95 rounded-lg transition"
                        >
                          <CheckCircle className="w-4 h-4" />
                          <span>Approve</span>
                        </button>
                        <button 
                          onClick={() => handleUpdateStatus(teacher.id, 'rejected')}
                          className="inline-flex items-center gap-1.5 min-h-[36px] px-3 bg-surface text-danger border border-line-strong font-semibold hover:bg-danger-tint rounded-lg transition"
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
          <h2 className="text-lg font-bold text-ink">All teachers</h2>
          <div className="bg-surface border border-line rounded-2xl overflow-x-auto shadow-card">
            <table className="w-full text-left text-sm">
              <thead className="bg-surface-muted text-ink-muted text-[13px] border-b border-line">
                <tr>
                  <th className="py-3 px-6 font-medium">Name</th>
                  <th className="py-3 px-6 font-medium">Status</th>
                  <th className="py-3 px-6 font-medium">Role</th>
                  <th className="py-3 px-6 font-medium">Registered Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {otherTeachers.length === 0 ? (
                  <tr>
                    <td colSpan="4" className="py-8 text-center text-ink-subtle italic">No approved or rejected teachers found.</td>
                  </tr>
                ) : (
                  otherTeachers.map(teacher => (
                    <tr key={teacher.id} className="hover:bg-surface-muted transition">
                      <td className="py-4 px-6 font-medium text-ink">{teacher.full_name}</td>
                      <td className="py-4 px-6">
                        <span className={`inline-flex items-center h-6 px-2.5 rounded-full text-xs font-semibold capitalize ${
                          teacher.status === 'approved' ? 'bg-success-tint text-success' :
                          teacher.status === 'rejected' ? 'bg-danger-tint text-danger' :
                          'bg-surface-muted text-ink-muted'
                        }`}>
                          {teacher.status}
                        </span>
                      </td>
                      <td className="py-4 px-6 text-ink-muted">
                        {teacher.is_admin ? <span className="text-brand-ink font-medium">Admin</span> : 'Teacher'}
                      </td>
                      <td className="py-4 px-6 text-ink-muted">{new Date(teacher.created_at).toLocaleDateString()}</td>
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
