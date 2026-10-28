import React from 'react';

const VALUE_TONES = {
  neutral: 'text-ink',
  brand: 'text-brand-ink',
  success: 'text-success',
  warning: 'text-warning',
  danger: 'text-danger',
};

/**
 * One number with a label, for results and dashboards.
 *   <StatTile label="Mispronounced" value={3} tone="warning" />
 */
export function StatTile({ label, value, hint, tone = 'neutral', icon: Icon, className = '' }) {
  return (
    <div className={`bg-surface border border-line rounded-2xl px-4 py-3.5 md:px-5 md:py-4 flex items-start justify-between gap-3 ${className}`}>
      <div className="min-w-0 flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-ink-muted">{label}</span>
        <span className={`text-2xl md:text-[28px] font-bold leading-none tabular-nums ${VALUE_TONES[tone] || VALUE_TONES.neutral}`}>
          {value}
        </span>
        {hint && <span className="text-xs text-ink-subtle">{hint}</span>}
      </div>
      {Icon && (
        <div className="hidden sm:flex w-10 h-10 rounded-xl bg-brand-tint text-brand-ink items-center justify-center shrink-0">
          <Icon className="w-5 h-5" aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

export default StatTile;
