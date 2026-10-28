import React from 'react';

/**
 * Loading indicator with an optional message.
 * `size` = sm | md | lg (default md). Other props are accepted for old callers and ignored.
 */
const SIZES = { sm: 'w-6 h-6 border-[3px]', md: 'w-10 h-10 border-4', lg: 'w-12 h-12 border-4' };

export function Spinner({ message = 'Loading...', size = 'md' }) {
  return (
    <div className="flex flex-col items-center justify-center p-8 gap-4" role="status" aria-live="polite">
      <div className={`${SIZES[size] || SIZES.md} rounded-full border-brand/15 border-t-brand animate-spin`} aria-hidden="true" />
      {message && <p className="text-ink-muted text-sm font-medium text-center">{message}</p>}
    </div>
  );
}
export default Spinner;
