import React from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * Card shown when something went wrong, with the ways out as buttons.
 *   <ErrorPanel title="Recording failed" message={msg} note="Your recording is saved.">
 *     <Button onClick={retry}>Retry</Button>
 *   </ErrorPanel>
 */
export function ErrorPanel({ title, message, note, icon: Icon = AlertCircle, children }) {
  return (
    <div className="bg-surface border border-line rounded-2xl shadow-card p-6 md:p-8 flex flex-col items-center text-center gap-4 animate-fadeIn" role="alert">
      <div className="w-12 h-12 rounded-full bg-danger-tint text-danger flex items-center justify-center">
        <Icon className="w-6 h-6" aria-hidden="true" />
      </div>
      <div className="space-y-1.5 max-w-md">
        <h3 className="text-lg font-bold text-ink">{title}</h3>
        {message && <p className="text-[15px] text-ink-muted">{message}</p>}
        {note && <p className="text-sm text-ink-subtle">{note}</p>}
      </div>
      {children && <div className="flex flex-wrap justify-center gap-3">{children}</div>}
    </div>
  );
}

export default ErrorPanel;
