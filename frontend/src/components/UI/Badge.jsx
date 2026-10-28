import React from 'react';

const TONES = {
  neutral: 'bg-surface-muted text-ink-muted',
  brand: 'bg-brand-tint text-brand-ink',
  success: 'bg-success-tint text-success',
  warning: 'bg-warning-tint text-warning',
  danger: 'bg-danger-tint text-danger',
};

const DOTS = {
  neutral: 'bg-ink-subtle',
  brand: 'bg-brand',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

/**
 * Small status pill.  <Badge tone="success" dot>AI ready</Badge>
 */
export function Badge({ tone = 'neutral', dot = false, icon: Icon, size = 'md', className = '', children, ...props }) {
  const sizing = size === 'sm' ? 'h-6 px-2 text-xs gap-1' : 'h-7 px-2.5 text-[13px] gap-1.5';
  return (
    <span
      className={`inline-flex items-center rounded-full font-semibold whitespace-nowrap ${sizing} ${TONES[tone] || TONES.neutral} ${className}`}
      {...props}
    >
      {dot && <span className={`w-2 h-2 rounded-full ${DOTS[tone] || DOTS.neutral}`} aria-hidden="true" />}
      {Icon && <Icon className="w-3.5 h-3.5" aria-hidden="true" />}
      {children}
    </span>
  );
}

export default Badge;
