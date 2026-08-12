import React, { useState, useEffect } from 'react';

const AIStatusBadge = ({ apiBase }) => {
  const [status, setStatus] = useState('ready'); // 'ready' | 'busy' | 'exhausted'
  const [message, setMessage] = useState('AI is ready');

  useEffect(() => {
    let isMounted = true;
    
    const fetchStatus = async () => {
      try {
        const response = await fetch(`${apiBase}/ai-status`);
        if (!response.ok) return;
        const data = await response.json();
        if (isMounted) {
          setStatus(data.status);
          setMessage(data.message);
        }
      } catch (error) {
        console.error('Failed to fetch AI status:', error);
      }
    };

    // Initial fetch
    fetchStatus();

    // Poll every 20 seconds
    const interval = setInterval(fetchStatus, 20000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [apiBase]);

  // Determine styling based on status
  let bgColor = 'bg-emerald-500/10';
  let borderColor = 'border-emerald-500/20';
  let textColor = 'text-emerald-400';
  let dotColor = 'bg-emerald-500';
  let label = 'AI Ready';

  if (status === 'busy') {
    bgColor = 'bg-amber-500/10';
    borderColor = 'border-amber-500/20';
    textColor = 'text-amber-400';
    dotColor = 'bg-amber-500';
    label = 'AI Busy';
  } else if (status === 'exhausted') {
    bgColor = 'bg-rose-500/10';
    borderColor = 'border-rose-500/20';
    textColor = 'text-rose-400';
    dotColor = 'bg-rose-500';
    label = 'Quota Exhausted';
  }

  return (
    <div 
      className={`flex items-center space-x-2 px-3 py-1.5 rounded-full border ${bgColor} ${borderColor} ${textColor} text-xs font-semibold shadow-sm transition-colors duration-300`}
      title={message}
    >
      <div className="relative flex h-2 w-2">
        {status !== 'exhausted' && (
          <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${dotColor}`}></span>
        )}
        <span className={`relative inline-flex rounded-full h-2 w-2 ${dotColor}`}></span>
      </div>
      <span>{label}</span>
    </div>
  );
};

export default AIStatusBadge;
