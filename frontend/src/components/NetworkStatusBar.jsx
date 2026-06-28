import React from 'react';
import { WifiOff } from 'lucide-react';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

export function NetworkStatusBar() {
  const isOnline = useNetworkStatus();

  if (isOnline) return null;

  return (
    <div className="bg-red-500/90 text-white px-4 py-2 flex items-center justify-center space-x-2 fixed top-0 w-full z-50 shadow-md backdrop-blur-sm">
      <WifiOff className="w-4 h-4 animate-pulse" />
      <span className="text-sm font-medium">You are offline. Some features may not be available.</span>
    </div>
  );
}
