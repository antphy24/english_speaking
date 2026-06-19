import React from 'react';

export function Spinner({ message = 'Processing...' }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 space-y-4">
      <div className="relative w-16 h-16">
        {/* Outer glowing ring */}
        <div className="absolute inset-0 rounded-full border-4 border-purple-500/10 border-t-purple-500 animate-spin"></div>
        {/* Inner reverse rotating ring */}
        <div className="absolute inset-2 rounded-full border-4 border-indigo-500/10 border-t-indigo-500 animate-spin [animation-duration:1.5s] [animation-direction:reverse]"></div>
        {/* Core pulse */}
        <div className="absolute inset-5 rounded-full bg-slate-800 animate-pulse"></div>
      </div>
      <p className="text-slate-400 text-sm font-medium animate-pulse">{message}</p>
    </div>
  );
}
export default Spinner;
