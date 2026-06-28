import React from 'react';
import { Link } from 'react-router-dom';

function NotFound() {
  return (
    <div className="min-h-screen bg-[#0b0f19] flex items-center justify-center p-4 text-white">
      <div className="text-center space-y-6">
        <h1 className="text-9xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-purple-500">
          404
        </h1>
        <h2 className="text-3xl font-semibold">Page Not Found</h2>
        <p className="text-slate-400 max-w-md mx-auto">
          The page you are looking for might have been removed, had its name changed, or is temporarily unavailable.
        </p>
        <div className="pt-4">
          <Link to="/" className="px-6 py-3 bg-indigo-600 hover:bg-indigo-700 rounded-lg font-medium transition shadow-lg shadow-indigo-500/20">
            Go to Homepage
          </Link>
        </div>
      </div>
    </div>
  );
}

export default NotFound;
