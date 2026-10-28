import React from 'react';

/**
 * Friendly "nothing here yet" block.
 *   <EmptyState icon={History} title="No attempts yet" description="Finish one and it appears here." />
 */
export function EmptyState({ icon: Icon, title, description, action, className = '' }) {
  return (
    <div className={`flex flex-col items-center text-center gap-3 px-6 py-10 ${className}`}>
      {Icon && (
        <div className="w-12 h-12 rounded-full bg-surface-muted text-ink-subtle flex items-center justify-center">
          <Icon className="w-6 h-6" aria-hidden="true" />
        </div>
      )}
      <div className="flex flex-col gap-1 max-w-sm">
        {title && <p className="text-base font-semibold text-ink">{title}</p>}
        {description && <p className="text-sm text-ink-muted">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export default EmptyState;
