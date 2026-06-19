import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import StudentLogin from './components/StudentLogin';
import TeacherLogin from './components/TeacherLogin';
import TeacherDashboard from './components/TeacherDashboard';
import PracticeArea from './components/PracticeArea';

export function App() {
  return (
    <Router>
      <Routes>
        {/* Student login is the default landing page */}
        <Route path="/student/login" element={<StudentLogin />} />
        
        {/* Student practice environment */}
        <Route path="/practice" element={<PracticeArea />} />
        
        {/* Teacher login & dashboard */}
        <Route path="/teacher/login" element={<TeacherLogin />} />
        <Route path="/teacher/dashboard" element={<TeacherDashboard />} />
        
        {/* Redirects */}
        <Route path="/" element={<Navigate to="/student/login" replace />} />
        <Route path="*" element={<Navigate to="/student/login" replace />} />
      </Routes>
    </Router>
  );
}

export default App;
