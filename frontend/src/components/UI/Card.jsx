import React from 'react';

/**
 * White panel with a soft border. `padding` = none | sm | md | lg.
 *   <Card>...</Card>
 *   <Card as="section" padding="lg">...</Card>
 */
const PADDING = { none: '', sm: 'p-4', md: 'p-5 md:p-6', lg: 'p-6 md:p-8' };

export function Card({ as: Tag = 'div', padding = 'md', className = '', children, ...props }) {
  return (
    <Tag className={`bg-surface border border-line rounded-2xl shadow-card ${PADDING[padding] ?? ''} ${className}`} {...props}>
      {children}
    </Tag>
  );
}

/** Title row inside a card: heading on the left, optional actions on the right. */
export function CardHeader({ title, description, eyebrow, actions, className = '' }) {
  return (
    <div className={`flex flex-wrap items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0 flex flex-col gap-0.5">
        {eyebrow && <span className="text-[13px] font-semibold text-brand-ink">{eyebrow}</span>}
        {title && <h2 className="text-lg font-bold text-ink leading-snug">{title}</h2>}
        {description && <p className="text-sm text-ink-muted">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export default Card;
