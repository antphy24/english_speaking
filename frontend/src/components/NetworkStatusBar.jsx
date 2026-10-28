import React from 'react';
import { WifiOff } from 'lucide-react';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export function NetworkStatusBar() {
  const isOnline = useNetworkStatus();

  if (isOnline) return null;

  return (
    <div className="bg-danger-solid text-white px-4 py-2 flex items-center justify-center gap-2 fixed top-0 w-full z-50 shadow-pop" role="status">
      <WifiOff className="w-4 h-4" aria-hidden="true" />
      <span className="text-sm font-medium">You are offline. Check your internet connection.</span>
    </div>
  );
}
