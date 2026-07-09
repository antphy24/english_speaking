import React, { Suspense, lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary';
import { NetworkStatusBar } from './components/NetworkStatusBar';
import { ConfirmProvider } from './components/UI/ConfirmModal';
import NotFound from './components/NotFound';
import Spinner from './components/UI/Spinner';

// Lazy loaded components
const StudentLogin = lazy(() => import('./components/StudentLogin'));
const TeacherLogin = lazy(() => import('./components/TeacherLogin'));
const TeacherDashboard = lazy(() => import('./components/TeacherDashboard'));
const PracticeArea = lazy(() => import('./components/PracticeArea'));
const AdminLogin = lazy(() => import('./components/AdminLogin'));
const AdminDashboard = lazy(() => import('./components/AdminDashboard'));

// Loading fallback
const PageLoader = () => (
  <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center">
    <Spinner size="lg" color="text-indigo-500" />
  </div>
);

export function App() {
  return (
    <ErrorBoundary>
      <ConfirmProvider>
        <NetworkStatusBar />
        <Router>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              {/* Student login is the default landing page */}
              <Route path="/student/login" element={<StudentLogin />} />
              
              {/* Student practice environment */}
              <Route path="/practice" element={<PracticeArea />} />
              
              {/* Teacher login & dashboard */}
              <Route path="/teacher/login" element={<TeacherLogin />} />
              <Route path="/teacher/dashboard" element={<TeacherDashboard />} />
              
              {/* Admin login & dashboard */}
              <Route path="/admin/login" element={<AdminLogin />} />
              <Route path="/admin/dashboard" element={<AdminDashboard />} />
              
              {/* Redirects */}
              <Route path="/" element={<Navigate to="/student/login" replace />} />
              
              {/* 404 Route */}
              <Route path="*" element={<NotFound />} />
            </Routes>
          </Suspense>
        </Router>
      </ConfirmProvider>
    </ErrorBoundary>
  );
}

export default App;

