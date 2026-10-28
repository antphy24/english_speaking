import React, { useState, useEffect } from 'react';
import { Badge } from './UI/Badge';

const LOOK = {
  ready: { tone: 'success', label: 'AI ready' },
  busy: { tone: 'warning', label: 'AI busy' },
  exhausted: { tone: 'danger', label: 'AI limit reached' },
};

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

  const look = LOOK[status] || LOOK.ready;
  return (
    <Badge tone={look.tone} dot title={message} aria-label={`${look.label}. ${message || ''}`}>
      {look.label}
    </Badge>
  );
};

export default AIStatusBadge;
