import React from 'react';

/**
 * Top of every page: title, one-line description, actions on the right (wrap on phones).
 *   <PageHeader title="Read Aloud" description="..." actions={<Button>...</Button>} />
 */
export function PageHeader({ title, description, actions, className = '' }) {
  return (
    <header className={`flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 sm:gap-4 ${className}`}>
      <div className="min-w-0 flex flex-col gap-1">
        <h1 className="text-[22px] md:text-[28px] font-bold tracking-tight text-ink leading-tight">{title}</h1>
        {description && <p className="text-sm md:text-[15px] text-ink-muted max-w-2xl">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 md:gap-2.5 shrink-0">{actions}</div>}
    </header>
  );
}

export default PageHeader;
